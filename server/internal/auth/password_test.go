package auth

import "testing"

func TestHashAndVerifyPassword(t *testing.T) {
	hashed, err := HashPassword("12345678")
	if err != nil {
		t.Fatalf("HashPassword failed: %v", err)
	}

	if !VerifyPassword("12345678", hashed) {
		t.Fatalf("expected password verification success")
	}

	if VerifyPassword("wrong", hashed) {
		t.Fatalf("expected password verification failure")
	}
}
