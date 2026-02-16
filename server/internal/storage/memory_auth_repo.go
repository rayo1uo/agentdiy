package storage

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rayo1uo/agentdiy/server/internal/auth"
)

type MemoryAuthRepository struct {
	mu            sync.RWMutex
	usersByID     map[string]auth.User
	userIDByEmail map[string]string
	refreshTokens map[string]auth.RefreshToken
	sequence      atomic.Uint64
}

func NewMemoryAuthRepository() *MemoryAuthRepository {
	return &MemoryAuthRepository{
		usersByID:     make(map[string]auth.User),
		userIDByEmail: make(map[string]string),
		refreshTokens: make(map[string]auth.RefreshToken),
	}
}

func (r *MemoryAuthRepository) CreateUser(_ context.Context, email, passwordHash string) (auth.User, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	normalized := strings.ToLower(strings.TrimSpace(email))
	if normalized == "" {
		return auth.User{}, fmt.Errorf("email is required")
	}

	if _, exists := r.userIDByEmail[normalized]; exists {
		return auth.User{}, auth.ErrUserExists
	}

	id := fmt.Sprintf("u_%d", r.sequence.Add(1))
	user := auth.User{
		ID:           id,
		Email:        normalized,
		PasswordHash: passwordHash,
		CreatedAt:    time.Now().UTC(),
	}
	r.usersByID[id] = user
	r.userIDByEmail[normalized] = id
	return user, nil
}

func (r *MemoryAuthRepository) GetUserByEmail(_ context.Context, email string) (auth.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	normalized := strings.ToLower(strings.TrimSpace(email))
	id, exists := r.userIDByEmail[normalized]
	if !exists {
		return auth.User{}, auth.ErrUserNotFound
	}
	user, ok := r.usersByID[id]
	if !ok {
		return auth.User{}, auth.ErrUserNotFound
	}
	return user, nil
}

func (r *MemoryAuthRepository) GetUserByID(_ context.Context, userID string) (auth.User, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	user, exists := r.usersByID[userID]
	if !exists {
		return auth.User{}, auth.ErrUserNotFound
	}
	return user, nil
}

func (r *MemoryAuthRepository) StoreRefreshToken(_ context.Context, token auth.RefreshToken) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	r.refreshTokens[token.Token] = token
	return nil
}

func (r *MemoryAuthRepository) GetRefreshToken(_ context.Context, rawToken string) (auth.RefreshToken, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()

	token, exists := r.refreshTokens[rawToken]
	if !exists {
		return auth.RefreshToken{}, auth.ErrTokenNotFound
	}
	return token, nil
}

func (r *MemoryAuthRepository) RevokeRefreshToken(_ context.Context, rawToken string) error {
	r.mu.Lock()
	defer r.mu.Unlock()

	token, exists := r.refreshTokens[rawToken]
	if !exists {
		return auth.ErrTokenNotFound
	}

	now := time.Now().UTC()
	token.RevokedAt = &now
	r.refreshTokens[rawToken] = token
	return nil
}

func (r *MemoryAuthRepository) RevokeAllRefreshTokensByUser(_ context.Context, userID string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()

	var affected int64
	now := time.Now().UTC()
	for tokenKey, token := range r.refreshTokens {
		if token.UserID != userID || token.RevokedAt != nil {
			continue
		}
		token.RevokedAt = &now
		r.refreshTokens[tokenKey] = token
		affected++
	}

	return affected, nil
}
