package storage

import (
	"context"
	"database/sql"
	"errors"
	"strings"

	"github.com/luoyu15/agentdiy/server/internal/auth"
)

type MySQLAuthRepository struct {
	db *sql.DB
}

func NewMySQLAuthRepository(db *sql.DB) *MySQLAuthRepository {
	return &MySQLAuthRepository{db: db}
}

func (r *MySQLAuthRepository) CreateUser(ctx context.Context, email, passwordHash string) (auth.User, error) {
	id, err := newResourceID("usr")
	if err != nil {
		return auth.User{}, err
	}
	email = strings.ToLower(strings.TrimSpace(email))

	_, err = r.db.ExecContext(ctx, `
		INSERT INTO users(id, email, password_hash)
		VALUES (?, ?, ?)
	`, id, email, passwordHash)
	if err != nil {
		if isDuplicateKey(err) {
			return auth.User{}, auth.ErrUserExists
		}
		return auth.User{}, err
	}

	return r.GetUserByID(ctx, id)
}

func (r *MySQLAuthRepository) GetUserByEmail(ctx context.Context, email string) (auth.User, error) {
	email = strings.ToLower(strings.TrimSpace(email))
	var user auth.User
	err := r.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, created_at
		FROM users
		WHERE email = ?
		LIMIT 1
	`, email).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.User{}, auth.ErrUserNotFound
	}
	if err != nil {
		return auth.User{}, err
	}
	return user, nil
}

func (r *MySQLAuthRepository) GetUserByID(ctx context.Context, userID string) (auth.User, error) {
	var user auth.User
	err := r.db.QueryRowContext(ctx, `
		SELECT id, email, password_hash, created_at
		FROM users
		WHERE id = ?
		LIMIT 1
	`, userID).Scan(&user.ID, &user.Email, &user.PasswordHash, &user.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.User{}, auth.ErrUserNotFound
	}
	if err != nil {
		return auth.User{}, err
	}
	return user, nil
}

func (r *MySQLAuthRepository) StoreRefreshToken(ctx context.Context, token auth.RefreshToken) error {
	_, err := r.db.ExecContext(ctx, `
		INSERT INTO refresh_tokens(token, user_id, expires_at, created_at, revoked_at)
		VALUES (?, ?, ?, ?, ?)
	`, token.Token, token.UserID, token.ExpiresAt, token.CreatedAt, token.RevokedAt)
	return err
}

func (r *MySQLAuthRepository) GetRefreshToken(ctx context.Context, rawToken string) (auth.RefreshToken, error) {
	var token auth.RefreshToken
	err := r.db.QueryRowContext(ctx, `
		SELECT token, user_id, expires_at, created_at, revoked_at
		FROM refresh_tokens
		WHERE token = ?
		LIMIT 1
	`, rawToken).Scan(&token.Token, &token.UserID, &token.ExpiresAt, &token.CreatedAt, &token.RevokedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return auth.RefreshToken{}, auth.ErrTokenNotFound
	}
	if err != nil {
		return auth.RefreshToken{}, err
	}
	return token, nil
}

func (r *MySQLAuthRepository) RevokeRefreshToken(ctx context.Context, rawToken string) error {
	result, err := r.db.ExecContext(ctx, `
		UPDATE refresh_tokens
		SET revoked_at = CURRENT_TIMESTAMP(3)
		WHERE token = ? AND revoked_at IS NULL
	`, rawToken)
	if err != nil {
		return err
	}

	rows, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rows == 0 {
		return auth.ErrTokenNotFound
	}
	return nil
}
