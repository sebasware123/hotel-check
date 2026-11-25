package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"
	"github.com/prometheus/client_golang/prometheus/promhttp"
)

func main() {
	// Load local development settings when present. Hosted deployments should
	// provide the same values through the platform environment instead.
	_ = godotenv.Load()

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	db, err := OpenDB(ctx)
	if err != nil {
		log.Fatalf("connect to database: %v", err)
	}
	defer db.Close()
	if err := InitializeDB(ctx, db); err != nil {
		log.Fatalf("initialize database: %v", err)
	}

	if strings.EqualFold(os.Getenv("GIN_MODE"), "release") || os.Getenv("APP_ENV") == "production" {
		gin.SetMode(gin.ReleaseMode)
	}
	r := gin.New()
	r.Use(gin.Logger(), gin.Recovery())
	r.GET("/healthz", func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"status": "ok"}) })
	r.GET("/metrics", gin.WrapH(promhttp.Handler()))
	r.GET("/api/stats", statsHandler)
	r.GET("/api/properties", listPropertiesHandler(db))
	r.GET("/api/properties/:id/availability", availabilityHandler(db))
	r.POST("/api/bookings", createBookingHandler(db))
	r.POST("/api/bookings/stress-test/reset", resetStressBookingsHandler(db))

	addr := ":" + envOr("PORT", "8080")
	srv := &http.Server{Addr: addr, Handler: r, ReadHeaderTimeout: 5 * time.Second}
	go func() {
		log.Printf("server listening on %s", addr)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Fatalf("http server: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, syscall.SIGINT, syscall.SIGTERM)
	<-stop
	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer shutdownCancel()
	if err := srv.Shutdown(shutdownCtx); err != nil {
		log.Printf("server shutdown: %v", err)
	}
}

func envOr(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
