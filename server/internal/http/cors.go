package httpx

import (
	"net/http"
	"strings"
)

func withCORS(allowedOrigins []string, next http.Handler) http.Handler {
	normalizedOrigins := normalizeAllowedOrigins(allowedOrigins)

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		if allowOrigin := matchAllowedOrigin(origin, normalizedOrigins); allowOrigin != "" {
			w.Header().Set("Access-Control-Allow-Origin", allowOrigin)
			w.Header().Set("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type, Authorization")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")

		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func normalizeAllowedOrigins(origins []string) []string {
	result := make([]string, 0, len(origins))
	for _, origin := range origins {
		trimmed := strings.TrimSpace(origin)
		if trimmed != "" {
			result = append(result, trimmed)
		}
	}
	if len(result) == 0 {
		return []string{"*"}
	}
	return result
}

func matchAllowedOrigin(origin string, allowedOrigins []string) string {
	if len(allowedOrigins) == 0 {
		return ""
	}
	for _, allowed := range allowedOrigins {
		if allowed == "*" {
			if origin == "" {
				return "*"
			}
			return origin
		}
		if origin == allowed {
			return origin
		}
	}
	return ""
}
