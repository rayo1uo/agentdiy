package storage

import (
	"context"
	"sync"
	"sync/atomic"
	"time"
)

type MemorySyncRepository struct {
	mu          sync.RWMutex
	sequence    atomic.Uint64
	events      map[string][]SyncEvent
	opDedupByID map[string]map[string]SyncEvent
}

func NewMemorySyncRepository() *MemorySyncRepository {
	return &MemorySyncRepository{
		events:      make(map[string][]SyncEvent),
		opDedupByID: make(map[string]map[string]SyncEvent),
	}
}

func (r *MemorySyncRepository) AppendEvent(_ context.Context, input AppendSyncEventInput) (SyncEvent, bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if input.UserID == "" || input.DeviceID == "" || input.OpID == "" || input.AnnotationID == "" {
		return SyncEvent{}, false, ErrInvalidSyncOperation
	}

	if _, exists := r.opDedupByID[input.UserID]; !exists {
		r.opDedupByID[input.UserID] = make(map[string]SyncEvent)
	}
	dedupeKey := input.DeviceID + ":" + input.OpID
	if existing, exists := r.opDedupByID[input.UserID][dedupeKey]; exists {
		return existing, false, nil
	}

	now := time.Now().UTC()
	event := SyncEvent{
		ID:           r.sequence.Add(1),
		UserID:       input.UserID,
		DeviceID:     input.DeviceID,
		OpID:         input.OpID,
		AnnotationID: input.AnnotationID,
		OpType:       input.OpType,
		Payload:      input.Payload,
		CreatedAt:    now,
	}

	r.events[input.UserID] = append(r.events[input.UserID], event)
	r.opDedupByID[input.UserID][dedupeKey] = event
	return event, true, nil
}

func (r *MemorySyncRepository) ListEvents(_ context.Context, userID string, afterCursor uint64, limit int) ([]SyncEvent, uint64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	if limit <= 0 {
		limit = 50
	}

	source := r.events[userID]
	result := make([]SyncEvent, 0, limit)
	nextCursor := afterCursor
	for _, event := range source {
		if event.ID <= afterCursor {
			continue
		}
		result = append(result, event)
		nextCursor = event.ID
		if len(result) >= limit {
			break
		}
	}

	return result, nextCursor, nil
}

func (r *MemorySyncRepository) LatestCursor(_ context.Context, userID string) (uint64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	events := r.events[userID]
	if len(events) == 0 {
		return 0, nil
	}
	return events[len(events)-1].ID, nil
}

func (r *MemorySyncRepository) DeleteAllByUser(_ context.Context, userID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	events := r.events[userID]
	affected := int64(len(events))
	delete(r.events, userID)
	delete(r.opDedupByID, userID)
	return affected, nil
}
