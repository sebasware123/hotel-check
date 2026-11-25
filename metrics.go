package main

import (
	"sync/atomic"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var bookingAttempts = promauto.NewCounterVec(prometheus.CounterOpts{
	Name: "booking_attempts_total", Help: "Intentos de reserva por resultado."}, []string{"status"})
var bookingDuration = promauto.NewHistogram(prometheus.HistogramOpts{
	Name: "booking_duration_seconds", Help: "Duración total de la petición de reserva en segundos.",
	Buckets: prometheus.DefBuckets})

var bookingSuccess atomic.Uint64
var bookingConflict atomic.Uint64
var bookingError atomic.Uint64
var bookingDurationCount atomic.Uint64
var bookingDurationNanos atomic.Uint64

func init() {
	// Export zero-valued outcomes from the first scrape so dashboards render
	// before the first request for each booking result has occurred.
	bookingAttempts.WithLabelValues("success")
	bookingAttempts.WithLabelValues("conflict")
	bookingAttempts.WithLabelValues("error")
}

func recordBookingAttempt(status string, duration time.Duration) {
	bookingAttempts.WithLabelValues(status).Inc()
	bookingDuration.Observe(duration.Seconds())
	bookingDurationCount.Add(1)
	bookingDurationNanos.Add(uint64(duration.Nanoseconds()))
	switch status {
	case "success":
		bookingSuccess.Add(1)
	case "conflict":
		bookingConflict.Add(1)
	default:
		bookingError.Add(1)
	}
}

func statsHandler(c *gin.Context) {
	count := bookingDurationCount.Load()
	sumSeconds := float64(bookingDurationNanos.Load()) / float64(time.Second)
	avgSeconds := 0.0
	if count > 0 {
		avgSeconds = sumSeconds / float64(count)
	}
	c.JSON(200, gin.H{"booking_attempts_total": gin.H{
		"success": bookingSuccess.Load(), "conflict": bookingConflict.Load(), "error": bookingError.Load(),
	}, "booking_duration_seconds": gin.H{"count": count, "sum": sumSeconds, "average": avgSeconds}})
}
