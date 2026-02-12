package storage

import (
	"context"
	"encoding/json"
	"errors"
	"time"
)

var ErrInvalidSyncOperation = errors.New("invalid sync operation")

type SyncOperationType string

const (
	SyncOperationCreate        SyncOperationType = "create"
	SyncOperationUpdateComment SyncOperationType = "update_comment"
	SyncOperationDelete        SyncOperationType = "delete"
)

type SyncEvent struct {
	ID           uint64            `json:"id"`
	UserID       string            `json:"user_id"`
	DeviceID     string            `json:"device_id"`
	OpID         string            `json:"op_id"`
	AnnotationID string            `json:"annotation_id"`
	OpType       SyncOperationType `json:"op_type"`
	Payload      json.RawMessage   `json:"payload"`
	CreatedAt    time.Time         `json:"created_at"`
}

type AppendSyncEventInput struct {
	UserID       string
	DeviceID     string
	DeviceName   string
	Platform     string
	OpID         string
	AnnotationID string
	OpType       SyncOperationType
	Payload      json.RawMessage
}

type SyncRepository interface {
	AppendEvent(ctx context.Context, input AppendSyncEventInput) (SyncEvent, bool, error)
	ListEvents(ctx context.Context, userID string, afterCursor uint64, limit int) ([]SyncEvent, uint64, error)
	LatestCursor(ctx context.Context, userID string) (uint64, error)
	DeleteAllByUser(ctx context.Context, userID string) (int64, error)
}
