package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"strings"
	"unicode"
)

func newResourceID(prefix string) (string, error) {
	buffer := make([]byte, 16)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}

	normalizedPrefix := normalizeIDPrefix(prefix)
	// 16进制编码会将16字节的buffer编码为32个字符
	return fmt.Sprintf("%s_%s", normalizedPrefix, hex.EncodeToString(buffer)), nil
}

func normalizeIDPrefix(prefix string) string {
	trimmed := strings.TrimSpace(strings.ToLower(prefix))
	filtered := make([]rune, 0, len(trimmed))
	for _, char := range trimmed {
		if unicode.IsDigit(char) || (char >= 'a' && char <= 'z') {
			filtered = append(filtered, char)
		}
		if len(filtered) == 3 {
			break
		}
	}

	for len(filtered) < 3 {
		filtered = append(filtered, 'x')
	}

	return string(filtered)
}
