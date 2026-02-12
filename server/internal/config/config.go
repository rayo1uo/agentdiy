package config

import (
	"os"
	"strings"
)

type Config struct {
	HTTPAddr       string
	MySQLDSN       string
	AllowedOrigins []string
}

func FromEnv() Config {
	return Config{
		HTTPAddr:       getOrDefault("HTTP_ADDR", ":8080"),
		MySQLDSN:       getOrDefault("MYSQL_DSN", "root:root@tcp(127.0.0.1:3306)/annota?parseTime=true&charset=utf8mb4"),
		AllowedOrigins: splitCSV(getOrDefault("ALLOWED_ORIGINS", "*")),
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
