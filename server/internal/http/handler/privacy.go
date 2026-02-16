package handler

import (
	"log/slog"
	"net/http"

	"github.com/rayo1uo/agentdiy/server/internal/auth"
	"github.com/rayo1uo/agentdiy/server/internal/middleware"
	"github.com/rayo1uo/agentdiy/server/internal/storage"
	"github.com/rayo1uo/agentdiy/server/internal/web"
)

type PrivacyHandler struct {
	annotationRepo storage.AnnotationRepository
	authRepo       auth.Repository
	syncRepo       storage.SyncRepository
	logger         *slog.Logger
}

func NewPrivacyHandler(
	annotationRepo storage.AnnotationRepository,
	authRepo auth.Repository,
	syncRepo storage.SyncRepository,
	logger *slog.Logger,
) PrivacyHandler {
	if logger == nil {
		logger = slog.Default()
	}
	return PrivacyHandler{
		annotationRepo: annotationRepo,
		authRepo:       authRepo,
		syncRepo:       syncRepo,
		logger:         logger,
	}
}

func (h PrivacyHandler) DeleteMyData(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodDelete {
		web.WriteMethodNotAllowed(w, http.MethodDelete)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	annotationsAffected, err := h.annotationRepo.SoftDeleteAllByUser(r.Context(), userID)
	if err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to delete annotations")
		return
	}

	revokedTokens, err := h.authRepo.RevokeAllRefreshTokensByUser(r.Context(), userID)
	if err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to revoke refresh tokens")
		return
	}

	deletedEvents, err := h.syncRepo.DeleteAllByUser(r.Context(), userID)
	if err != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to clear sync events")
		return
	}

	h.logger.Info("user data deletion requested",
		"user_id", userID,
		"annotations_soft_deleted", annotationsAffected,
		"refresh_tokens_revoked", revokedTokens,
		"sync_events_deleted", deletedEvents,
	)

	web.WriteOK(w, map[string]any{
		"ok":                       true,
		"annotations_soft_deleted": annotationsAffected,
		"refresh_tokens_revoked":   revokedTokens,
		"sync_events_deleted":      deletedEvents,
		"server_time":              web.NowRFC3339(),
	})
}
