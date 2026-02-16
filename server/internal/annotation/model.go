package annotation

import "time"

type Status string

const (
	StatusActive  Status = "active"
	StatusDeleted Status = "deleted"
)

type Annotation struct {
	ID          string    `json:"id"`
	UserID      string    `json:"user_id,omitempty"`
	DocumentURL string    `json:"url"`
	Title       string    `json:"title"`
	QuoteText   string    `json:"quote_text"`
	PrefixText  string    `json:"prefix_text"`
	SuffixText  string    `json:"suffix_text"`
	StartOffset int       `json:"start_offset"`
	EndOffset   int       `json:"end_offset"`
	Color       string    `json:"color"`
	CommentText string    `json:"comment_text"`
	Status      Status    `json:"status"`
	Version     int       `json:"version"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

type CreateInput struct {
	AnnotationID string `json:"annotation_id,omitempty"`
	URL          string `json:"url"`
	Title        string `json:"title"`
	QuoteText    string `json:"quote_text"`
	PrefixText   string `json:"prefix_text"`
	SuffixText   string `json:"suffix_text"`
	StartOffset  int    `json:"start_offset"`
	EndOffset    int    `json:"end_offset"`
	Color        string `json:"color"`
	CommentText  string `json:"comment_text"`
}

type UpdateCommentInput struct {
	URL         string `json:"url"`
	CommentText string `json:"comment_text"`
	Color       string `json:"color"`
}
