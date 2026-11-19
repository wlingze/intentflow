package serve

import (
	"bytes"
	"errors"
	"fmt"
	"html/template"
	"io/fs"
	"net/http"
	"net/url"
	"os"
	"path"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/prdiff"
)

// PRConfig describes the multi-PR workbench.
type PRConfig struct {
	Host        string
	Port        int
	DistDir     string
	DistFS      fs.FS
	Source      *PRSource
	IndexTitle  string
	OpenBrowser bool
}

type prHandler struct {
	dist       fs.FS
	source     *PRSource
	index      *template.Template
	indexTitle string

	mu    sync.Mutex
	cache map[string]prView
}

type prView struct {
	size      int64
	mod       time.Time
	payload   contract.Payload
	revisions contract.RevisionList
}

type prIndexData struct {
	Title  string
	Items  []PRSummary
	Dir    string
	GitHub bool
	Error  string
}

// NewPRHandler serves the index, per-PR payloads and the embedded frontend.
func NewPRHandler(cfg PRConfig) (http.Handler, error) {
	if cfg.Source == nil {
		return nil, errors.New("缺少 PR 目录")
	}
	dist, err := distFS(Config{DistDir: cfg.DistDir, DistFS: cfg.DistFS})
	if err != nil {
		return nil, err
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return nil, fmt.Errorf("二进制里没有前端产物；先运行 scripts/build.sh")
	}
	title := cfg.IndexTitle
	if title == "" {
		title = "intentflow · PR diffs"
	}
	parse, err := template.New("index").Parse(prIndexHTML)
	if err != nil {
		return nil, err
	}
	handler := &prHandler{dist: dist, source: cfg.Source, index: parse, indexTitle: title, cache: map[string]prView{}}
	return gzipMiddleware(handler), nil
}

// ListenPR starts the multi-PR server.
func ListenPR(cfg PRConfig) error {
	handler, err := NewPRHandler(cfg)
	if err != nil {
		return err
	}
	return listen(cfg.Host, cfg.Port, cfg.OpenBrowser, handler, "PR 工作台")
}

func (h *prHandler) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodGet && r.Method != http.MethodHead {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if r.URL.Path == "/healthz" {
		w.Header().Set("Content-Type", "text/plain; charset=utf-8")
		_, _ = w.Write([]byte("ok\n"))
		return
	}
	clean := path.Clean("/" + r.URL.Path)
	rel := strings.TrimPrefix(clean, "/")
	if rel == "" || rel == "." {
		h.serveIndexPage(w, r)
		return
	}
	parts := strings.Split(rel, "/")
	if parts[0] == "pr" {
		if len(parts) < 4 {
			http.NotFound(w, r)
			return
		}
		number, err := strconv.Atoi(parts[3])
		if err != nil {
			http.NotFound(w, r)
			return
		}
		ref := PRRef{Owner: parts[1], Repo: parts[2], Number: number}
		if !ref.Valid() {
			http.NotFound(w, r)
			return
		}
		rest := ""
		if len(parts) > 4 {
			rest = strings.Join(parts[4:], "/")
		}
		if rest == "" {
			if !strings.HasSuffix(r.URL.Path, "/") {
				target := r.URL.Path + "/"
				if r.URL.RawQuery != "" {
					target += "?" + r.URL.RawQuery
				}
				http.Redirect(w, r, target, http.StatusPermanentRedirect)
				return
			}
			h.servePRIndex(w, r, ref)
			return
		}
		switch rest {
		case "index.html":
			h.servePRIndex(w, r, ref)
		case "api/payload.json", "api/payload":
			h.servePayload(w, r, ref)
		case "api/revisions.json", "api/revisions":
			h.serveRevisions(w, r, ref)
		default:
			h.serveAsset(w, r, rest)
		}
		return
	}
	// Root assets are only needed when the server is mounted at /.
	h.serveAsset(w, r, rel)
}

func (h *prHandler) serveIndexPage(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query()
	if owner, repo, number := query.Get("owner"), query.Get("repo"), query.Get("number"); owner != "" && repo != "" && number != "" {
		n, err := strconv.Atoi(number)
		ref := PRRef{Owner: strings.TrimSpace(owner), Repo: strings.TrimSpace(repo), Number: n}
		if err == nil && ref.Valid() {
			http.Redirect(w, r, fmt.Sprintf("/pr/%s/%s/%d/", url.PathEscape(ref.Owner), url.PathEscape(ref.Repo), ref.Number), http.StatusSeeOther)
			return
		}
	}
	items, err := h.source.List()
	data := prIndexData{Title: h.indexTitle, Items: items, Dir: h.source.Dir(), GitHub: h.source.ServeGitHub()}
	if err != nil {
		data.Error = err.Error()
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = h.index.Execute(w, data)
}

func (h *prHandler) servePRIndex(w http.ResponseWriter, r *http.Request, ref PRRef) {
	if _, err := h.source.Load(r.Context(), ref); err != nil {
		h.writeLoadError(w, err, false)
		return
	}
	data, err := fs.ReadFile(h.dist, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_, _ = w.Write(data)
}

func (h *prHandler) servePayload(w http.ResponseWriter, r *http.Request, ref PRRef) {
	view, err := h.view(r, ref)
	if err != nil {
		h.writeLoadError(w, err, true)
		return
	}
	writeJSON(w, http.StatusOK, view.payload)
}

func (h *prHandler) serveRevisions(w http.ResponseWriter, r *http.Request, ref PRRef) {
	view, err := h.view(r, ref)
	if err != nil {
		h.writeLoadError(w, err, true)
		return
	}
	writeJSON(w, http.StatusOK, view.revisions)
}

func (h *prHandler) view(r *http.Request, ref PRRef) (prView, error) {
	loaded, err := h.source.Load(r.Context(), ref)
	if err != nil {
		return prView{}, err
	}
	key := loaded.Path
	var size int64
	var mod time.Time
	if key != "" {
		if info, err := os.Stat(key); err == nil {
			size, mod = info.Size(), info.ModTime()
		}
	}
	h.mu.Lock()
	cached, ok := h.cache[key]
	h.mu.Unlock()
	if ok && key != "" && cached.size == size && cached.mod.Equal(mod) {
		return cached, nil
	}
	title := h.source.title(ref)
	if title == "" {
		title = fmt.Sprintf("%s/%s#%d", ref.Owner, ref.Repo, ref.Number)
	}
	payload, revisions, err := prdiff.Build(loaded.Data, prdiff.Params{
		Repository: "github.com/" + ref.Owner + "/" + ref.Repo,
		Branch:     fmt.Sprintf("pull/%d", ref.Number),
		Before:     fmt.Sprintf("PR #%d base", ref.Number),
		After:      fmt.Sprintf("PR #%d head", ref.Number),
		Title:      title,
		Mode:       contract.Git,
		Note:       "GitHub PR 补丁：只含改动 hunk；展开的未改区间是空占位行。",
	})
	if err != nil {
		return prView{}, err
	}
	view := prView{size: size, mod: mod, payload: payload, revisions: revisions}
	if key != "" {
		h.mu.Lock()
		h.cache[key] = view
		h.mu.Unlock()
	}
	return view, nil
}

func (h *prHandler) serveAsset(w http.ResponseWriter, r *http.Request, rel string) {
	rel = strings.TrimPrefix(path.Clean("/"+rel), "/")
	if rel == "" || rel == "." {
		http.NotFound(w, r)
		return
	}
	info, err := fs.Stat(h.dist, rel)
	if err != nil || info.IsDir() {
		http.NotFound(w, r)
		return
	}
	data, err := fs.ReadFile(h.dist, rel)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if strings.HasPrefix(rel, "assets/") {
		w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	}
	http.ServeContent(w, r, rel, info.ModTime(), bytes.NewReader(data))
}

func (h *prHandler) writeLoadError(w http.ResponseWriter, err error, jsonBody bool) {
	status := http.StatusBadGateway
	if errors.Is(err, ErrPRNotFound) {
		status = http.StatusNotFound
	}
	if jsonBody {
		writeError(w, status, err.Error())
		return
	}
	http.Error(w, err.Error(), status)
}

const prIndexHTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{{.Title}}</title>
<style>
:root{color-scheme:light dark;--bg:#f6f5f1;--fg:#1f2328;--muted:#656d76;--line:#d8d4ca;--card:#fff;--accent:#4a6fa5}
@media (prefers-color-scheme:dark){:root{--bg:#161b22;--fg:#e6edf3;--muted:#8b949e;--line:#30363d;--card:#0d1117;--accent:#7aa2d6}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:920px;margin:0 auto;padding:48px 24px 72px}
h1{font-size:26px;margin:0 0 4px}p.lead{margin:0 0 28px;color:var(--muted)}
form{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 28px}
input{background:var(--card);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font:inherit}
input[name=owner],input[name=repo]{flex:1;min-width:120px}input[name=number]{width:100px}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 16px;font:inherit;cursor:pointer}
ul{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}
li{border-bottom:1px solid var(--line)}
a{display:flex;justify-content:space-between;gap:16px;padding:14px 6px;color:inherit;text-decoration:none}
a:hover{background:var(--card)}
.repo{font-weight:600}.title{color:var(--muted)}.meta{color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}
.empty{color:var(--muted);padding:24px 6px}.error{color:#b3261e;margin:0 0 20px}.note{color:var(--muted);font-size:13px;margin-top:28px}
</style>
</head>
<body><main>
<h1>{{.Title}}</h1>
<p class="lead">按路径浏览 PR diff：<code>/pr/&lt;owner&gt;/&lt;repo&gt;/&lt;number&gt;</code></p>
{{if .Error}}<p class="error">{{.Error}}</p>{{end}}
<form method="get" action="">
<input name="owner" placeholder="owner" aria-label="owner" required>
<input name="repo" placeholder="repo" aria-label="repo" required>
<input name="number" placeholder="PR" aria-label="PR 编号" inputmode="numeric" required>
<button type="submit">打开</button>
</form>
{{if .Items}}<ul>
{{range .Items}}<li><a href="pr/{{.Owner}}/{{.Repo}}/{{.Number}}/"><span><span class="repo">{{.Owner}}/{{.Repo}}#{{.Number}}</span>{{if .Title}} <span class="title">{{.Title}}</span>{{end}}</span><span class="meta">{{.Size}} B</span></a></li>
{{end}}</ul>{{else}}<p class="empty">目录里还没有补丁。按 <code>&lt;dir&gt;/&lt;owner&gt;/&lt;repo&gt;/&lt;number&gt;.patch</code> 放置，或用上面的输入框打开公开仓库的 PR。</p>{{end}}
<p class="note">目录：<code>{{.Dir}}</code>{{if .GitHub}} · 本地缺失时从 GitHub 抓取 <code>pull/&lt;number&gt;.diff</code>{{else}} · GitHub 抓取已关闭{{end}}</p>
</main></body></html>`
