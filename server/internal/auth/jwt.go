package auth

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
)

var (
	ErrInvalidToken = errors.New("invalid token")
	ErrTokenExpired = errors.New("token expired")
)

type AccessClaims struct {
	Sub string `json:"sub"`
	Eml string `json:"eml"`
	Iat int64  `json:"iat"`
	Exp int64  `json:"exp"`
}

func GenerateAccessToken(secret, userID, email string, ttl time.Duration) (string, int64, error) {
	now := time.Now().UTC()
	expiresAt := now.Add(ttl)
	claims := AccessClaims{
		Sub: userID,
		Eml: email,
		Iat: now.Unix(),
		Exp: expiresAt.Unix(),
	}

	headerBytes, err := json.Marshal(map[string]string{
		"alg": "HS256",
		"typ": "JWT",
	})
	if err != nil {
		return "", 0, fmt.Errorf("marshal header: %w", err)
	}

	payloadBytes, err := json.Marshal(claims)
	if err != nil {
		return "", 0, fmt.Errorf("marshal claims: %w", err)
	}

	header := base64.RawURLEncoding.EncodeToString(headerBytes)
	payload := base64.RawURLEncoding.EncodeToString(payloadBytes)
	unsigned := header + "." + payload
	signature := signJWT(secret, unsigned)
	token := unsigned + "." + signature

	return token, int64(ttl.Seconds()), nil
}

func ParseAccessToken(secret, token string) (AccessClaims, error) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return AccessClaims{}, ErrInvalidToken
	}

	unsigned := parts[0] + "." + parts[1]
	expectedSig := signJWT(secret, unsigned)
	if !hmac.Equal([]byte(parts[2]), []byte(expectedSig)) {
		return AccessClaims{}, ErrInvalidToken
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return AccessClaims{}, ErrInvalidToken
	}

	var claims AccessClaims
	if err := json.Unmarshal(payloadBytes, &claims); err != nil {
		return AccessClaims{}, ErrInvalidToken
	}

	if claims.Exp <= time.Now().UTC().Unix() {
		return AccessClaims{}, ErrTokenExpired
	}

	if claims.Sub == "" || claims.Eml == "" {
		return AccessClaims{}, ErrInvalidToken
	}

	return claims, nil
}

func signJWT(secret, unsigned string) string {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(unsigned))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}
