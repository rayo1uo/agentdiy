package storage

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
)

type MySQLSyncRepository struct {
	db *sql.DB
}

func NewMySQLSyncRepository(db *sql.DB) *MySQLSyncRepository {
	return &MySQLSyncRepository{db: db}
}

func (r *MySQLSyncRepository) AppendEvent(ctx context.Context, input AppendSyncEventInput) (SyncEvent, bool, error) {
	if input.UserID == "" || input.DeviceID == "" || input.OpID == "" || input.AnnotationID == "" {
		return SyncEvent{}, false, ErrInvalidSyncOperation
	}

	tx, err := r.db.BeginTx(ctx, nil)
	if err != nil {
		return SyncEvent{}, false, err
	}
	defer func() {
		_ = tx.Rollback()
	}()

	if err := r.ensureDevice(ctx, tx, input); err != nil {
		return SyncEvent{}, false, err
	}

	existing, err := r.findByOperation(ctx, tx, input.UserID, input.DeviceID, input.OpID)
	if err == nil {
		if err := tx.Commit(); err != nil {
			return SyncEvent{}, false, err
		}
		return existing, false, nil
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return SyncEvent{}, false, err
	}

	result, err := tx.ExecContext(ctx, `
		INSERT INTO sync_events(user_id, device_id, op_id, annotation_id, op_type, payload_json)
		VALUES (?, ?, ?, ?, ?, ?)
	`, input.UserID, input.DeviceID, input.OpID, input.AnnotationID, string(input.OpType), input.Payload)
	if err != nil {
		if isDuplicateKey(err) {
			existing, findErr := r.findByOperation(ctx, tx, input.UserID, input.DeviceID, input.OpID)
			if findErr != nil {
				return SyncEvent{}, false, findErr
			}
			if err := tx.Commit(); err != nil {
				return SyncEvent{}, false, err
			}
			return existing, false, nil
		}
		return SyncEvent{}, false, err
	}

	insertedID, err := result.LastInsertId()
	if err != nil {
		return SyncEvent{}, false, err
	}

	event, err := r.findByID(ctx, tx, uint64(insertedID))
	if err != nil {
		return SyncEvent{}, false, err
	}

	if err := tx.Commit(); err != nil {
		return SyncEvent{}, false, err
	}
	return event, true, nil
}

func (r *MySQLSyncRepository) ListEvents(ctx context.Context, userID string, afterCursor uint64, limit int) ([]SyncEvent, uint64, error) {
	if limit <= 0 {
		limit = 50
	}

	rows, err := r.db.QueryContext(ctx, `
		SELECT id, user_id, device_id, op_id, annotation_id, op_type, payload_json, created_at
		FROM sync_events
		WHERE user_id = ? AND id > ?
		ORDER BY id ASC
		LIMIT ?
	`, userID, afterCursor, limit)
	if err != nil {
		return nil, afterCursor, err
	}
	defer rows.Close()

	result := make([]SyncEvent, 0, limit)
	nextCursor := afterCursor
	for rows.Next() {
		event, scanErr := scanSyncEvent(rows)
		if scanErr != nil {
			return nil, afterCursor, scanErr
		}
		result = append(result, event)
		nextCursor = event.ID
	}
	if err := rows.Err(); err != nil {
		return nil, afterCursor, err
	}

	return result, nextCursor, nil
}

func (r *MySQLSyncRepository) LatestCursor(ctx context.Context, userID string) (uint64, error) {
	var cursor sql.NullInt64
	err := r.db.QueryRowContext(ctx, `
		SELECT MAX(id)
		FROM sync_events
		WHERE user_id = ?
	`, userID).Scan(&cursor)
	if err != nil {
		return 0, err
	}
	if !cursor.Valid {
		return 0, nil
	}
	return uint64(cursor.Int64), nil
}

func (r *MySQLSyncRepository) DeleteAllByUser(ctx context.Context, userID string) (int64, error) {
	result, err := r.db.ExecContext(ctx, `
		DELETE FROM sync_events
		WHERE user_id = ?
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

func (r *MySQLSyncRepository) ensureDevice(ctx context.Context, tx *sql.Tx, input AppendSyncEventInput) error {
	deviceName := input.DeviceName
	if deviceName == "" {
		deviceName = input.DeviceID
	}
	platform := input.Platform
	if platform == "" {
		platform = "unknown"
	}

	_, err := tx.ExecContext(ctx, `
		INSERT INTO devices(id, user_id, device_name, platform, last_seen_at)
		VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))
		ON DUPLICATE KEY UPDATE
			device_name = VALUES(device_name),
			platform = VALUES(platform),
			last_seen_at = CURRENT_TIMESTAMP(3)
	`, input.DeviceID, input.UserID, deviceName, platform)
	return err
}

func (r *MySQLSyncRepository) findByOperation(ctx context.Context, tx *sql.Tx, userID, deviceID, opID string) (SyncEvent, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, user_id, device_id, op_id, annotation_id, op_type, payload_json, created_at
		FROM sync_events
		WHERE user_id = ? AND device_id = ? AND op_id = ?
		LIMIT 1
	`, userID, deviceID, opID)
	return scanSyncEvent(row)
}

func (r *MySQLSyncRepository) findByID(ctx context.Context, tx *sql.Tx, id uint64) (SyncEvent, error) {
	row := tx.QueryRowContext(ctx, `
		SELECT id, user_id, device_id, op_id, annotation_id, op_type, payload_json, created_at
		FROM sync_events
		WHERE id = ?
		LIMIT 1
	`, id)
	return scanSyncEvent(row)
}

type syncRowScanner interface {
	Scan(dest ...any) error
}

func scanSyncEvent(scanner syncRowScanner) (SyncEvent, error) {
	var event SyncEvent
	var opType string
	var payload []byte
	if err := scanner.Scan(
		&event.ID,
		&event.UserID,
		&event.DeviceID,
		&event.OpID,
		&event.AnnotationID,
		&opType,
		&payload,
		&event.CreatedAt,
	); err != nil {
		return SyncEvent{}, err
	}

	event.OpType = SyncOperationType(opType)
	event.Payload = json.RawMessage(payload)
	return event, nil
}
