package main

import (
	"context"
	"fmt"
	"os"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func OpenDB(ctx context.Context) (*pgxpool.Pool, error) {
	url := os.Getenv("DATABASE_URL")
	if url == "" {
		// Keep the explicit DB_* fallback for local setups, but never silently
		// point a Neon-configured app at localhost when DATABASE_URL is missing.
		if os.Getenv("DB_HOST") == "" {
			return nil, fmt.Errorf("DATABASE_URL no esta configurada; agrega el connection string de Neon al archivo .env en la raiz del proyecto")
		}
		url = fmt.Sprintf("postgres://%s:%s@%s:%s/%s?sslmode=%s",
			envOr("DB_USER", "postgres"), envOr("DB_PASSWORD", "postgres"),
			envOr("DB_HOST", "localhost"), envOr("DB_PORT", "5432"),
			envOr("DB_NAME", "hotelcheck"), envOr("DB_SSLMODE", "disable"))
	}
	cfg, err := pgxpool.ParseConfig(url)
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	cfg.MaxConns = int32(envInt("DB_MAX_CONNS", 30))
	cfg.MinConns = int32(envInt("DB_MIN_CONNS", 2))
	cfg.MaxConnLifetime = 30 * time.Minute
	pool, err := pgxpool.NewWithConfig(ctx, cfg)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return pool, nil
}

func InitializeDB(ctx context.Context, db *pgxpool.Pool) error {
	// btree_gist lets PostgreSQL combine equality on property_id with an overlap
	// operator on daterange inside one atomic EXCLUDE constraint.
	_, err := db.Exec(ctx, `
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE TABLE IF NOT EXISTS properties (
  id BIGSERIAL PRIMARY KEY,
  title TEXT NOT NULL,
  location TEXT NOT NULL,
  price_per_night NUMERIC(12,2) NOT NULL CHECK (price_per_night >= 0),
  image_url TEXT NOT NULL DEFAULT '',
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS bookings (
  id BIGSERIAL PRIMARY KEY,
  property_id BIGINT NOT NULL REFERENCES properties(id),
  user_name TEXT NOT NULL,
  check_in DATE NOT NULL,
  check_out DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT booking_dates_valid CHECK (check_out > check_in),
  CONSTRAINT bookings_no_overlap EXCLUDE USING gist (
    property_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  ) WHERE (status = 'confirmed')
);
CREATE INDEX IF NOT EXISTS bookings_property_dates_idx ON bookings(property_id, check_in, check_out) WHERE status = 'confirmed';
`)
	if err != nil {
		return fmt.Errorf("create schema: %w", err)
	}

	// Serialize startup seeders across app replicas, then only add the six demo
	// rows when properties is empty. The lock is released at transaction end.
	tx, err := db.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if _, err = tx.Exec(ctx, `SELECT pg_advisory_xact_lock(746201)`); err != nil {
		return err
	}
	var count int
	if err = tx.QueryRow(ctx, `SELECT count(*) FROM properties`).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		_, err = tx.Exec(ctx, `INSERT INTO properties (title, location, price_per_night, image_url, lat, lng) VALUES
('Casa frente al mar en Cartagena', 'Cartagena, Colombia', 420000, 'https://images.unsplash.com/photo-1499793983690-e29da59ef1c2', 10.3910, -75.4794),
('Cabaña de montaña en Guatapé', 'Guatapé, Colombia', 280000, 'https://images.unsplash.com/photo-1449158743715-0a90ebb6d2d8', 6.2333, -75.1667),
('Loft moderno en Medellín', 'Medellín, Colombia', 190000, 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0', 6.2442, -75.5812),
('Finca cafetera en Salento', 'Salento, Colombia', 350000, 'https://images.unsplash.com/photo-1510798831971-661eb04b3739', 4.6370, -75.5703),
('Apartamento con vista en Santa Marta', 'Santa Marta, Colombia', 310000, 'https://images.unsplash.com/photo-1512918728675-ed5a9ecdebfd', 11.2408, -74.1990),
('Casa colonial en Villa de Leyva', 'Villa de Leyva, Colombia', 260000, 'https://images.unsplash.com/photo-1449844908441-8829872d2607', 5.6330, -73.5260)`)
		if err != nil {
			return fmt.Errorf("seed properties: %w", err)
		}
	}
	return tx.Commit(ctx)
}

func envInt(key string, fallback int) int {
	var value int
	if _, err := fmt.Sscanf(os.Getenv(key), "%d", &value); err != nil || value <= 0 {
		return fallback
	}
	return value
}
