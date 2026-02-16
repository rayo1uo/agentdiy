package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/rayo1uo/agentdiy/server/internal/auth"
	"github.com/rayo1uo/agentdiy/server/internal/storage"
)

func TestServiceRegisterLoginRefreshLogout(t *testing.T) {
	repo := storage.NewMemoryAuthRepository()
	svc := auth.NewService(repo, "service-test-secret", 5*time.Minute, 24*time.Hour)
	ctx := context.Background()

	user, pair, err := svc.Register(ctx, "demo@example.com", "12345678")
	if err != nil {
		t.Fatalf("Register failed: %v", err)
	}
	if user.Email != "demo@example.com" {
		t.Fatalf("unexpected user email: %s", user.Email)
	}
	if pair.AccessToken == "" || pair.RefreshToken == "" {
		t.Fatalf("missing token pair")
	}

	if _, _, err = svc.Login(ctx, "demo@example.com", "bad-password"); err == nil {
		t.Fatalf("expected login failure for invalid password")
	}

	_, loginPair, err := svc.Login(ctx, "demo@example.com", "12345678")
	if err != nil {
		t.Fatalf("Login failed: %v", err)
	}

	_, refreshedPair, err := svc.Refresh(ctx, loginPair.RefreshToken)
	if err != nil {
		t.Fatalf("Refresh failed: %v", err)
	}
	if refreshedPair.RefreshToken == loginPair.RefreshToken {
		t.Fatalf("expected rotated refresh token")
	}

	if err := svc.Logout(ctx, refreshedPair.RefreshToken); err != nil {
		t.Fatalf("Logout failed: %v", err)
	}

	if _, _, err = svc.Refresh(ctx, refreshedPair.RefreshToken); err == nil {
		t.Fatalf("expected refresh failure after logout")
	}
}
