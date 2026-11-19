package ghreview

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientReadsPullDiffCommentsAndSubmits(t *testing.T) {
	var submitted SubmitRequest
	mux := http.NewServeMux()
	mux.HandleFunc("/repos/o/r/pulls/7", func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer secret" {
			t.Fatalf("authorization = %q", r.Header.Get("Authorization"))
		}
		if strings.Contains(r.Header.Get("Accept"), "diff") {
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-a\n+b\n"))
			return
		}
		_ = json.NewEncoder(w).Encode(Pull{Number: 7, Title: "Fix", Base: struct {
			Ref string `json:"ref"`
			SHA string `json:"sha"`
		}{Ref: "main", SHA: "base123"}, Head: struct {
			Ref string `json:"ref"`
			SHA string `json:"sha"`
		}{Ref: "feature", SHA: "head456"}})
	})
	mux.HandleFunc("/repos/o/r/pulls/7/comments", func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewEncoder(w).Encode([]ReviewComment{{ID: 11, Path: "a.txt", Body: "note", Side: "RIGHT", Line: intPtr(2)}})
	})
	mux.HandleFunc("/repos/o/r/pulls/7/reviews", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s", r.Method)
		}
		if err := json.NewDecoder(r.Body).Decode(&submitted); err != nil {
			t.Fatal(err)
		}
		_ = json.NewEncoder(w).Encode(ReviewResult{ID: 99, HTMLURL: "https://github.com/o/r/pull/7#pullrequestreview-99", State: "COMMENTED"})
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	client := NewClient(server.URL, "secret")

	pull, err := client.Pull(context.Background(), "o", "r", 7)
	if err != nil || pull.Head.SHA != "head456" {
		t.Fatalf("pull = %+v, err = %v", pull, err)
	}
	diff, err := client.Diff(context.Background(), "o", "r", 7)
	if err != nil || !strings.Contains(string(diff), "@@ -1 +1 @@") {
		t.Fatalf("diff = %q, err = %v", diff, err)
	}
	comments, err := client.Comments(context.Background(), "o", "r", 7)
	if err != nil || len(comments) != 1 || comments[0].ID != 11 {
		t.Fatalf("comments = %+v, err = %v", comments, err)
	}
	result, err := client.SubmitReview(context.Background(), "o", "r", 7, SubmitRequest{
		CommitID: "head456", Event: "COMMENT", Body: "summary",
		Comments: []SubmitComment{{Path: "a.txt", Body: "inline", Line: 2, Side: "RIGHT"}},
	})
	if err != nil || result.ID != 99 {
		t.Fatalf("result = %+v, err = %v", result, err)
	}
	if submitted.CommitID != "head456" || submitted.Event != "COMMENT" || len(submitted.Comments) != 1 {
		t.Fatalf("submitted = %+v", submitted)
	}
}

func TestCommentsPagination(t *testing.T) {
	pageOne := make([]ReviewComment, 100)
	for index := range pageOne {
		pageOne[index] = ReviewComment{ID: int64(index + 1)}
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Query().Get("page") == "1" {
			_ = json.NewEncoder(w).Encode(pageOne)
			return
		}
		_ = json.NewEncoder(w).Encode([]ReviewComment{{ID: 101}})
	}))
	defer server.Close()
	comments, err := NewClient(server.URL, "").Comments(context.Background(), "o", "r", 1)
	if err != nil || len(comments) != 101 {
		t.Fatalf("comments = %d, err = %v", len(comments), err)
	}
}

func TestAPIErrorAndRateLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/repos/o/r/pulls/1/reviews" {
			w.WriteHeader(http.StatusUnprocessableEntity)
			_ = json.NewEncoder(w).Encode(map[string]any{"message": "Validation Failed", "errors": []map[string]string{{"field": "line", "code": "invalid"}}})
			return
		}
		w.Header().Set("X-RateLimit-Reset", "1700000000")
		w.WriteHeader(http.StatusForbidden)
		_ = json.NewEncoder(w).Encode(map[string]string{"message": "API rate limit exceeded"})
	}))
	defer server.Close()
	client := NewClient(server.URL, "secret")

	_, err := client.Pull(context.Background(), "o", "r", 1)
	var apiErr *APIError
	if !errors.As(err, &apiErr) || apiErr.Status != 403 || apiErr.RateLimitReset.IsZero() {
		t.Fatalf("rate limit error = %v", err)
	}
	if !strings.Contains(err.Error(), "限流") {
		t.Fatalf("message = %v", err)
	}

	_, err = client.SubmitReview(context.Background(), "o", "r", 1, SubmitRequest{Event: "COMMENT"})
	if !errors.As(err, &apiErr) || apiErr.Status != 422 || !strings.Contains(err.Error(), "Validation Failed") {
		t.Fatalf("422 error = %v", err)
	}
}

func TestSubmitRequiresToken(t *testing.T) {
	client := NewClient("http://127.0.0.1:1", "")
	_, err := client.SubmitReview(context.Background(), "o", "r", 1, SubmitRequest{Event: "COMMENT"})
	if err == nil || !strings.Contains(err.Error(), "GITHUB_TOKEN") {
		t.Fatalf("err = %v", err)
	}
}

func TestValidateRepo(t *testing.T) {
	for _, value := range []string{"o/r", "owner/repo.name", "a_b/c-d"} {
		if _, _, err := ValidateRepo(value); err != nil {
			t.Fatalf("%s: %v", value, err)
		}
	}
	for _, value := range []string{"", "o", "o/r/x", "../r", "o/r\n"} {
		if _, _, err := ValidateRepo(value); err == nil {
			t.Fatalf("accepted %q", value)
		}
	}
}

func TestDoRawRejectsOversizedResponse(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, strings.Repeat("x", 64))
	}))
	defer server.Close()
	client := NewClient(server.URL, "")
	client.MaxBytes = 10
	_, err := client.Pull(context.Background(), "o", "r", 1)
	if err == nil || !strings.Contains(err.Error(), "超过") {
		t.Fatalf("err = %v", err)
	}
}

func intPtr(value int) *int { return &value }

func TestAPIErrorStringDetails(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnprocessableEntity)
		_, _ = w.Write([]byte(`{"message":"Unprocessable Entity","errors":["Review Can not approve your own pull request"]}`))
	}))
	defer server.Close()
	_, err := NewClient(server.URL, "secret").SubmitReview(context.Background(), "o", "r", 1, SubmitRequest{Event: "APPROVE"})
	if err == nil || !strings.Contains(err.Error(), "Can not approve your own pull request") {
		t.Fatalf("err = %v", err)
	}
}
