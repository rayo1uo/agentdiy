package storage

import (
	"context"
	"encoding/json"
	"testing"
)

func TestMemorySyncRepository_DedupAndCursor(t *testing.T) {
	repo := NewMemorySyncRepository()
	ctx := context.Background()

	input := AppendSyncEventInput{
		UserID:       "u1",
		DeviceID:     "d1",
		OpID:         "op-1",
		AnnotationID: "ann-1",
		OpType:       SyncOperationCreate,
		Payload:      json.RawMessage(`{"k":"v"}`),
	}

	event1, created1, err := repo.AppendEvent(ctx, input)
	if err != nil {
		t.Fatalf("AppendEvent failed: %v", err)
	}
	if !created1 {
		t.Fatalf("expected first append to be created")
	}

	event2, created2, err := repo.AppendEvent(ctx, input)
	if err != nil {
		t.Fatalf("AppendEvent duplicate failed: %v", err)
	}
	if created2 {
		t.Fatalf("expected duplicate append to be idempotent")
	}
	if event2.ID != event1.ID {
		t.Fatalf("expected same event ID for duplicate append")
	}

	events, nextCursor, err := repo.ListEvents(ctx, "u1", 0, 50)
	if err != nil {
		t.Fatalf("ListEvents failed: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("expected one event, got %d", len(events))
	}
	if nextCursor != events[0].ID {
		t.Fatalf("unexpected nextCursor: %d", nextCursor)
	}

	eventsAfterCursor, nextCursorAfter, err := repo.ListEvents(ctx, "u1", nextCursor, 50)
	if err != nil {
		t.Fatalf("ListEvents after cursor failed: %v", err)
	}
	if len(eventsAfterCursor) != 0 {
		t.Fatalf("expected zero events after cursor")
	}
	if nextCursorAfter != nextCursor {
		t.Fatalf("expected cursor to stay unchanged")
	}
}
