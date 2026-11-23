package prdiff

import (
	"context"
	"errors"
	"strings"
	"testing"
)

func TestParseRef(t *testing.T) {
	for _, raw := range []string{"wlingze/intentflow#42", "https://github.com/wlingze/intentflow/pull/42", "https://github.com/wlingze/intentflow/pull/42/"} {
		ref, err := ParseRef(raw)
		if err != nil {
			t.Fatalf("%s: %v", raw, err)
		}
		if ref.Repository() != "wlingze/intentflow" || ref.Number != 42 || ref.ID() != "pr:wlingze/intentflow#42" {
			t.Fatalf("%s: %+v", raw, ref)
		}
	}
	for _, raw := range []string{"", "wlingze/intentflow", "#12", "wlingze/intentflow#0", "https://gitlab.com/a/b/pull/1"} {
		if _, err := ParseRef(raw); err == nil {
			t.Fatalf("%q accepted", raw)
		}
	}
}

func TestFetchUsesGhAndView(t *testing.T) {
	patch := "diff --git a/x.go b/x.go\nindex 1111111..2222222 100644\n--- a/x.go\n+++ b/x.go\n@@ -1 +1 @@\n-old\n+new\n"
	fetcher := Fetcher{RunGh: func(ctx context.Context, args ...string) ([]byte, error) {
		if len(args) > 1 && args[1] == "diff" {
			return []byte(patch), nil
		}
		if len(args) > 1 && args[1] == "view" {
			return []byte(`{"number":7,"title":"Fix","url":"https://github.com/o/r/pull/7","state":"OPEN","baseRefName":"main","headRefName":"fix","baseRefOid":"aaaa","headRefOid":"bbbb"}`), nil
		}
		return nil, errors.New("unexpected gh call")
	}}
	ref := Ref{Owner: "o", Repo: "r", Number: 7}
	raw, meta, err := fetcher.Fetch(context.Background(), ref)
	if err != nil {
		t.Fatal(err)
	}
	if string(raw) != patch {
		t.Fatalf("patch = %q", raw)
	}
	if meta.Provider != "gh" || meta.Title != "Fix" || meta.BaseRef != "main" || meta.HeadRef != "fix" || meta.BaseSHA != "aaaa" || meta.HeadSHA != "bbbb" {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestFetchFallsBackToHTTP(t *testing.T) {
	patch := "diff --git a/x.go b/x.go\nindex 3333333..4444444 100644\n--- a/x.go\n+++ b/x.go\n@@ -1 +1 @@\n-old\n+new\n"
	fetcher := Fetcher{
		BaseURL: "https://example.test",
		RunGh:   func(ctx context.Context, args ...string) ([]byte, error) { return nil, errors.New("gh missing") },
		Get: func(ctx context.Context, url string) ([]byte, error) {
			if url != "https://example.test/o/r/pull/7.diff" {
				t.Fatalf("url = %q", url)
			}
			return []byte(patch), nil
		},
	}
	_, meta, err := fetcher.Fetch(context.Background(), Ref{Owner: "o", Repo: "r", Number: 7})
	if err != nil {
		t.Fatal(err)
	}
	if meta.Provider != "http" || meta.BaseSHA != "" || meta.HeadSHA != "" {
		t.Fatalf("meta = %+v", meta)
	}
}

func TestFetchReportsBothFailures(t *testing.T) {
	fetcher := Fetcher{
		RunGh: func(ctx context.Context, args ...string) ([]byte, error) { return nil, errors.New("auth required") },
		Get:   func(ctx context.Context, url string) ([]byte, error) { return nil, errors.New("HTTP 404") },
	}
	_, _, err := fetcher.Fetch(context.Background(), Ref{Owner: "o", Repo: "r", Number: 7})
	if err == nil || !strings.Contains(err.Error(), "auth required") || !strings.Contains(err.Error(), "HTTP 404") {
		t.Fatalf("err = %v", err)
	}
}
