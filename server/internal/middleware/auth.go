package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/rayo1uo/annota/server/internal/auth"
	"github.com/rayo1uo/annota/server/internal/web"
)

type contextKey string

const (
	userIDContextKey contextKey = "user_id"
	emailContextKey  contextKey = "email"
)

func RequireAccessToken(jwtSecret string, next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		authorization := strings.TrimSpace(r.Header.Get("Authorization"))
		if !strings.HasPrefix(strings.ToLower(authorization), "bearer ") {
			web.WriteError(w, http.StatusUnauthorized, "missing bearer token")
			return
		}

		token := strings.TrimSpace(authorization[7:])
		claims, err := auth.ParseAccessToken(jwtSecret, token)
		if err != nil {
			web.WriteError(w, http.StatusUnauthorized, "invalid access token")
			return
		}

		ctx := context.WithValue(r.Context(), userIDContextKey, claims.Sub)
		ctx = context.WithValue(ctx, emailContextKey, claims.Eml)
		next(w, r.WithContext(ctx))
	}
}

func UserIDFromContext(ctx context.Context) string {
	value, _ := ctx.Value(userIDContextKey).(string)
	return value
}

func EmailFromContext(ctx context.Context) string {
	value, _ := ctx.Value(emailContextKey).(string)
	return value
}
