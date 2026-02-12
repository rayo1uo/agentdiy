package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
	"github.com/luoyu15/agentdiy/server/internal/middleware"
	"github.com/luoyu15/agentdiy/server/internal/storage"
	"github.com/luoyu15/agentdiy/server/internal/web"
)

type AnnotationHandler struct {
	repo storage.AnnotationRepository
}

func NewAnnotationHandler(repo storage.AnnotationRepository) AnnotationHandler {
	return AnnotationHandler{repo: repo}
}

func (h AnnotationHandler) HandleCollection(w http.ResponseWriter, r *http.Request) {
	switch r.Method {
	case http.MethodGet:
		h.list(w, r)
	case http.MethodPost:
		h.create(w, r)
	default:
		web.WriteMethodNotAllowed(w, http.MethodGet, http.MethodPost)
	}
}

func (h AnnotationHandler) HandleItem(w http.ResponseWriter, r *http.Request) {
	id := strings.TrimPrefix(r.URL.Path, "/api/v1/annotations/")
	if id == "" {
		web.WriteError(w, http.StatusBadRequest, "missing annotation id")
		return
	}

	switch r.Method {
	case http.MethodPatch:
		h.updateComment(w, r, id)
	case http.MethodDelete:
		h.delete(w, r, id)
	default:
		web.WriteMethodNotAllowed(w, http.MethodPatch, http.MethodDelete)
	}
}

func (h AnnotationHandler) list(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	url := strings.TrimSpace(r.URL.Query().Get("url"))
	if url == "" {
		web.WriteError(w, http.StatusBadRequest, "missing query parameter: url")
		return
	}

	items, err := h.repo.ListByURL(r.Context(), userID, url)
	if err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to list annotations")
		return
	}

	web.WriteOK(w, map[string]any{"annotations": items})
}

func (h AnnotationHandler) create(w http.ResponseWriter, r *http.Request) {
	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	var input annotation.CreateInput
	if err := web.DecodeJSON(r, &input); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(input.URL) == "" || strings.TrimSpace(input.QuoteText) == "" {
		web.WriteError(w, http.StatusBadRequest, "url and quote_text are required")
		return
	}

	item, err := h.repo.Create(r.Context(), userID, input)
	if err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to create annotation")
		return
	}

	web.WriteJSON(w, http.StatusCreated, item)
}

func (h AnnotationHandler) updateComment(w http.ResponseWriter, r *http.Request, id string) {
	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	var input annotation.UpdateCommentInput
	if err := web.DecodeJSON(r, &input); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if strings.TrimSpace(input.URL) == "" {
		web.WriteError(w, http.StatusBadRequest, "url is required")
		return
	}

	item, err := h.repo.UpdateComment(r.Context(), userID, id, input)
	if err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			web.WriteError(w, http.StatusNotFound, "annotation not found")
			return
		}
		web.WriteError(w, http.StatusInternalServerError, "failed to update annotation")
		return
	}

	web.WriteOK(w, item)
}

func (h AnnotationHandler) delete(w http.ResponseWriter, r *http.Request, id string) {
	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	url := strings.TrimSpace(r.URL.Query().Get("url"))
	if url == "" {
		web.WriteError(w, http.StatusBadRequest, "missing query parameter: url")
		return
	}

	if err := h.repo.Delete(r.Context(), userID, url, id); err != nil {
		if errors.Is(err, storage.ErrNotFound) {
			web.WriteError(w, http.StatusNotFound, "annotation not found")
			return
		}
		web.WriteError(w, http.StatusInternalServerError, "failed to delete annotation")
		return
	}

	web.WriteOK(w, map[string]bool{"removed": true})
}
