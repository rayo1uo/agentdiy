package storage

import "testing"

func TestNewResourceID_UsesFixedLengthAndPrefix(t *testing.T) {
	id, err := newResourceID("usr")
	if err != nil {
		t.Fatalf("newResourceID failed: %v", err)
	}

	if len(id) != 36 {
		t.Fatalf("expected ID length 36, got %d (%s)", len(id), id)
	}

	if id[:4] != "usr_" {
		t.Fatalf("expected prefix usr_, got %s", id[:4])
	}
}

func TestNormalizeIDPrefix_NormalizesAndPads(t *testing.T) {
	tests := []struct {
		name   string
		input  string
		expect string
	}{
		{name: "trim and lowercase", input: "  Doc ", expect: "doc"},
		{name: "remove symbols", input: "a-_", expect: "axx"},
		{name: "truncate to three", input: "document", expect: "doc"},
		{name: "empty", input: "", expect: "xxx"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if actual := normalizeIDPrefix(test.input); actual != test.expect {
				t.Fatalf("expected %s, got %s", test.expect, actual)
			}
		})
	}
}

