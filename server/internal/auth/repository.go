package auth

import (
	"context"
	"errors"
)

var (
	ErrUserNotFound  = errors.New("user not found")
	ErrUserExists    = errors.New("user already exists")
	ErrTokenNotFound = errors.New("token not found")
)

type Repository interface {
	CreateUser(ctx context.Context, email, passwordHash string) (User, error)
	GetUserByEmail(ctx context.Context, email string) (User, error)
	GetUserByID(ctx context.Context, userID string) (User, error)
	StoreRefreshToken(ctx context.Context, token RefreshToken) error
	GetRefreshToken(ctx context.Context, rawToken string) (RefreshToken, error)
	RevokeRefreshToken(ctx context.Context, rawToken string) error
	RevokeAllRefreshTokensByUser(ctx context.Context, userID string) (int64, error)
}
