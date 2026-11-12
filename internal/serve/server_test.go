package serve

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"testing/fstest"

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/reviewstore"
)

func TestReviewStateAPI(t *testing.T) {
	files := []contract.CodeFile{{Path: "a.go", Status: contract.CodeStatusAdded, After: "package a\n"}}
	ctx := reviewstore.NewContext("/repo", "feature/review", "a", "b", "range", "", contract.CodeBundle{Files: files})
	store, _ := reviewstore.New(t.TempDir())
	cfg := Config{
		DistFS:     fstest.MapFS{"index.html": {Data: []byte("embedded frontend")}},
		Payload:    func() contract.Payload { return contract.Payload{Session: reviewstore.Empty(ctx)} },
		SaveReview: func(doc contract.ReviewSession) (contract.ReviewSession, error) { return store.Save(doc, ctx, files) },
		SaveAsset:  store.SaveAsset,
		ReadAsset:  store.ReadAsset,
		OutDir:     t.TempDir(),
	}
	h, err := NewHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	save := func(doc contract.ReviewSession) *httptest.ResponseRecorder {
		t.Helper()
		raw, _ := json.Marshal(doc)
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodPut, "/api/review/state", bytes.NewReader(raw)))
		return w
	}
	doc := reviewstore.Empty(ctx)
	if w := save(doc); w.Code != 200 {
		t.Fatalf("save: %d %s", w.Code, w.Body)
	}
	doc.Context.Branch = "another-branch"
	if w := save(doc); w.Code != 409 {
		t.Fatalf("branch mismatch: %d %s", w.Code, w.Body)
	}
	loaded, err := store.Load(ctx, files)
	if err != nil {
		t.Fatalf("original review modified: %+v %v", loaded, err)
	}
	for _, path := range []string{"/api/scan", "/api/commits"} {
		w := httptest.NewRecorder()
		h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
		if w.Code != 404 {
			t.Fatalf("removed API %s returned %d", path, w.Code)
		}
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/", nil))
	if w.Code != 200 || w.Body.String() != "embedded frontend" {
		t.Fatalf("embedded frontend: %d %s", w.Code, w.Body)
	}
}

func TestAssetAPIAndReviewJSON(t *testing.T) {
	files := []contract.CodeFile{{Path: "a.go", Status: contract.CodeStatusAdded, After: "package a\n"}}
	ctx := reviewstore.NewContext("/repo", "feature/review", "a", "b", "range", "", contract.CodeBundle{Files: files})
	store, _ := reviewstore.New(t.TempDir())
	out := t.TempDir()
	cfg := Config{
		DistFS:     fstest.MapFS{"index.html": {Data: []byte("embedded frontend")}},
		Payload:    func() contract.Payload { return contract.Payload{Session: reviewstore.Empty(ctx)} },
		SaveReview: func(doc contract.ReviewSession) (contract.ReviewSession, error) { return store.Save(doc, ctx, files) },
		SaveAsset:  store.SaveAsset,
		ReadAsset:  store.ReadAsset,
		OutDir:     out,
	}
	h, err := NewHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
	png := []byte("\x89PNG\r\n\x1a\nsmall-image")
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/review/assets", bytes.NewReader(png)))
	if w.Code != 200 {
		t.Fatalf("upload: %d %s", w.Code, w.Body)
	}
	var asset contract.ReviewAsset
	if err := json.Unmarshal(w.Body.Bytes(), &asset); err != nil || asset.Name == "" {
		t.Fatalf("asset response: %s %v", w.Body, err)
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, asset.Url, nil))
	if w.Code != 200 || !bytes.Equal(w.Body.Bytes(), png) || w.Header().Get("Content-Type") != "image/png" {
		t.Fatalf("read asset: %d %s %q", w.Code, w.Body, w.Header().Get("Content-Type"))
	}
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/review/assets/not-valid.png", nil))
	if w.Code != 404 {
		t.Fatalf("invalid asset name returned %d", w.Code)
	}

	doc := reviewstore.Empty(ctx)
	doc.Comments = []contract.Comment{{
		Id: "overall", Text: "整体意见", Title: "", Source: "manual", SignalId: "", CreatedAt: 1,
		Images: []string{asset.Name},
	}}
	raw, _ := json.Marshal(contract.ReviewRequest{Document: doc})
	w = httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodPost, "/api/review", bytes.NewReader(raw)))
	if w.Code != 200 {
		t.Fatalf("submit review: %d %s", w.Code, w.Body)
	}
	var response contract.ReviewResponse
	if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
		t.Fatal(err)
	}
	if response.Path != filepath.Join(out, "review.json") {
		t.Fatalf("unexpected review path: %s", response.Path)
	}
	saved, err := os.ReadFile(response.Path)
	if err != nil || !bytes.Contains(saved, []byte(`"images"`)) {
		t.Fatalf("review.json missing images: %s %v", saved, err)
	}
}

func TestPayloadUsesGzip(t *testing.T) {
	ctx := reviewstore.NewContext("/repo", "feature", "a", "b", "range", "", contract.CodeBundle{})
	cfg := Config{
		DistFS:  fstest.MapFS{"index.html": {Data: []byte("embedded frontend")}},
		Payload: func() contract.Payload { return contract.Payload{Session: reviewstore.Empty(ctx)} },
	}
	h, err := NewHandler(cfg)
	if err != nil {
		t.Fatal(err)
	}
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
}
