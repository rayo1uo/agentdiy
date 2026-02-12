package config

import (
	"os"
	"strconv"
	"strings"
	"time"
)

type Config struct {
	HTTPAddr              string
	MySQLDSN              string
	AllowedOrigins        []string
	JWTSecret             string
	AccessTokenTTL        time.Duration
	RefreshTokenTTL       time.Duration
	StorageBackend        string
	AnnotationStoreDriver string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:              getOrDefault("HTTP_ADDR", ":8080"),
		MySQLDSN:              getOrDefault("MYSQL_DSN", "root:root@tcp(127.0.0.1:3306)/annota?parseTime=true&charset=utf8mb4"),
		AllowedOrigins:        splitCSV(getOrDefault("ALLOWED_ORIGINS", "*")),
		JWTSecret:             getOrDefault("JWT_SECRET", "annota-dev-secret-change-me"),
		AccessTokenTTL:        durationFromSeconds("ACCESS_TOKEN_TTL_SECONDS", 900),
		RefreshTokenTTL:       durationFromSeconds("REFRESH_TOKEN_TTL_SECONDS", 2592000),
		StorageBackend:        strings.ToLower(getOrDefault("STORAGE_BACKEND", "memory")),
		AnnotationStoreDriver: strings.ToLower(getOrDefault("ANNOTATION_STORE_DRIVER", "memory")),
	}
}

func getOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func splitCSV(value string) []string {
	if strings.TrimSpace(value) == "" {
		return []string{"*"}
	}

	parts := strings.Split(value, ",")
	result := make([]string, 0, len(parts))
	for _, part := range parts {
		trimmed := strings.TrimSpace(part)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return []string{"*"}
	}
	return result
}

func durationFromSeconds(key string, fallbackSeconds int) time.Duration {
	value := strings.TrimSpace(os.Getenv(key))
	if value == "" {
		return time.Duration(fallbackSeconds) * time.Second
	}

	seconds, err := strconv.Atoi(value)
	if err != nil || seconds <= 0 {
		return time.Duration(fallbackSeconds) * time.Second
	}
	return time.Duration(seconds) * time.Second
}
