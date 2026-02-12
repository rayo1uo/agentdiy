package storage

import (
	"context"
	"errors"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
)

var ErrNotFound = errors.New("not found")

type AnnotationRepository interface {
	ListByURL(ctx context.Context, userID, url string) ([]annotation.Annotation, error)
	Create(ctx context.Context, userID string, input annotation.CreateInput) (annotation.Annotation, error)
	UpdateComment(ctx context.Context, userID, id string, input annotation.UpdateCommentInput) (annotation.Annotation, error)
	Delete(ctx context.Context, userID, url, id string) error
	SoftDeleteAllByUser(ctx context.Context, userID string) (int64, error)
}
