package handler

import (
	"net/http"
	"time"

	"github.com/luoyu15/agentdiy/server/internal/web"
)

type HealthHandler struct{}

func NewHealthHandler() HealthHandler {
	return HealthHandler{}
}

func (h HealthHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		web.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	web.WriteOK(w, map[string]any{
		"status": "ok",
		"time":   time.Now().UTC().Format(time.RFC3339),
	})
}
