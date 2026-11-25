package main

import (
	"context"
	"crypto/subtle"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Property struct {
	ID            int64   `json:"id"`
	Title         string  `json:"title"`
	Location      string  `json:"location"`
	PricePerNight float64 `json:"price_per_night"`
	ImageURL      string  `json:"image_url"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
}

func listPropertiesHandler(db *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		maxPrice := c.Query("max_price")
		var price *float64
		if maxPrice != "" {
			v, err := strconv.ParseFloat(maxPrice, 64)
			if err != nil || v < 0 {
				c.JSON(http.StatusBadRequest, gin.H{"error": "max_price debe ser un número no negativo"})
				return
			}
			price = &v
		}
		rows, err := db.Query(c, `SELECT id, title, location, price_per_night, image_url, lat, lng FROM properties
WHERE ($1 = '' OR location ILIKE '%' || $1 || '%') AND ($2::numeric IS NULL OR price_per_night <= $2)
ORDER BY id`, c.Query("location"), price)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudieron consultar propiedades"})
			return
		}
		defer rows.Close()
		properties := make([]Property, 0)
		for rows.Next() {
			var p Property
			if err := rows.Scan(&p.ID, &p.Title, &p.Location, &p.PricePerNight, &p.ImageURL, &p.Lat, &p.Lng); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "error leyendo propiedades"})
				return
			}
			properties = append(properties, p)
		}
		if rows.Err() != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "error leyendo propiedades"})
			return
		}
		c.JSON(http.StatusOK, properties)
	}
}

func availabilityHandler(db *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		id, err := strconv.ParseInt(c.Param("id"), 10, 64)
		if err != nil || id <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "id de propiedad inválido"})
			return
		}
		var exists bool
		if err := db.QueryRow(c, `SELECT EXISTS(SELECT 1 FROM properties WHERE id=$1)`, id).Scan(&exists); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "error consultando propiedad"})
			return
		}
		if !exists {
			c.JSON(http.StatusNotFound, gin.H{"error": "propiedad no encontrada"})
			return
		}
		rows, err := db.Query(c, `SELECT check_in, check_out FROM bookings WHERE property_id=$1 AND status='confirmed' AND check_out >= CURRENT_DATE ORDER BY check_in`, id)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo consultar disponibilidad"})
			return
		}
		defer rows.Close()
		type DateRange struct {
			CheckIn  time.Time `json:"check_in"`
			CheckOut time.Time `json:"check_out"`
		}
		busy := make([]DateRange, 0)
		for rows.Next() {
			var r DateRange
			if err := rows.Scan(&r.CheckIn, &r.CheckOut); err != nil {
				c.JSON(http.StatusInternalServerError, gin.H{"error": "error leyendo disponibilidad"})
				return
			}
			busy = append(busy, r)
		}
		c.JSON(http.StatusOK, gin.H{"property_id": id, "busy_ranges": busy})
	}
}

type createBookingRequest struct {
	PropertyID int64  `json:"property_id" binding:"required,gt=0"`
	UserName   string `json:"user_name" binding:"required,max=120"`
	CheckIn    string `json:"check_in" binding:"required"`
	CheckOut   string `json:"check_out" binding:"required"`
}

func createBookingHandler(db *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		started := time.Now()
		status := "error"
		defer func() { recordBookingAttempt(status, time.Since(started)) }()
		var req createBookingRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "property_id, user_name, check_in y check_out son obligatorios"})
			return
		}
		checkIn, errIn := time.Parse("2006-01-02", req.CheckIn)
		checkOut, errOut := time.Parse("2006-01-02", req.CheckOut)
		if errIn != nil || errOut != nil || !checkOut.After(checkIn) {
			c.JSON(http.StatusBadRequest, gin.H{"error": "fechas inválidas; use YYYY-MM-DD y check_out posterior a check_in"})
			return
		}
		name := strings.TrimSpace(req.UserName)
		if name == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_name no puede estar vacío"})
			return
		}

		// A transaction keeps the write atomic; the EXCLUDE USING gist constraint
		// is the concurrency guard. PostgreSQL serializes conflicting inserts and
		// guarantees only one confirmed daterange per property can overlap. This
		// is stronger than locking a property row, which does not serialize all
		// booking writers unless every writer follows the same lock protocol.
		tx, err := db.Begin(c)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo iniciar la reserva"})
			return
		}
		defer tx.Rollback(context.Background())
		var bookingID int64
		err = tx.QueryRow(c, `INSERT INTO bookings(property_id,user_name,check_in,check_out) VALUES($1,$2,$3,$4) RETURNING id`, req.PropertyID, name, checkIn, checkOut).Scan(&bookingID)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.Code == "23P01" {
				status = "conflict"
				c.JSON(http.StatusConflict, gin.H{"error": "las fechas ya están reservadas"})
				return
			}
			if errors.As(err, &pgErr) && pgErr.Code == "23503" {
				c.JSON(http.StatusNotFound, gin.H{"error": "propiedad no encontrada"})
				return
			}
			if errors.As(err, &pgErr) && pgErr.Code == "23514" {
				c.JSON(http.StatusBadRequest, gin.H{"error": "rango de fechas inválido"})
				return
			}
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo crear la reserva"})
			return
		}
		if err := tx.Commit(c); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudo confirmar la reserva"})
			return
		}
		status = "success"
		c.Header("Location", "/api/bookings/"+strconv.FormatInt(bookingID, 10))
		c.JSON(http.StatusCreated, gin.H{"id": bookingID, "property_id": req.PropertyID, "user_name": name, "check_in": checkIn.Format("2006-01-02"), "check_out": checkOut.Format("2006-01-02"), "status": "confirmed"})
	}
}

// resetStressBookingsHandler removes only reservations created by the stress
// panel. It is disabled unless DEMO_RESET_TOKEN is configured and compares the
// bearer token in constant time so the demo cleanup cannot be invoked openly.
func resetStressBookingsHandler(db *pgxpool.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		token := os.Getenv("DEMO_RESET_TOKEN")
		if token == "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "demo reset disabled"})
			return
		}
		provided := strings.TrimPrefix(c.GetHeader("Authorization"), "Bearer ")
		if len(provided) != len(token) || subtle.ConstantTimeCompare([]byte(provided), []byte(token)) != 1 {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		var req struct {
			RunID string `json:"run_id" binding:"required,alphanum,min=1,max=64"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "run_id inválido"})
			return
		}
		prefix := "Stress_" + req.RunID + "_"
		result, err := db.Exec(c, `DELETE FROM bookings WHERE left(user_name, char_length($1)) = $1`, prefix)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "no se pudieron limpiar las reservas de prueba"})
			return
		}
		c.JSON(http.StatusOK, gin.H{"deleted": result.RowsAffected()})
	}
}
