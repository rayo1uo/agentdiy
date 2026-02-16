package httpx

import (
	"net/http"

	"github.com/rayo1uo/annota/server/internal/http/handler"
	"github.com/rayo1uo/annota/server/internal/middleware"
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
	mux.HandleFunc("/api/v1/auth/register", authHandler.Register) // 用户注册
	mux.HandleFunc("/api/v1/auth/login", authHandler.Login)       // 用户登陆
	mux.HandleFunc("/api/v1/auth/refresh", authHandler.Refresh)   // 用户刷新Token
	mux.HandleFunc("/api/v1/auth/logout", authHandler.Logout)     // 用户登出
	mux.HandleFunc("/api/v1/annotations", middleware.RequireAccessToken(jwtSecret, annotationHandler.HandleCollection))
	mux.HandleFunc("/api/v1/annotations/", middleware.RequireAccessToken(jwtSecret, annotationHandler.HandleItem))
	mux.HandleFunc("/api/v1/sync/push", middleware.RequireAccessToken(jwtSecret, syncHandler.Push))
	mux.HandleFunc("/api/v1/sync/pull", middleware.RequireAccessToken(jwtSecret, syncHandler.Pull))
	mux.HandleFunc("/api/v1/me/data", middleware.RequireAccessToken(jwtSecret, privacyHandler.DeleteMyData))

	return withSecurityHeaders(withCORS(allowedOrigins, mux))
}
