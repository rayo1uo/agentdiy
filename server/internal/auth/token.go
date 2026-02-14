package auth

import (
	"crypto/rand"
	"encoding/base64"
)

func GenerateRefreshToken() (string, error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	// base64: 每3个字节原始数据编码为4个字符，32字节原始数据编码为43个字符
	return base64.RawURLEncoding.EncodeToString(buffer), nil
}
