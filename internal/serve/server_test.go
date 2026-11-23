package serve

import (
	"bytes"
	"compress/gzip"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/reviewctx"
	"github.com/wlingze/intentflow/internal/reviewflow"
)

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	ctx := reviewctx.NewContext("/repo", "feature/review", "a", "b", "range", "", contract.CodeBundle{})
	h, err := NewHandler(Config{
		DistFS:  fstest.MapFS{"index.html": {Data: []byte("embedded frontend")}},
		Payload: func() contract.Payload { return contract.Payload{Session: reviewctx.Empty(ctx)} },
	})
	if err != nil {
		t.Fatal(err)
	}
	return h
}

func newReviewHandler(t *testing.T, waiter *reviewflow.Waiter) (http.Handler, contract.ReviewContext) {
	t.Helper()
	ctx := reviewctx.NewContext("/repo", "feature/review", "a", "b", "range", "", contract.CodeBundle{})
	h, err := NewHandler(Config{
		DistFS:     fstest.MapFS{"index.html": {Data: []byte("embedded frontend")}},
		Payload:    func() contract.Payload { return contract.Payload{Session: reviewctx.Empty(ctx)} },
		Submission: waiter,
	})
	if err != nil {
		t.Fatal(err)
	}
	return h, ctx
}

func postSubmission(t *testing.T, h http.Handler, body string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/api/submission", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	h.ServeHTTP(w, req)
	return w
}

func TestServesEmbeddedFrontend(t *testing.T) {
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != 200 || w.Body.String() != "embedded frontend" {
		t.Fatalf("embedded frontend: %d %s", w.Code, w.Body)
	}
}

func TestRemovedAPIsAreGone(t *testing.T) {
	// 评审状态只存浏览器；这些接口一旦回归，说明又往服务端写数据了。
	h := newTestHandler(t)
	paths := []struct{ method, path string }{
		{http.MethodPut, "/api/review/state"},
		{http.MethodGet, "/api/review/drafts"},
		{http.MethodPost, "/api/review/assets"},
		{http.MethodPost, "/api/review"},
		{http.MethodGet, "/api/scan"},
		{http.MethodPost, "/api/commits"},
	}
	for _, item := range paths {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(item.method, item.path, nil))
		if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
			t.Fatalf("%s %s returned %d", item.method, item.path, w.Code)
		}
	}
}

func TestPayloadUsesGzip(t *testing.T) {
	h := newTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/api/payload", nil)
	req.Header.Set("Accept-Encoding", "gzip")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if got := w.Header().Get("Content-Encoding"); got != "gzip" {
		t.Fatalf("Content-Encoding = %q", got)
	}
	reader, err := gzip.NewReader(w.Body)
	if err != nil {
		t.Fatal(err)
	}
	raw, err := io.ReadAll(reader)
	if err != nil {
		t.Fatal(err)
	}
	var payload contract.Payload
	if err := json.Unmarshal(raw, &payload); err != nil {
		t.Fatalf("payload body: %v", err)
	}
	if payload.Session.Version != 1 {
		t.Fatalf("payload session: %+v", payload.Session)
	}
}

func TestPayloadJSONAlias(t *testing.T) {
	h := newTestHandler(t)
	for _, target := range []string{"/api/payload", "/api/payload.json"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
		if w.Code != 200 {
			t.Fatalf("%s = %d", target, w.Code)
		}
	}
	for _, target := range []string{"/api/revisions", "/api/revisions.json"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
		if w.Code != 200 {
			t.Fatalf("%s = %d", target, w.Code)
		}
	}
}

func TestSubmissionDisabledByDefault(t *testing.T) {
	h := newTestHandler(t)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/payload", nil))
	var payload contract.Payload
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Submission.Enabled {
		t.Fatal("submission enabled without a waiter")
	}
	if got := postSubmission(t, h, `{"action":"cancel","comparison_id":"x"}`).Code; got != http.StatusNotFound {
		t.Fatalf("POST /api/submission = %d, want 404", got)
	}
}

func TestSubmissionAcceptsOneReview(t *testing.T) {
	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: -1})
	h, ctx := newReviewHandler(t, waiter)
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/payload", nil))
	var payload contract.Payload
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if !payload.Submission.Enabled {
		t.Fatal("submission not enabled")
	}
	body := `{"action":"submit","comparison_id":"` + ctx.ComparisonId + `","verdict":"request-changes","summary":"fix it","comments":[{"id":"c-1","body":"change this","file":"a.go","line":3,"end_line":4,"side":"after","resolved":false}]}`
	w = postSubmission(t, h, body)
	if w.Code != http.StatusOK {
		t.Fatalf("submit = %d %s", w.Code, w.Body)
	}
	outcome := waiter.Wait(context.Background(), func() reviewflow.Outcome { return reviewflow.Outcome{} })
	if outcome.Status != reviewflow.StatusSubmitted || outcome.Submission.Verdict != reviewflow.VerdictRequestChanges || len(outcome.Submission.Comments) != 1 {
		t.Fatalf("outcome = %+v", outcome)
	}
	if got := postSubmission(t, h, body).Code; got != http.StatusConflict {
		t.Fatalf("second submit = %d, want 409", got)
	}
}

func TestSubmissionRejectsStaleComparison(t *testing.T) {
	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: -1})
	h, _ := newReviewHandler(t, waiter)
	w := postSubmission(t, h, `{"action":"submit","comparison_id":"stale","verdict":"approve","comments":[]}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("stale submit = %d %s", w.Code, w.Body)
	}
	if waiter.Settled() {
		t.Fatal("stale comparison settled the waiter")
	}
}

func TestSubmissionCancel(t *testing.T) {
	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: -1})
	h, ctx := newReviewHandler(t, waiter)
	w := postSubmission(t, h, `{"action":"cancel","comparison_id":"`+ctx.ComparisonId+`"}`)
	if w.Code != http.StatusOK {
		t.Fatalf("cancel = %d %s", w.Code, w.Body)
	}
	outcome := waiter.Wait(context.Background(), func() reviewflow.Outcome { return reviewflow.Outcome{} })
	if outcome.Status != reviewflow.StatusCancelled || outcome.Reason != reviewflow.ReasonUser {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestSSEPresenceCancelsWhenPageCloses(t *testing.T) {
	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: 30 * time.Millisecond})
	h, _ := newReviewHandler(t, waiter)
	server := httptest.NewServer(h)
	defer server.Close()
	ctx, cancel := context.WithCancel(context.Background())
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, server.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Encoding", "gzip")
	response, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	if got := response.Header.Get("Content-Encoding"); got != "" {
		t.Fatalf("SSE was compressed: %q", got)
	}
	buf := make([]byte, 14)
	if _, err := io.ReadFull(response.Body, buf); err != nil {
		t.Fatal(err)
	}
	if !bytes.HasPrefix(buf, []byte("retry: 1000\n\n")) {
		t.Fatalf("SSE prefix = %q", buf)
	}
	cancel()
	response.Body.Close()
	outcome := waiter.Wait(context.Background(), func() reviewflow.Outcome { return reviewflow.Outcome{} })
	if outcome.Status != reviewflow.StatusCancelled || outcome.Reason != reviewflow.ReasonPageClosed {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestSubmissionRequiresComparison(t *testing.T) {
	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: -1})
	h, _ := newReviewHandler(t, waiter)
	w := postSubmission(t, h, `{"action":"submit","comparison_id":"","verdict":"approve","comments":[]}`)
	if w.Code != http.StatusConflict {
		t.Fatalf("empty comparison = %d", w.Code)
	}
}
