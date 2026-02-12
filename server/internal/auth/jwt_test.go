package auth

import (
	"testing"
	"time"
)

func TestGenerateAndParseAccessToken(t *testing.T) {
	secret := "unit-test-secret"
	token, _, err := GenerateAccessToken(secret, "user-1", "u@example.com", 2*time.Minute)
	if err != nil {
		t.Fatalf("GenerateAccessToken failed: %v", err)
	}

	claims, err := ParseAccessToken(secret, token)
	if err != nil {
		t.Fatalf("ParseAccessToken failed: %v", err)
	}

	if claims.Sub != "user-1" || claims.Eml != "u@example.com" {
		t.Fatalf("unexpected claims: %+v", claims)
	}
}
