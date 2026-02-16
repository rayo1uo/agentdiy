package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
	"github.com/luoyu15/agentdiy/server/internal/middleware"
	"github.com/luoyu15/agentdiy/server/internal/storage"
	"github.com/luoyu15/agentdiy/server/internal/web"
)

type SyncHandler struct {
	annotationRepo storage.AnnotationRepository
	syncRepo       storage.SyncRepository
}

func NewSyncHandler(annotationRepo storage.AnnotationRepository, syncRepo storage.SyncRepository) SyncHandler {
	return SyncHandler{annotationRepo: annotationRepo, syncRepo: syncRepo}
}

func (h SyncHandler) Push(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		web.WriteMethodNotAllowed(w, http.MethodPost)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	var req struct {
		DeviceID   string `json:"device_id"`
		DeviceName string `json:"device_name"`
		Platform   string `json:"platform"`
		Operations []struct {
			OpID         string `json:"op_id"`
			OpType       string `json:"op_type"`
			URL          string `json:"url"`
			Title        string `json:"title"`
			AnnotationID string `json:"annotation_id"`
			QuoteText    string `json:"quote_text"`
			PrefixText   string `json:"prefix_text"`
			SuffixText   string `json:"suffix_text"`
			StartOffset  int    `json:"start_offset"`
			EndOffset    int    `json:"end_offset"`
			Color        string `json:"color"`
			CommentText  string `json:"comment_text"`
		} `json:"operations"`
	}

	if err := web.DecodeJSON(r, &req); err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	req.DeviceID = strings.TrimSpace(req.DeviceID)
	if req.DeviceID == "" {
		web.WriteError(w, http.StatusBadRequest, "device_id is required")
		return
	}

	accepted := 0
	nextCursor, _ := h.syncRepo.LatestCursor(r.Context(), userID)
	conflicts := make([]map[string]string, 0)

	for _, operation := range req.Operations {
		opID := strings.TrimSpace(operation.OpID)
		opType := storage.SyncOperationType(strings.TrimSpace(operation.OpType))
		url := strings.TrimSpace(operation.URL)
		if opID == "" || url == "" {
			conflicts = append(conflicts, map[string]string{
				"op_id":   operation.OpID,
				"message": "op_id and url are required",
			})
			continue
		}

		var annotationID string
		var payload []byte
		var processErr error
		switch opType {
		case storage.SyncOperationCreate:
			annotationModel, createErr := h.annotationRepo.Create(r.Context(), userID, annotation.CreateInput{
				AnnotationID: strings.TrimSpace(operation.AnnotationID),
				URL:          url,
				Title:        operation.Title,
				QuoteText:    operation.QuoteText,
				PrefixText:   operation.PrefixText,
				SuffixText:   operation.SuffixText,
				StartOffset:  operation.StartOffset,
				EndOffset:    operation.EndOffset,
				Color:        operation.Color,
				CommentText:  operation.CommentText,
			})
			if createErr != nil {
				processErr = createErr
				break
			}
			annotationID = annotationModel.ID
			payload, processErr = json.Marshal(map[string]any{
				"annotation": annotationModel,
			})
		case storage.SyncOperationUpdateComment:
			annotationID = strings.TrimSpace(operation.AnnotationID)
			if annotationID == "" {
				processErr = storage.ErrInvalidSyncOperation
				break
			}
			annotationModel, updateErr := h.annotationRepo.UpdateComment(r.Context(), userID, annotationID, annotation.UpdateCommentInput{
				URL:         url,
				CommentText: operation.CommentText,
				Color:       operation.Color,
			})
			if updateErr != nil {
				processErr = updateErr
				break
			}
			payload, processErr = json.Marshal(map[string]any{
				"annotation": annotationModel,
			})
		case storage.SyncOperationDelete:
			annotationID = strings.TrimSpace(operation.AnnotationID)
			if annotationID == "" {
				processErr = storage.ErrInvalidSyncOperation
				break
			}
			deleteErr := h.annotationRepo.Delete(r.Context(), userID, url, annotationID)
			if deleteErr != nil {
				processErr = deleteErr
				break
			}
			payload, processErr = json.Marshal(map[string]any{
				"annotation_id": annotationID,
				"url":           url,
				"status":        "deleted",
			})
		default:
			processErr = storage.ErrInvalidSyncOperation
		}

		if processErr != nil {
			message := "operation failed"
			if errors.Is(processErr, storage.ErrNotFound) {
				message = "annotation not found"
			} else if errors.Is(processErr, storage.ErrInvalidSyncOperation) {
				message = "invalid operation payload"
			}
			conflicts = append(conflicts, map[string]string{
				"op_id":   opID,
				"message": message,
			})
			continue
		}

		event, created, appendErr := h.syncRepo.AppendEvent(r.Context(), storage.AppendSyncEventInput{
			UserID:       userID,
			DeviceID:     req.DeviceID,
			DeviceName:   req.DeviceName,
			Platform:     req.Platform,
			OpID:         opID,
			AnnotationID: annotationID,
			OpType:       opType,
			Payload:      payload,
		})
		if appendErr != nil {
			conflicts = append(conflicts, map[string]string{
				"op_id":   opID,
				"message": "failed to persist sync event",
			})
			continue
		}
		if created {
			accepted++
		}
		if event.ID > nextCursor {
			nextCursor = event.ID
		}
	}

	web.WriteOK(w, map[string]any{
		"server_time": web.NowRFC3339(),
		"accepted":    accepted,
		"next_cursor": nextCursor,
		"conflicts":   conflicts,
	})
}

func (h SyncHandler) Pull(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet {
		web.WriteMethodNotAllowed(w, http.MethodGet)
		return
	}

	userID := middleware.UserIDFromContext(r.Context())
	if userID == "" {
		web.WriteError(w, http.StatusUnauthorized, "missing user context")
		return
	}

	cursor, err := parseUintQuery(r, "cursor", 0)
	if err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid cursor")
		return
	}

	limit, err := parseIntQuery(r, "limit", 50)
	if err != nil {
		web.WriteError(w, http.StatusBadRequest, "invalid limit")
		return
	}
	if limit > 200 {
		limit = 200
	}

	events, nextCursor, listErr := h.syncRepo.ListEvents(r.Context(), userID, cursor, limit)
	if listErr != nil {
		web.WriteError(w, http.StatusInternalServerError, "failed to pull sync events")
		return
	}

	web.WriteOK(w, map[string]any{
		"server_time": web.NowRFC3339(),
		"events":      events,
		"next_cursor": nextCursor,
		"conflicts":   []any{},
	})
}

func parseUintQuery(r *http.Request, key string, fallback uint64) (uint64, error) {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.ParseUint(value, 10, 64)
	if err != nil {
		return 0, err
	}
	return parsed, nil
}

func parseIntQuery(r *http.Request, key string, fallback int) (int, error) {
	value := strings.TrimSpace(r.URL.Query().Get(key))
	if value == "" {
		return fallback, nil
	}
	parsed, err := strconv.Atoi(value)
	if err != nil {
		return 0, err
	}
	if parsed <= 0 {
		return fallback, nil
	}
	return parsed, nil
}
