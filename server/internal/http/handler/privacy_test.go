package handler_test

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
	"github.com/luoyu15/agentdiy/server/internal/auth"
	"github.com/luoyu15/agentdiy/server/internal/http/handler"
	"github.com/luoyu15/agentdiy/server/internal/middleware"
	"github.com/luoyu15/agentdiy/server/internal/storage"
)

func TestDeleteMyData(t *testing.T) {
	const (
		secret = "test-secret"
		userID = "user-1"
	)

	annotationRepo := storage.NewMemoryAnnotationRepository()
	authRepo := storage.NewMemoryAuthRepository()
	syncRepo := storage.NewMemorySyncRepository()
	privacyHandler := handler.NewPrivacyHandler(annotationRepo, authRepo, syncRepo, slog.Default())

	ctx := context.Background()
	_, err := authRepo.CreateUser(ctx, "u@example.com", "hash")
	if err != nil {
		t.Fatalf("CreateUser failed: %v", err)
	}

	_, err = annotationRepo.Create(ctx, userID, annotation.CreateInput{
		AnnotationID: "ann-1",
		URL:          "https://example.com/a",
		Title:        "A",
		QuoteText:    "quote",
		StartOffset:  1,
		EndOffset:    6,
		Color:        "#ffe58f",
	})
	if err != nil {
		t.Fatalf("Create annotation failed: %v", err)
	}

	now := time.Now().UTC()
	err = authRepo.StoreRefreshToken(ctx, auth.RefreshToken{
		Token:     "rt-1",
		UserID:    userID,
		ExpiresAt: now.Add(24 * time.Hour),
		CreatedAt: now,
	})
	if err != nil {
		t.Fatalf("StoreRefreshToken failed: %v", err)
	}

	_, _, err = syncRepo.AppendEvent(ctx, storage.AppendSyncEventInput{
		UserID:       userID,
		DeviceID:     "dev-1",
		DeviceName:   "dev",
		Platform:     "mac",
		OpID:         "op-1",
		AnnotationID: "ann-1",
		OpType:       storage.SyncOperationCreate,
		Payload:      json.RawMessage(`{"ok":true}`),
	})
	if err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}

	accessToken, _, err := auth.GenerateAccessToken(secret, userID, "u@example.com", 5*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/me/data", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	recorder := httptest.NewRecorder()

	httpHandler := middleware.RequireAccessToken(secret, privacyHandler.DeleteMyData)
	httpHandler(recorder, req)

	if recorder.Code != http.StatusOK {
		t.Fatalf("unexpected status: %d, body: %s", recorder.Code, recorder.Body.String())
	}

	items, err := annotationRepo.ListByURL(ctx, userID, "https://example.com/a")
	if err != nil {
		t.Fatalf("ListByURL failed: %v", err)
	}
	if len(items) != 0 {
		t.Fatalf("expected annotations to be soft deleted, got %d", len(items))
	}

	refreshToken, err := authRepo.GetRefreshToken(ctx, "rt-1")
	if err != nil {
		t.Fatalf("GetRefreshToken failed: %v", err)
	}
	if refreshToken.RevokedAt == nil {
		t.Fatalf("expected refresh token to be revoked")
	}

	events, _, err := syncRepo.ListEvents(ctx, userID, 0, 10)
	if err != nil {
		t.Fatalf("ListEvents failed: %v", err)
	}
	if len(events) != 0 {
		t.Fatalf("expected sync events to be deleted, got %d", len(events))
	}
}
