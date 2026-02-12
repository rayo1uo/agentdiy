package storage

import (
	"context"
	"errors"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
)

var ErrNotFound = errors.New("not found")

type AnnotationRepository interface {
	ListByURL(ctx context.Context, url string) ([]annotation.Annotation, error)
	Create(ctx context.Context, input annotation.CreateInput) (annotation.Annotation, error)
	UpdateComment(ctx context.Context, id string, input annotation.UpdateCommentInput) (annotation.Annotation, error)
	Delete(ctx context.Context, url, id string) error
}
