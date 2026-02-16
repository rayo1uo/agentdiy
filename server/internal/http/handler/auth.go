package handler

import (
	"errors"
	"net/http"
	"strings"

	"github.com/rayo1uo/annota/server/internal/auth"
	"github.com/rayo1uo/annota/server/internal/web"
)

type AuthHandler struct {
	service auth.Service
}

func NewAuthHandler(service auth.Service) AuthHandler {
	return AuthHandler{service: service}
}

func (h AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := web.DecodeJSON(r, &req); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, tokenPair, err := h.service.Register(r.Context(), req.Email, req.Password)
	if err != nil {
		switch {
		case errors.Is(err, auth.ErrUserExists):
			web.WriteError(w, http.StatusConflict, "email already registered")
		case strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "email"):
			web.WriteError(w, http.StatusBadRequest, err.Error())
		default:
			web.WriteError(w, http.StatusInternalServerError, "failed to register")
		}
		return
	}

	web.WriteJSON(w, http.StatusCreated, map[string]any{
		"user":        map[string]any{"id": user.ID, "email": user.Email, "created_at": user.CreatedAt},
		"token_pair":  tokenPair,
		"server_time": web.NowRFC3339(),
	})
}

func (h AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := web.DecodeJSON(r, &req); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, tokenPair, err := h.service.Login(r.Context(), req.Email, req.Password)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			web.WriteError(w, http.StatusUnauthorized, "invalid email or password")
			return
		}
		web.WriteError(w, http.StatusInternalServerError, "failed to login")
		return
	}

	web.WriteOK(w, map[string]any{
		"user":        map[string]any{"id": user.ID, "email": user.Email, "created_at": user.CreatedAt},
		"token_pair":  tokenPair,
		"server_time": web.NowRFC3339(),
	})
}

func (h AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := web.DecodeJSON(r, &req); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	user, tokenPair, err := h.service.Refresh(r.Context(), req.RefreshToken)
	if err != nil {
		if errors.Is(err, auth.ErrInvalidCredentials) {
			web.WriteError(w, http.StatusUnauthorized, "invalid refresh token")
			return
		}
		web.WriteError(w, http.StatusInternalServerError, "failed to refresh token")
		return
	}

	web.WriteOK(w, map[string]any{
		"user":        map[string]any{"id": user.ID, "email": user.Email, "created_at": user.CreatedAt},
		"token_pair":  tokenPair,
		"server_time": web.NowRFC3339(),
	})
}

func (h AuthHandler) Logout(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := web.DecodeJSON(r, &req); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.service.Logout(r.Context(), req.RefreshToken); err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to logout")
		return
	}

	web.WriteOK(w, map[string]any{
		"ok":          true,
		"server_time": web.NowRFC3339(),
	})
}
