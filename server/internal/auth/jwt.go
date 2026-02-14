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
	Sub string `json:"sub"` // 用户ID
	Eml string `json:"eml"` // 用户邮箱
	Iat int64  `json:"iat"` // 签发时间，Unix时间戳
	Exp int64  `json:"exp"` // 过期时间，Unix时间戳
}

// 签发JWT Token, 返回Token字符串以及Token过期时间
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

// 解析JWT Token获得AccessClaims
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
