package httpx

import (
	"net/http"

	"github.com/luoyu15/agentdiy/server/internal/http/handler"
)

func NewRouter(
	healthHandler handler.HealthHandler,
	annotationHandler handler.AnnotationHandler,
	syncHandler handler.SyncHandler,
) http.Handler {
	mux := http.NewServeMux()

	mux.Handle("/api/v1/health", healthHandler)
	mux.HandleFunc("/api/v1/annotations", annotationHandler.HandleCollection)
	mux.HandleFunc("/api/v1/annotations/", annotationHandler.HandleItem)
	mux.HandleFunc("/api/v1/sync/push", syncHandler.Push)
	mux.HandleFunc("/api/v1/sync/pull", syncHandler.Pull)

	return withCORS(mux)
}
