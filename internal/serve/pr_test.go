package serve

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/wlingze/intentflow/internal/contract"
)

const prTestPatch = `diff --git a/src/app.go b/src/app.go
--- a/src/app.go
+++ b/src/app.go
@@ -1,2 +1,3 @@
 package app
-old
+new
+extra
`

func newPRDir(t *testing.T, patchText string) string {
	t.Helper()
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "owner", "repo"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "owner", "repo", "4.patch"), []byte(patchText), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "owner", "repo", "4.json"), []byte(`{"title":"Fix login"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	return dir
}

func newPRTestHandler(t *testing.T, dir string, github bool, base string) http.Handler {
	t.Helper()
	source, err := NewPRSource(PRSourceConfig{Dir: dir, GitHub: github, GitHubBase: base})
	if err != nil {
		t.Fatal(err)
	}
	handler, err := NewPRHandler(PRConfig{
		DistFS: fstest.MapFS{
			"index.html":    {Data: []byte(`<script type="module" src="./assets/app.js"></script>`)},
			"assets/app.js": {Data: []byte("console.log(1)")},
		},
		Source: source,
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func request(t *testing.T, handler http.Handler, target string) *httptest.ResponseRecorder {
	t.Helper()
	w := httptest.NewRecorder()
	handler.ServeHTTP(w, httptest.NewRequest(http.MethodGet, target, nil))
	return w
}

func TestPRIndexAndRouting(t *testing.T) {
	handler := newPRTestHandler(t, newPRDir(t, prTestPatch), false, "")

	index := request(t, handler, "/")
	if index.Code != 200 || !strings.Contains(index.Body.String(), "owner/repo#4") || !strings.Contains(index.Body.String(), "Fix login") {
		t.Fatalf("index: %d %s", index.Code, index.Body)
	}

	redirect := request(t, handler, "/pr/owner/repo/4")
	if redirect.Code != http.StatusPermanentRedirect || redirect.Header().Get("Location") != "/pr/owner/repo/4/" {
		t.Fatalf("redirect: %d %q", redirect.Code, redirect.Header().Get("Location"))
	}

	page := request(t, handler, "/pr/owner/repo/4/")
	if page.Code != 200 || !strings.Contains(page.Body.String(), "assets/app.js") {
		t.Fatalf("page: %d %s", page.Code, page.Body)
	}

	asset := request(t, handler, "/pr/owner/repo/4/assets/app.js")
	if asset.Code != 200 || asset.Body.String() != "console.log(1)" {
		t.Fatalf("asset: %d %q", asset.Code, asset.Body)
	}

	payload := request(t, handler, "/pr/owner/repo/4/api/payload.json")
	if payload.Code != 200 {
		t.Fatalf("payload: %d %s", payload.Code, payload.Body)
	}
	var decoded contract.Payload
	if err := json.Unmarshal(payload.Body.Bytes(), &decoded); err != nil {
		t.Fatal(err)
	}
	if decoded.Session.Context.Repository != "github.com/owner/repo" || len(decoded.Code.Files) != 1 {
		t.Fatalf("payload = %+v", decoded)
	}
	if decoded.Code.Files[0].Path != "src/app.go" || decoded.Code.Files[0].After != "package app\nnew\nextra" {
		t.Fatalf("file = %+v", decoded.Code.Files[0])
	}

	revisions := request(t, handler, "/pr/owner/repo/4/api/revisions.json")
	if revisions.Code != 200 || !strings.Contains(revisions.Body.String(), `"Fix login"`) {
		t.Fatalf("revisions: %d %s", revisions.Code, revisions.Body)
	}

	if missing := request(t, handler, "/pr/owner/repo/9/api/payload.json"); missing.Code != 404 {
		t.Fatalf("missing = %d", missing.Code)
	}
	if bad := request(t, handler, "/pr/../repo/4/"); bad.Code != 404 {
		t.Fatalf("bad ref = %d", bad.Code)
	}
	if health := request(t, handler, "/healthz"); health.Code != 200 || health.Body.String() != "ok\n" {
		t.Fatalf("health = %d %q", health.Code, health.Body)
	}

	form := request(t, handler, "/?owner=owner&repo=repo&number=4")
	if form.Code != http.StatusSeeOther || form.Header().Get("Location") != "/pr/owner/repo/4/" {
		t.Fatalf("form = %d %q", form.Code, form.Header().Get("Location"))
	}
}

func TestPRFetchesAndCachesGitHubDiff(t *testing.T) {
	upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/owner/repo/pull/7.diff" {
			http.NotFound(w, r)
			return
		}
		_, _ = w.Write([]byte(prTestPatch))
	}))
	defer upstream.Close()
	dir := t.TempDir()
	handler := newPRTestHandler(t, dir, true, upstream.URL)

	first := request(t, handler, "/pr/owner/repo/7/api/payload.json")
	if first.Code != 200 {
		t.Fatalf("first = %d %s", first.Code, first.Body)
	}
	cached := filepath.Join(dir, "owner", "repo", "7.diff")
	if _, err := os.Stat(cached); err != nil {
		t.Fatalf("cache: %v", err)
	}
	upstream.Close()
	second := request(t, handler, "/pr/owner/repo/7/api/payload.json")
	if second.Code != 200 {
		t.Fatalf("cached read = %d %s", second.Code, second.Body)
	}
}

func TestPRGitHub404AndDisabledFallback(t *testing.T) {
	upstream := httptest.NewServer(http.NotFoundHandler())
	defer upstream.Close()
	dir := t.TempDir()
	handler := newPRTestHandler(t, dir, true, upstream.URL)
	if got := request(t, handler, "/pr/owner/repo/3/api/payload.json"); got.Code != 404 {
		t.Fatalf("404 = %d %s", got.Code, got.Body)
	}

	disabled := newPRTestHandler(t, t.TempDir(), false, "")
	if got := request(t, disabled, "/pr/owner/repo/3/api/payload.json"); got.Code != 404 {
		t.Fatalf("disabled = %d", got.Code)
	}
}

// PR 页面共用「提交 Review」菜单；关闭接口按相对路径挂在 /pr/... 下。
func TestPRShutdownAndCapabilities(t *testing.T) {
	source, err := NewPRSource(PRSourceConfig{Dir: newPRDir(t, prTestPatch)})
	if err != nil {
		t.Fatal(err)
	}
	shutdown := NewShutdown()
	handler, err := NewPRHandler(PRConfig{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Source:   source,
		Shutdown: shutdown,
	})
	if err != nil {
		t.Fatal(err)
	}

	w := request(t, handler, "/pr/owner/repo/4/api/payload.json")
	var payload contract.Payload
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Capabilities == nil || !payload.Capabilities.Shutdown || payload.Capabilities.Watch {
		t.Fatalf("capabilities = %+v", payload.Capabilities)
	}

	req := httptest.NewRequest(http.MethodPost, "/pr/owner/repo/4/api/shutdown", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("shutdown: %d %s", rec.Code, rec.Body)
	}
	select {
	case <-shutdown.Done():
	default:
		t.Fatal("PR shutdown was not triggered")
	}
}
