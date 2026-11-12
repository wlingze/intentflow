// Package serve provides the diff workbench API and embedded frontend.
package serve

import (
	"compress/gzip"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/reviewstore"
)

type Config struct {
	Host         string
	Port         int
	DistDir      string
	DistFS       fs.FS
	OutDir       string
	Payload      func() contract.Payload
	Revisions    func() (contract.RevisionList, error)
	Load         func(string) (contract.Payload, error)
	SaveReview   func(contract.ReviewSession) (contract.ReviewSession, error)
	SaveAsset    func([]byte, string) (string, error)
	ReadAsset    func(string) ([]byte, string, error)
	ListDrafts   func(contract.ReviewContext) ([]contract.ReviewDraft, error)
	RestoreDraft func(contract.ReviewContext, []contract.CodeFile, string, bool) (contract.ReviewSession, int, error)
}

func NewHandler(cfg Config) (http.Handler, error) {
	dist, err := distFS(cfg)
	if err != nil {
		return nil, err
	}
	if _, err := fs.Stat(dist, "index.html"); err != nil {
		return nil, fmt.Errorf("二进制里没有前端产物；先运行 scripts/build.sh")
	}
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/payload", func(w http.ResponseWriter, r *http.Request) {
		p := cfg.Payload()
		if id := r.URL.Query().Get("revision"); id != "" {
			if cfg.Load == nil {
				writeError(w, 400, "当前比较不支持切换 revision")
				return
			}
			next, err := cfg.Load(id)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			p = next
		}
		writeJSON(w, 200, p)
	})
	mux.HandleFunc("GET /api/revisions", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Revisions == nil {
			writeJSON(w, 200, contract.RevisionList{Revisions: []contract.Revision{}})
			return
		}
		list, err := cfg.Revisions()
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, list)
	})
	mux.HandleFunc("PUT /api/review/state", func(w http.ResponseWriter, r *http.Request) {
		if cfg.SaveReview == nil {
			writeError(w, 503, "评审存储不可用")
			return
		}
		var doc contract.ReviewSession
		if err := decode(w, r, &doc); err != nil {
			writeError(w, 400, "评审 JSON 无法读取: "+err.Error())
			return
		}
		saved, err := cfg.SaveReview(doc)
		if err != nil {
			status := 400
			if errors.Is(err, reviewstore.ErrMismatch) {
				status = 409
			}
			writeError(w, status, err.Error())
			return
		}
		writeJSON(w, 200, saved)
	})
	mux.HandleFunc("GET /api/review/drafts", func(w http.ResponseWriter, r *http.Request) {
		if cfg.ListDrafts == nil {
			writeJSON(w, 200, contract.ReviewDraftList{Drafts: []contract.ReviewDraft{}})
			return
		}
		current := cfg.Payload()
		drafts, err := cfg.ListDrafts(current.Session.Context)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, contract.ReviewDraftList{SessionId: current.Session.Context.SessionId, Drafts: drafts})
	})
	mux.HandleFunc("POST /api/review/drafts/{comparison_id}", func(w http.ResponseWriter, r *http.Request) {
		if cfg.RestoreDraft == nil {
			writeError(w, 503, "草稿恢复不可用")
			return
		}
		var req contract.RestoreRequest
		if err := decode(w, r, &req); err != nil {
			writeError(w, 400, "请求不是合法 JSON")
			return
		}
		current := cfg.Payload()
		doc, adjusted, err := cfg.RestoreDraft(current.Session.Context, current.Code.Files, r.PathValue("comparison_id"), req.Relax)
		if err != nil {
			status := 400
			if errors.Is(err, reviewstore.ErrMismatch) {
				status = 409
			}
			writeError(w, status, err.Error())
			return
		}
		if cfg.SaveReview != nil {
			doc, err = cfg.SaveReview(doc)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
		}
		writeJSON(w, 200, contract.RestoreResult{Document: doc, Adjusted: adjusted})
	})
	mux.HandleFunc("POST /api/review/assets", func(w http.ResponseWriter, r *http.Request) {
		if cfg.SaveAsset == nil {
			writeError(w, 503, "图片存储不可用")
			return
		}
		r.Body = http.MaxBytesReader(w, r.Body, 8<<20)
		data, err := io.ReadAll(r.Body)
		if err != nil {
			writeError(w, 400, "图片读取失败: "+err.Error())
			return
		}
		ext, ok := map[string]string{
			"image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp",
		}[http.DetectContentType(data)]
		if !ok {
			writeError(w, 400, "只支持 png、jpg、gif、webp 图片")
			return
		}
		name, err := cfg.SaveAsset(data, ext)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, contract.ReviewAsset{Name: name, Url: path.Join("/api/review/assets", name)})
	})
	mux.HandleFunc("GET /api/review/assets/{name}", func(w http.ResponseWriter, r *http.Request) {
		if cfg.ReadAsset == nil {
			writeError(w, 503, "图片存储不可用")
			return
		}
		data, kind, err := cfg.ReadAsset(r.PathValue("name"))
		if err != nil {
			writeError(w, 404, err.Error())
			return
		}
		w.Header().Set("Content-Type", kind)
		w.Header().Set("Cache-Control", "private, max-age=31536000, immutable")
		_, _ = w.Write(data)
	})
	mux.HandleFunc("POST /api/review", func(w http.ResponseWriter, r *http.Request) {
		var req contract.ReviewRequest
		if err := decode(w, r, &req); err != nil {
			writeError(w, 400, "请求不是合法 JSON")
			return
		}
		doc := req.Document
		if cfg.SaveReview != nil {
			saved, err := cfg.SaveReview(doc)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			doc = saved
		}
		target, err := writeReviewJSON(cfg.OutDir, doc)
		if err != nil {
			writeError(w, 500, err.Error())
			return
		}
		writeJSON(w, 200, contract.ReviewResponse{Path: target})
	})
	mux.Handle("/", spaHandler(dist))
	return gzipMiddleware(mux), nil
}

// 12 MB 的 payload 会拖慢局域网首屏；JSON 与静态文本用 gzip 传输。
// 图片、字体与已压缩内容跳过，避免无意义的重编码。
type gzipResponseWriter struct {
	http.ResponseWriter
	writer *gzip.Writer
	wrote  bool
	plain  bool
}

func (g *gzipResponseWriter) WriteHeader(status int) {
	if g.wrote {
		return
	}
	g.wrote = true
	contentType := g.Header().Get("Content-Type")
	if g.Header().Get("Content-Encoding") != "" || strings.HasPrefix(contentType, "image/") || strings.HasPrefix(contentType, "font/") {
		g.plain = true
		g.ResponseWriter.WriteHeader(status)
		return
	}
	g.Header().Del("Content-Length")
	g.Header().Set("Content-Encoding", "gzip")
	g.Header().Add("Vary", "Accept-Encoding")
	g.ResponseWriter.WriteHeader(status)
}

func (g *gzipResponseWriter) Write(data []byte) (int, error) {
	if !g.wrote {
		g.WriteHeader(http.StatusOK)
	}
	if g.plain {
		return g.ResponseWriter.Write(data)
	}
	return g.writer.Write(data)
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
			next.ServeHTTP(w, r)
			return
		}
		gz := gzip.NewWriter(w)
		defer gz.Close()
		next.ServeHTTP(&gzipResponseWriter{ResponseWriter: w, writer: gz}, r)
	})
}

func decode(w http.ResponseWriter, r *http.Request, dst any) error {
	defer r.Body.Close()
	r.Body = http.MaxBytesReader(w, r.Body, 16<<20)
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return err
	}
	if err := dec.Decode(new(any)); err != io.EOF {
		return errors.New("JSON 后有多余内容")
	}
	return nil
}

// Port 0 lets the kernel atomically reserve a free port.
func Listen(cfg Config) error {
	handler, err := NewHandler(cfg)
	if err != nil {
		return err
	}
	host := cfg.Host
	if host == "" {
		host = "0.0.0.0"
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(cfg.Port)))
	if err != nil {
		return fmt.Errorf("监听失败: %w", err)
	}
	port := ln.Addr().(*net.TCPAddr).Port
	fmt.Println("review 工作台:")
	for _, url := range accessURLs(host, port) {
		fmt.Println("  " + url)
	}
	fmt.Println("端口:", port)
	return http.Serve(ln, logRequests(handler))
}

func accessURLs(host string, port int) []string {
	add := func(ip string) string { return "http://" + net.JoinHostPort(ip, fmt.Sprint(port)) }
	switch host {
	case "", "0.0.0.0", "::":
		out := []string{add("127.0.0.1")}
		for _, ip := range localIPv4() {
			out = append(out, add(ip))
		}
		return out
	default:
		return []string{add(host)}
	}
}

func localIPv4() []string {
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return nil
	}
	seen := map[string]bool{}
	var out []string
	for _, addr := range addrs {
		ipnet, ok := addr.(*net.IPNet)
		if !ok || ipnet.IP.To4() == nil || ipnet.IP.IsLoopback() {
			continue
		}
		ip := ipnet.IP.String()
		if !seen[ip] {
			seen[ip] = true
			out = append(out, ip)
		}
	}
	return out
}

func writeReviewJSON(dir string, doc contract.ReviewSession) (string, error) {
	if dir == "" {
		dir = "intentflow-out"
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return "", err
	}
	target := filepath.Join(dir, "review.json")
	tmp, err := os.CreateTemp(dir, ".review-*.json")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		return "", err
	}
	return target, nil
}

func distFS(cfg Config) (fs.FS, error) {
	if cfg.DistDir != "" {
		info, err := os.Stat(cfg.DistDir)
		if err != nil || !info.IsDir() {
			return nil, fmt.Errorf("--dist 目录不存在: %s", cfg.DistDir)
		}
		return os.DirFS(cfg.DistDir), nil
	}
	if cfg.DistFS == nil {
		return nil, fmt.Errorf("没有前端产物；先运行 scripts/build.sh")
	}
	return cfg.DistFS, nil
}

func spaHandler(dist fs.FS) http.Handler {
	files := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rel := strings.TrimPrefix(path.Clean("/"+r.URL.Path), "/")
		if rel == "" || rel == "." {
			serveIndex(w, r, dist)
			return
		}
		if info, err := fs.Stat(dist, rel); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(rel, "api/") || path.Ext(rel) != "" {
			http.NotFound(w, r)
			return
		}
		serveIndex(w, r, dist)
	})
}
func serveIndex(w http.ResponseWriter, r *http.Request, dist fs.FS) {
	raw, err := fs.ReadFile(dist, "index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(raw)
}
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fmt.Printf("  %s %s %s\n", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}
func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
