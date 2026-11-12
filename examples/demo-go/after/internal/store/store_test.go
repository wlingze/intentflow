package store

import "testing"

func TestFindUserQuotesInput(t *testing.T) {
	got, err := FindUser("'; DROP TABLE users; --")
	if err != nil {
		t.Fatalf("query failed: %v", err)
	}
	if got != "" {
		t.Fatalf("unexpected id %q", got)
	}
}
