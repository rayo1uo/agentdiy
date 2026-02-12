package web

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

func NowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func WriteJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func WriteOK(w http.ResponseWriter, payload any) {
	WriteJSON(w, http.StatusOK, payload)
}

func WriteError(w http.ResponseWriter, status int, message string) {
	WriteJSON(w, status, map[string]string{"error": message})
}

func WriteMethodNotAllowed(w http.ResponseWriter, allowed ...string) {
	if len(allowed) > 0 {
		w.Header().Set("Allow", strings.Join(allowed, ", "))
	}
	WriteError(w, http.StatusMethodNotAllowed, "method not allowed")
}

func DecodeJSON(r *http.Request, target any) error {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	return decoder.Decode(target)
}
