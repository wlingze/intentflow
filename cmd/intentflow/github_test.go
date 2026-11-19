package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
)

func TestReviewEvent(t *testing.T) {
	cases := map[string]string{
		"":                "COMMENT",
		"comment":         "COMMENT",
		"approve":         "APPROVE",
		"request-changes": "REQUEST_CHANGES",
		"REQUEST_CHANGES": "REQUEST_CHANGES",
		"Request Changes": "REQUEST_CHANGES",
	}
	for input, want := range cases {
		got, err := reviewEvent(input)
		if err != nil || got != want {
			t.Fatalf("%q -> %q, %v", input, got, err)
		}
	}
	if _, err := reviewEvent("merge"); err == nil {
		t.Fatal("accepted unknown event")
	}
}

func TestParseGithubTarget(t *testing.T) {
	target, err := parseGithubTarget("owner/repo", 4)
	if err != nil || target.owner != "owner" || target.repo != "repo" || target.number != 4 || target.full != "owner/repo" {
		t.Fatalf("target = %+v, %v", target, err)
	}
	for _, item := range []struct {
		repo   string
		number int
	}{{"owner", 4}, {"owner/repo", 0}, {"../repo", 1}, {"owner/repo/x", 1}} {
		if _, err := parseGithubTarget(item.repo, item.number); err == nil {
			t.Fatalf("accepted %q #%d", item.repo, item.number)
		}
	}
}

func TestReadReviewDocument(t *testing.T) {
	path := filepath.Join(t.TempDir(), "review.json")
	if err := os.WriteFile(path, []byte(`{"version":1,"context":{},"comments":[{"id":"1","text":"hi","title":"","source":"manual","signalId":"","createdAt":0,"quote":{"file":"a.go","side":"after","start":2,"end":3,"snippet":""}}],"viewed":[],"reviewed_hunks":[],"updated_at":""}`), 0o644); err != nil {
		t.Fatal(err)
	}
	doc, err := readReviewDocument(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(doc.Comments) != 1 || doc.Comments[0].Quote == nil || doc.Comments[0].Quote.End != 3 {
		t.Fatalf("doc = %+v", doc)
	}
	if _, err := readReviewDocument(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("accepted a missing file")
	}
}

func TestValidateReviewTarget(t *testing.T) {
	target := githubTarget{owner: "o", repo: "r", number: 4, full: "o/r"}
	ok := contract.ReviewSession{Context: contract.ReviewContext{Repository: "github.com/o/r", Branch: "pull/4"}}
	if err := validateReviewTarget(ok, target); err != nil {
		t.Fatal(err)
	}
	badRepo := contract.ReviewSession{Context: contract.ReviewContext{Repository: "github.com/o/other", Branch: "pull/4"}}
	if err := validateReviewTarget(badRepo, target); err == nil {
		t.Fatal("accepted another repository")
	}
	badPR := contract.ReviewSession{Context: contract.ReviewContext{Repository: "github.com/o/r", Branch: "pull/5"}}
	if err := validateReviewTarget(badPR, target); err == nil {
		t.Fatal("accepted another PR")
	}
}
