package storage

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
)

type MemoryAnnotationRepository struct {
	mu       sync.RWMutex
	items    map[string]map[string][]annotation.Annotation
	sequence atomic.Uint64
}

func NewMemoryAnnotationRepository() *MemoryAnnotationRepository {
	return &MemoryAnnotationRepository{
		items: make(map[string]map[string][]annotation.Annotation),
	}
}

func (r *MemoryAnnotationRepository) ListByURL(_ context.Context, userID, url string) ([]annotation.Annotation, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	userItems := r.items[userID]
	source := userItems[url]
	result := make([]annotation.Annotation, 0, len(source))
	for _, item := range source {
		if item.Status == annotation.StatusActive {
			result = append(result, item)
		}
	}

	return result, nil
}

func (r *MemoryAnnotationRepository) Create(_ context.Context, userID string, input annotation.CreateInput) (annotation.Annotation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	if _, exists := r.items[userID]; !exists {
		r.items[userID] = make(map[string][]annotation.Annotation)
	}

	now := time.Now().UTC()
	identifier := input.AnnotationID
	if identifier == "" {
		identifier = fmt.Sprintf("%d", r.sequence.Add(1))
	}
	if input.Color == "" {
		input.Color = "#ffe58f"
	}

	item := annotation.Annotation{
		ID:          identifier,
		UserID:      userID,
		DocumentURL: input.URL,
		Title:       input.Title,
		QuoteText:   input.QuoteText,
		PrefixText:  input.PrefixText,
		SuffixText:  input.SuffixText,
		StartOffset: input.StartOffset,
		EndOffset:   input.EndOffset,
		Color:       input.Color,
		CommentText: input.CommentText,
		Status:      annotation.StatusActive,
		Version:     1,
		CreatedAt:   now,
		UpdatedAt:   now,
	}

	r.items[userID][input.URL] = append(r.items[userID][input.URL], item)
	return item, nil
}

func (r *MemoryAnnotationRepository) UpdateComment(_ context.Context, userID, id string, input annotation.UpdateCommentInput) (annotation.Annotation, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	userItems := r.items[userID]
	items := userItems[input.URL]
	for index := range items {
		if items[index].ID != id || items[index].Status != annotation.StatusActive {
			continue
		}

		items[index].CommentText = input.CommentText
		items[index].Version++
		items[index].UpdatedAt = time.Now().UTC()
		r.items[userID][input.URL] = items
		return items[index], nil
	}

	return annotation.Annotation{}, ErrNotFound
}

func (r *MemoryAnnotationRepository) Delete(_ context.Context, userID, url, id string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	userItems := r.items[userID]
	items := userItems[url]
	for index := range items {
		if items[index].ID != id || items[index].Status != annotation.StatusActive {
			continue
		}

		items[index].Status = annotation.StatusDeleted
		items[index].Version++
		items[index].UpdatedAt = time.Now().UTC()
		r.items[userID][url] = items
		return nil
	}

	return ErrNotFound
}

func (r *MemoryAnnotationRepository) SoftDeleteAllByUser(_ context.Context, userID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	userItems := r.items[userID]
	if userItems == nil {
		return 0, nil
	}

	var affected int64
	now := time.Now().UTC()
	for url, items := range userItems {
		for index := range items {
			if items[index].Status != annotation.StatusActive {
				continue
			}
			items[index].Status = annotation.StatusDeleted
			items[index].Version++
			items[index].UpdatedAt = now
			affected++
		}
		userItems[url] = items
	}
	r.items[userID] = userItems
	return affected, nil
}
