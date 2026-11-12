package serve

import (
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"testing/fstest"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/reviewctx"
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
