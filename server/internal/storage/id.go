package storage

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"time"
)

func newResourceID(prefix string) (string, error) {
	buffer := make([]byte, 10)
	if _, err := rand.Read(buffer); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s_%d_%s", prefix, time.Now().UTC().UnixMilli(), hex.EncodeToString(buffer)), nil
}
