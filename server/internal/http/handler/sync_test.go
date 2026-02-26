package handler_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/rayo1uo/annota/server/internal/auth"
	"github.com/rayo1uo/annota/server/internal/http/handler"
	"github.com/rayo1uo/annota/server/internal/middleware"
	"github.com/rayo1uo/annota/server/internal/storage"
)

type pushResponse struct {
	Accepted   int    `json:"accepted"`
	NextCursor uint64 `json:"next_cursor"`
	Conflicts  []struct {
		OpID    string `json:"op_id"`
		Message string `json:"message"`
	} `json:"conflicts"`
}

type pullResponse struct {
	NextCursor uint64 `json:"next_cursor"`
	Events     []struct {
		ID           uint64 `json:"id"`
		DeviceID     string `json:"device_id"`
		OpID         string `json:"op_id"`
		OpType       string `json:"op_type"`
		AnnotationID string `json:"annotation_id"`
	} `json:"events"`
}

func newSyncTestContext(t *testing.T) (handler.SyncHandler, string) {
	t.Helper()

	const secret = "test-secret"
	annotationRepo := storage.NewMemoryAnnotationRepository()
	syncRepo := storage.NewMemorySyncRepository()
	syncHandler := handler.NewSyncHandler(annotationRepo, syncRepo)

	accessToken, _, err := auth.GenerateAccessToken(secret, "user-1", "u@example.com", 5*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	return syncHandler, accessToken
}

func pushRequest(t *testing.T, syncHandler handler.SyncHandler, accessToken string, payload map[string]any) *httptest.ResponseRecorder {
	t.Helper()

	body, err := json.Marshal(payload)
	if err != nil {
		t.Fatalf("marshal payload failed: %v", err)
	}
	pushReq := httptest.NewRequest(http.MethodPost, "/api/v1/sync/push", bytes.NewReader(body))
	pushReq.Header.Set("Authorization", "Bearer "+accessToken)
	pushReq.Header.Set("Content-Type", "application/json")
	pushRecorder := httptest.NewRecorder()
	pushEndpoint := middleware.RequireAccessToken("test-secret", syncHandler.Push)
	pushEndpoint(pushRecorder, pushReq)
	return pushRecorder
}

func pullRequest(
	t *testing.T,
	syncHandler handler.SyncHandler,
	accessToken string,
	cursor uint64,
) *httptest.ResponseRecorder {
	t.Helper()

	pullReq := httptest.NewRequest(http.MethodGet, "/api/v1/sync/pull?cursor="+itoa(cursor)+"&limit=50", nil)
	pullReq.Header.Set("Authorization", "Bearer "+accessToken)
	pullRecorder := httptest.NewRecorder()
	pullEndpoint := middleware.RequireAccessToken("test-secret", syncHandler.Pull)
	pullEndpoint(pullRecorder, pullReq)
	return pullRecorder
}

func itoa(value uint64) string {
	return strconv.FormatUint(value, 10)
}

func TestSyncPushThenPull(t *testing.T) {
	syncHandler, accessToken := newSyncTestContext(t)

	pushPayload := map[string]any{
		"device_id":   "dev-1",
		"device_name": "MacBook",
		"platform":    "mac",
		"operations": []map[string]any{
			{
				"op_id":        "op-1",
				"op_type":      "create",
				"url":          "https://example.com/post/1",
				"title":        "Example",
				"quote_text":   "hello",
				"prefix_text":  "",
				"suffix_text":  "",
				"start_offset": 1,
				"end_offset":   6,
				"color":        "#ffe58f",
				"comment_text": "note",
			},
		},
	}
	pushRecorder := pushRequest(t, syncHandler, accessToken, pushPayload)
	if pushRecorder.Code != http.StatusOK {
		t.Fatalf("unexpected push status: %d, body: %s", pushRecorder.Code, pushRecorder.Body.String())
	}

	var pushResp pushResponse
	if err := json.Unmarshal(pushRecorder.Body.Bytes(), &pushResp); err != nil {
		t.Fatalf("unmarshal push response: %v", err)
	}
	if pushResp.Accepted != 1 {
		t.Fatalf("expected accepted=1, got %d", pushResp.Accepted)
	}

	pullRecorder := pullRequest(t, syncHandler, accessToken, 0)
	if pullRecorder.Code != http.StatusOK {
		t.Fatalf("unexpected pull status: %d, body: %s", pullRecorder.Code, pullRecorder.Body.String())
	}

	var pullResp pullResponse
	if err := json.Unmarshal(pullRecorder.Body.Bytes(), &pullResp); err != nil {
		t.Fatalf("unmarshal pull response: %v", err)
	}
	if len(pullResp.Events) != 1 {
		t.Fatalf("expected one event, got %d", len(pullResp.Events))
	}
	if pullResp.Events[0].OpID != "op-1" || pullResp.Events[0].OpType != "create" {
		t.Fatalf("unexpected event: %+v", pullResp.Events[0])
	}
}

func TestSyncPushIdempotentOperation(t *testing.T) {
	syncHandler, accessToken := newSyncTestContext(t)

	pushPayload := map[string]any{
		"device_id":   "dev-1",
		"device_name": "MacBook",
		"platform":    "mac",
		"operations": []map[string]any{
			{
				"op_id":         "dup-op-1",
				"op_type":       "create",
				"url":           "https://example.com/post/idempotent",
				"title":         "Example",
				"annotation_id": "ann-idempotent",
				"quote_text":    "hello",
				"prefix_text":   "",
				"suffix_text":   "",
				"start_offset":  1,
				"end_offset":    6,
				"color":         "#ffe58f",
				"comment_text":  "note",
			},
		},
	}

	first := pushRequest(t, syncHandler, accessToken, pushPayload)
	if first.Code != http.StatusOK {
		t.Fatalf("unexpected first push status: %d", first.Code)
	}
	var firstResp pushResponse
	if err := json.Unmarshal(first.Body.Bytes(), &firstResp); err != nil {
		t.Fatalf("unmarshal first response: %v", err)
	}
	if firstResp.Accepted != 1 {
		t.Fatalf("expected accepted=1 on first push, got %d", firstResp.Accepted)
	}

	second := pushRequest(t, syncHandler, accessToken, pushPayload)
	if second.Code != http.StatusOK {
		t.Fatalf("unexpected second push status: %d", second.Code)
	}
	var secondResp pushResponse
	if err := json.Unmarshal(second.Body.Bytes(), &secondResp); err != nil {
		t.Fatalf("unmarshal second response: %v", err)
	}
	if secondResp.Accepted != 0 {
		t.Fatalf("expected accepted=0 on duplicate push, got %d", secondResp.Accepted)
	}
}

func TestSyncPushReturnsConflictForMissingAnnotation(t *testing.T) {
	syncHandler, accessToken := newSyncTestContext(t)

	pushPayload := map[string]any{
		"device_id":   "dev-1",
		"device_name": "MacBook",
		"platform":    "mac",
		"operations": []map[string]any{
			{
				"op_id":         "op-missing-ann",
				"op_type":       "update_comment",
				"url":           "https://example.com/post/missing",
				"annotation_id": "ann-not-found",
				"comment_text":  "updated",
			},
		},
	}

	pushRecorder := pushRequest(t, syncHandler, accessToken, pushPayload)
	if pushRecorder.Code != http.StatusOK {
		t.Fatalf("unexpected push status: %d, body: %s", pushRecorder.Code, pushRecorder.Body.String())
	}

	var pushResp pushResponse
	if err := json.Unmarshal(pushRecorder.Body.Bytes(), &pushResp); err != nil {
		t.Fatalf("unmarshal push response: %v", err)
	}
	if pushResp.Accepted != 0 {
		t.Fatalf("expected accepted=0, got %d", pushResp.Accepted)
	}
	if len(pushResp.Conflicts) != 1 {
		t.Fatalf("expected 1 conflict, got %d", len(pushResp.Conflicts))
	}
	if pushResp.Conflicts[0].OpID != "op-missing-ann" {
		t.Fatalf("unexpected conflict op id: %s", pushResp.Conflicts[0].OpID)
	}
}

func TestSyncMultiDeviceConvergence(t *testing.T) {
	syncHandler, accessToken := newSyncTestContext(t)
	const (
		url           = "https://example.com/post/convergence"
		annotationID  = "ann-cross-device-1"
		windowsDevice = "windows-device"
		macDevice     = "mac-device"
		opCreateID    = "win-op-create-1"
		opUpdateID    = "mac-op-update-1"
		opDeleteID    = "win-op-delete-1"
	)

	// Step 1: Windows creates annotation.
	createPush := pushRequest(t, syncHandler, accessToken, map[string]any{
		"device_id": windowsDevice,
		"platform":  "windows",
		"operations": []map[string]any{
			{
				"op_id":         opCreateID,
				"op_type":       "create",
				"url":           url,
				"annotation_id": annotationID,
				"title":         "Cross Device",
				"quote_text":    "hello",
				"prefix_text":   "",
				"suffix_text":   "",
				"start_offset":  2,
				"end_offset":    7,
				"comment_text":  "from windows",
			},
		},
	})
	if createPush.Code != http.StatusOK {
		t.Fatalf("unexpected create push status: %d, body: %s", createPush.Code, createPush.Body.String())
	}
	var createResp pushResponse
	if err := json.Unmarshal(createPush.Body.Bytes(), &createResp); err != nil {
		t.Fatalf("unmarshal create response: %v", err)
	}
	if createResp.Accepted != 1 {
		t.Fatalf("expected create accepted=1, got %d", createResp.Accepted)
	}

	// Step 2: mac pulls from cursor 0 and should receive create event.
	macPullCreate := pullRequest(t, syncHandler, accessToken, 0)
	if macPullCreate.Code != http.StatusOK {
		t.Fatalf("unexpected mac pull create status: %d, body: %s", macPullCreate.Code, macPullCreate.Body.String())
	}
	var macPullCreateResp pullResponse
	if err := json.Unmarshal(macPullCreate.Body.Bytes(), &macPullCreateResp); err != nil {
		t.Fatalf("unmarshal mac pull create response: %v", err)
	}
	if len(macPullCreateResp.Events) != 1 {
		t.Fatalf("expected 1 event on mac pull, got %d", len(macPullCreateResp.Events))
	}
	if macPullCreateResp.Events[0].OpID != opCreateID || macPullCreateResp.Events[0].DeviceID != windowsDevice {
		t.Fatalf("unexpected first event: %+v", macPullCreateResp.Events[0])
	}

	// Step 3: mac updates comment.
	updatePush := pushRequest(t, syncHandler, accessToken, map[string]any{
		"device_id": macDevice,
		"platform":  "mac",
		"operations": []map[string]any{
			{
				"op_id":         opUpdateID,
				"op_type":       "update_comment",
				"url":           url,
				"annotation_id": annotationID,
				"comment_text":  "updated on mac",
			},
		},
	})
	if updatePush.Code != http.StatusOK {
		t.Fatalf("unexpected update push status: %d, body: %s", updatePush.Code, updatePush.Body.String())
	}
	var updateResp pushResponse
	if err := json.Unmarshal(updatePush.Body.Bytes(), &updateResp); err != nil {
		t.Fatalf("unmarshal update response: %v", err)
	}
	if updateResp.Accepted != 1 {
		t.Fatalf("expected update accepted=1, got %d", updateResp.Accepted)
	}

	// Step 4: windows pulls from create cursor and should receive update event.
	windowsPullUpdate := pullRequest(t, syncHandler, accessToken, createResp.NextCursor)
	if windowsPullUpdate.Code != http.StatusOK {
		t.Fatalf("unexpected windows pull update status: %d, body: %s", windowsPullUpdate.Code, windowsPullUpdate.Body.String())
	}
	var windowsPullUpdateResp pullResponse
	if err := json.Unmarshal(windowsPullUpdate.Body.Bytes(), &windowsPullUpdateResp); err != nil {
		t.Fatalf("unmarshal windows pull update response: %v", err)
	}
	if len(windowsPullUpdateResp.Events) != 1 {
		t.Fatalf("expected 1 event on windows update pull, got %d", len(windowsPullUpdateResp.Events))
	}
	if windowsPullUpdateResp.Events[0].OpID != opUpdateID || windowsPullUpdateResp.Events[0].DeviceID != macDevice {
		t.Fatalf("unexpected update event: %+v", windowsPullUpdateResp.Events[0])
	}

	// Step 5: windows deletes annotation.
	deletePush := pushRequest(t, syncHandler, accessToken, map[string]any{
		"device_id": windowsDevice,
		"platform":  "windows",
		"operations": []map[string]any{
			{
				"op_id":         opDeleteID,
				"op_type":       "delete",
				"url":           url,
				"annotation_id": annotationID,
			},
		},
	})
	if deletePush.Code != http.StatusOK {
		t.Fatalf("unexpected delete push status: %d, body: %s", deletePush.Code, deletePush.Body.String())
	}
	var deleteResp pushResponse
	if err := json.Unmarshal(deletePush.Body.Bytes(), &deleteResp); err != nil {
		t.Fatalf("unmarshal delete response: %v", err)
	}
	if deleteResp.Accepted != 1 {
		t.Fatalf("expected delete accepted=1, got %d", deleteResp.Accepted)
	}

	// Step 6: mac pulls from update cursor and should receive delete event.
	macPullDelete := pullRequest(t, syncHandler, accessToken, updateResp.NextCursor)
	if macPullDelete.Code != http.StatusOK {
		t.Fatalf("unexpected mac pull delete status: %d, body: %s", macPullDelete.Code, macPullDelete.Body.String())
	}
	var macPullDeleteResp pullResponse
	if err := json.Unmarshal(macPullDelete.Body.Bytes(), &macPullDeleteResp); err != nil {
		t.Fatalf("unmarshal mac pull delete response: %v", err)
	}
	if len(macPullDeleteResp.Events) != 1 {
		t.Fatalf("expected 1 event on mac delete pull, got %d", len(macPullDeleteResp.Events))
	}
	if macPullDeleteResp.Events[0].OpID != opDeleteID || macPullDeleteResp.Events[0].DeviceID != windowsDevice {
		t.Fatalf("unexpected delete event: %+v", macPullDeleteResp.Events[0])
	}

	// Step 7: deleting again should be idempotent success.
	redeletePush := pushRequest(t, syncHandler, accessToken, map[string]any{
		"device_id": macDevice,
		"platform":  "mac",
		"operations": []map[string]any{
			{
				"op_id":         "mac-op-delete-again",
				"op_type":       "delete",
				"url":           url,
				"annotation_id": annotationID,
			},
		},
	})
	if redeletePush.Code != http.StatusOK {
		t.Fatalf("unexpected redelete push status: %d, body: %s", redeletePush.Code, redeletePush.Body.String())
	}
	var redeleteResp pushResponse
	if err := json.Unmarshal(redeletePush.Body.Bytes(), &redeleteResp); err != nil {
		t.Fatalf("unmarshal redelete response: %v", err)
	}
	if redeleteResp.Accepted != 1 {
		t.Fatalf("expected redelete accepted=1, got %d", redeleteResp.Accepted)
	}
	if len(redeleteResp.Conflicts) != 0 {
		t.Fatalf("expected no conflict for idempotent redelete, got %d", len(redeleteResp.Conflicts))
	}
}
