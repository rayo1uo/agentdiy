package httpx

import (
	"net/http"

	"github.com/luoyu15/agentdiy/server/internal/http/handler"
	"github.com/luoyu15/agentdiy/server/internal/middleware"
)

func NewRouter(
	jwtSecret string,
	allowedOrigins []string,
	healthHandler handler.HealthHandler,
	authHandler handler.AuthHandler,
	annotationHandler handler.AnnotationHandler,
	syncHandler handler.SyncHandler,
	privacyHandler handler.PrivacyHandler,
) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register)
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)
	mux.HandleFunc("/api/v1/auth/refresh", authHandler.Refresh)
	mux.HandleFunc("/api/v1/auth/logout", authHandler.Logout)
	mux.HandleFunc("/api/v1/annotations", middleware.RequireAccessToken(jwtSecret, annotationHandler.HandleCollection))
	mux.HandleFunc("/api/v1/annotations/", middleware.RequireAccessToken(jwtSecret, annotationHandler.HandleItem))
	mux.HandleFunc("/api/v1/sync/push", middleware.RequireAccessToken(jwtSecret, syncHandler.Push))
	mux.HandleFunc("/api/v1/sync/pull", middleware.RequireAccessToken(jwtSecret, syncHandler.Pull))
	mux.HandleFunc("/api/v1/me/data", middleware.RequireAccessToken(jwtSecret, privacyHandler.DeleteMyData))

	return withSecurityHeaders(withCORS(allowedOrigins, mux))
}
