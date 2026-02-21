package storage

import (
	"context"
	"database/sql"
	"errors"

	"github.com/rayo1uo/annota/server/internal/annotation"
)

type MySQLAnnotationRepository struct {
	db *sql.DB
}

func NewMySQLAnnotationRepository(db *sql.DB) *MySQLAnnotationRepository {
	return &MySQLAnnotationRepository{db: db}
}

func (r *MySQLAnnotationRepository) ListByURL(ctx context.Context, userID, url string) ([]annotation.Annotation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			a.id,
			a.user_id,
			d.url,
			COALESCE(d.title, ''),
			a.quote_text,
			COALESCE(a.prefix_text, ''),
			COALESCE(a.suffix_text, ''),
			a.start_offset,
			a.end_offset,
			a.color,
			COALESCE(a.comment_text, ''),
			a.status,
			a.version,
			a.created_at,
			a.updated_at
		FROM annotations a
		JOIN documents d ON d.id = a.document_id
		WHERE a.user_id = ?
		  AND d.url = ?
		  AND a.status = 'active'
		ORDER BY a.updated_at DESC
	`, userID, url)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]annotation.Annotation, 0)
	for rows.Next() {
		item, scanErr := scanAnnotation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *MySQLAnnotationRepository) ListByUser(ctx context.Context, userID string) ([]annotation.Annotation, error) {
	rows, err := r.db.QueryContext(ctx, `
		SELECT
			a.id,
			a.user_id,
			d.url,
			COALESCE(d.title, ''),
			a.quote_text,
			COALESCE(a.prefix_text, ''),
			COALESCE(a.suffix_text, ''),
			a.start_offset,
			a.end_offset,
			a.color,
			COALESCE(a.comment_text, ''),
			a.status,
			a.version,
			a.created_at,
			a.updated_at
		FROM annotations a
		JOIN documents d ON d.id = a.document_id
		WHERE a.user_id = ?
		  AND a.status = 'active'
		ORDER BY a.updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]annotation.Annotation, 0)
	for rows.Next() {
		item, scanErr := scanAnnotation(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}
	return result, nil
}

func (r *MySQLAnnotationRepository) Create(ctx context.Context, userID string, input annotation.CreateInput) (annotation.Annotation, error) {
	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return annotation.Annotation{}, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	documentID, err := r.getOrCreateDocument(ctx, tx, userID, input.URL, input.Title)
	if err != nil {
		return annotation.Annotation{}, err
	}

	annotationID := input.AnnotationID
	if annotationID == "" {
		annotationID, err = newResourceID("ann")
		if err != nil {
			return annotation.Annotation{}, err
		}
	}

	if input.Color == "" {
		input.Color = "#ffe58f"
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO annotations(
			id, user_id, document_id,
			quote_text, prefix_text, suffix_text,
			start_offset, end_offset,
			color, comment_text, status, version
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 1)
	`, annotationID, userID, documentID,
		input.QuoteText, input.PrefixText, input.SuffixText,
		input.StartOffset, input.EndOffset,
		input.Color, input.CommentText)
	if err != nil {
		return annotation.Annotation{}, err
	}

	if err := tx.Commit(); err != nil {
		return annotation.Annotation{}, err
	}

	return r.getByIDAndURL(ctx, userID, annotationID, input.URL)
}

func (r *MySQLAnnotationRepository) UpdateComment(ctx context.Context, userID, id string, input annotation.UpdateCommentInput) (annotation.Annotation, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE annotations a
		JOIN documents d ON d.id = a.document_id
		SET a.comment_text = ?,
			a.color = COALESCE(NULLIF(?, ''), a.color),
			a.version = a.version + 1,
			a.updated_at = CURRENT_TIMESTAMP(3)
		WHERE a.id = ?
		  AND a.user_id = ?
		  AND d.url = ?
		  AND a.status = 'active'
	`, input.CommentText, input.Color, id, userID, input.URL)
	if err != nil {
		return annotation.Annotation{}, err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return annotation.Annotation{}, err
	}
	if rows == 0 {
		return annotation.Annotation{}, ErrNotFound
	}

	return r.getByIDAndURL(ctx, userID, id, input.URL)
}

func (r *MySQLAnnotationRepository) Delete(ctx context.Context, userID, url, id string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE annotations a
		JOIN documents d ON d.id = a.document_id
		SET a.status = 'deleted',
			a.version = a.version + 1,
			a.updated_at = CURRENT_TIMESTAMP(3)
		WHERE a.id = ?
		  AND a.user_id = ?
		  AND d.url = ?
		  AND a.status = 'active'
	`, id, userID, url)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return ErrNotFound
	}
	return nil
}

func (r *MySQLAnnotationRepository) SoftDeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		UPDATE annotations
		SET status = 'deleted',
			version = version + 1,
			updated_at = CURRENT_TIMESTAMP(3)
		WHERE user_id = ?
		  AND status = 'active'
	`, userID)
	if err != nil {
		return 0, err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return 0, err
	}
	return rows, nil
}

func (r *MySQLAnnotationRepository) getByIDAndURL(ctx context.Context, userID, annotationID, url string) (annotation.Annotation, error) {
	row := r.db.QueryRowContext(ctx, `
		SELECT
			a.id,
			a.user_id,
			d.url,
			COALESCE(d.title, ''),
			a.quote_text,
			COALESCE(a.prefix_text, ''),
			COALESCE(a.suffix_text, ''),
			a.start_offset,
			a.end_offset,
			a.color,
			COALESCE(a.comment_text, ''),
			a.status,
			a.version,
			a.created_at,
			a.updated_at
		FROM annotations a
		JOIN documents d ON d.id = a.document_id
		WHERE a.user_id = ?
		  AND a.id = ?
		  AND d.url = ?
		LIMIT 1
	`, userID, annotationID, url)

	item, err := scanAnnotation(row)
	if errors.Is(err, sql.ErrNoRows) {
		return annotation.Annotation{}, ErrNotFound
	}
	if err != nil {
		return annotation.Annotation{}, err
	}
	return item, nil
}

func (r *MySQLAnnotationRepository) getOrCreateDocument(
	ctx context.Context,
	tx *sql.Tx,
	userID,
	url,
	title string,
) (string, error) {
	var documentID string
	err := tx.QueryRowContext(ctx, `
		SELECT id
		FROM documents
		WHERE user_id = ? AND url = ?
		LIMIT 1
	`, userID, url).Scan(&documentID)
	if err == nil {
		return documentID, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}

	documentID, err = newResourceID("doc")
	if err != nil {
		return "", err
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO documents(id, user_id, url, title)
		VALUES (?, ?, ?, ?)
	`, documentID, userID, url, title)
	if err != nil {
		return "", err
	}
	return documentID, nil
}

type scanner interface {
	Scan(dest ...any) error
}

func scanAnnotation(row scanner) (annotation.Annotation, error) {
	var item annotation.Annotation
	var status string
	err := row.Scan(
		&item.ID,
		&item.UserID,
		&item.DocumentURL,
		&item.Title,
		&item.QuoteText,
		&item.PrefixText,
		&item.SuffixText,
		&item.StartOffset,
		&item.EndOffset,
		&item.Color,
		&item.CommentText,
		&status,
		&item.Version,
		&item.CreatedAt,
		&item.UpdatedAt,
	)
	if err != nil {
		return annotation.Annotation{}, err
	}
	item.Status = annotation.Status(status)
	return item, nil
}
