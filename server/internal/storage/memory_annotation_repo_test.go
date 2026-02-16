package storage

import (
	"context"
	"testing"

	"github.com/luoyu15/agentdiy/server/internal/annotation"
)

func TestMemoryAnnotationRepositoryUpdateCommentUpdatesColorWhenProvided(t *testing.T) {
	repo := NewMemoryAnnotationRepository()
	const (
		userID = "user-1"
		url    = "https://example.com/page"
	)

	created, err := repo.Create(context.Background(), userID, annotation.CreateInput{
		URL:         url,
		Title:       "Example",
		QuoteText:   "hello",
		StartOffset: 1,
		EndOffset:   6,
		Color:       "#ffe58f",
		CommentText: "before",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	updated, err := repo.UpdateComment(context.Background(), userID, created.ID, annotation.UpdateCommentInput{
		URL:         url,
		CommentText: "after",
		Color:       "#86efac",
	})
	if err != nil {
		t.Fatalf("UpdateComment() error = %v", err)
	}

	if updated.CommentText != "after" {
		t.Fatalf("expected comment to update, got %q", updated.CommentText)
	}
	if updated.Color != "#86efac" {
		t.Fatalf("expected color to update, got %q", updated.Color)
	}
}

func TestMemoryAnnotationRepositoryUpdateCommentKeepsColorWhenOmitted(t *testing.T) {
	repo := NewMemoryAnnotationRepository()
	const (
		userID = "user-1"
		url    = "https://example.com/page"
	)

	created, err := repo.Create(context.Background(), userID, annotation.CreateInput{
		URL:         url,
		Title:       "Example",
		QuoteText:   "hello",
		StartOffset: 1,
		EndOffset:   6,
		Color:       "#bfdbfe",
		CommentText: "before",
	})
	if err != nil {
		t.Fatalf("Create() error = %v", err)
	}

	updated, err := repo.UpdateComment(context.Background(), userID, created.ID, annotation.UpdateCommentInput{
		URL:         url,
		CommentText: "after",
	})
	if err != nil {
		t.Fatalf("UpdateComment() error = %v", err)
	}

	if updated.CommentText != "after" {
		t.Fatalf("expected comment to update, got %q", updated.CommentText)
	}
	if updated.Color != "#bfdbfe" {
		t.Fatalf("expected color to remain unchanged, got %q", updated.Color)
	}
}
