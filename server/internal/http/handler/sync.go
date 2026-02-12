package handler

import (
	"net/http"

	"github.com/luoyu15/agentdiy/server/internal/web"
)

type SyncHandler struct{}

func NewSyncHandler() SyncHandler {
	return SyncHandler{}
}

func (h SyncHandler) Push(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	web.WriteOK(w, map[string]any{
		"server_time": web.NowRFC3339(),
		"accepted":    0,
		"next_cursor": 0,
		"conflicts":   []any{},
	})
}

func (h SyncHandler) Pull(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		web.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	web.WriteOK(w, map[string]any{
		"server_time": web.NowRFC3339(),
		"events":      []any{},
		"next_cursor": 0,
		"conflicts":   []any{},
	})
}
