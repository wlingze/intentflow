// Package serve provides the diff workbench API and embedded frontend.
package serve

import (
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path"
	"strings"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/reviewflow"
)

// Config 描述一个只读的 diff 工作台。评审状态由浏览器保存，服务端不落盘。
type Config struct {
	Host      string
	Port      int
	DistDir   string
	DistFS    fs.FS
	Payload   func() contract.Payload
	Revisions func() (contract.RevisionList, error)
	Load      func(string) (contract.Payload, error)
	// OpenBrowser 在终端里启动时自动打开工作台；无图形环境时静默跳过。
	OpenBrowser bool
	// Submission 非空时启用审阅提交：页面可提交一次，SSE 跟踪在线页面。
	Submission *reviewflow.Waiter
	// Ready 在监听成功后调用，用于写 ready 文件。
	Ready func(urls []string, port int)
	// Stop 关闭时优雅停止 HTTP 服务。
	Stop <-chan struct{}
	// Out 接收人类日志；默认 os.Stdout。JSON 模式传 stderr。
	Out io.Writer
	// Log 接收 /api 访问日志；默认与 Out 相同。
	Log io.Writer
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
	withState := func(p contract.Payload) contract.Payload {
		p.Submission = contract.SubmissionState{Enabled: cfg.Submission != nil}
		return p
	}
	payloadHandler := func(w http.ResponseWriter, r *http.Request) {
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
		writeJSON(w, 200, withState(p))
	}
	// The .json names are what a static export writes next to index.html.
	mux.HandleFunc("GET /api/payload", payloadHandler)
	mux.HandleFunc("GET /api/payload.json", payloadHandler)
	revisionsHandler := func(w http.ResponseWriter, r *http.Request) {
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
	}
	mux.HandleFunc("GET /api/revisions", revisionsHandler)
	mux.HandleFunc("GET /api/revisions.json", revisionsHandler)
	mux.HandleFunc("POST /api/submission", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Submission == nil {
			writeError(w, 404, "当前工作台不接受提交；用 intentflow review --wait 启动")
			return
		}
		var req contract.ReviewSubmission
		if err := decode(w, r, &req); err != nil {
			writeError(w, 400, err.Error())
			return
		}
		current := cfg.Payload().Session.Context
		if req.ComparisonId == "" || req.ComparisonId != current.ComparisonId {
			writeError(w, 409, "比较范围已变化，请刷新页面后再提交")
			return
		}
		switch req.Action {
		case contract.Cancel:
			if !cfg.Submission.Cancel(reviewflow.ReasonUser, "用户取消了审阅") {
				writeError(w, 409, "本次审阅已结束")
				return
			}
			writeJSON(w, 200, contract.SubmissionResponse{Status: contract.Cancelled})
			flush(w)
		case contract.Submit:
			sub, err := reviewflow.FromRequest(req)
			if err != nil {
				writeError(w, 400, err.Error())
				return
			}
			if !cfg.Submission.Submit(sub) {
				writeError(w, 409, "本次审阅已结束")
				return
			}
			writeJSON(w, 200, contract.SubmissionResponse{Status: contract.Submitted})
			flush(w)
		default:
			writeError(w, 400, fmt.Sprintf("未知 action %q", req.Action))
		}
	})
	mux.HandleFunc("GET /api/events", func(w http.ResponseWriter, r *http.Request) {
		if cfg.Submission == nil {
			writeError(w, 404, "当前工作台没有审阅会话")
			return
		}
		flusher, ok := w.(http.Flusher)
		if !ok {
			writeError(w, 500, "当前连接不支持流式响应")
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Connection", "keep-alive")
		w.Header().Set("X-Accel-Buffering", "no")
		w.WriteHeader(200)
		_, _ = io.WriteString(w, "retry: 1000\n\n")
		flusher.Flush()
		cfg.Submission.ClientConnected()
		defer cfg.Submission.ClientDisconnected()
		// net/http only notices a dead SSE client on the next write. CloseNotify
		// fires on the socket close, so a closed tab cancels promptly.
		var closed <-chan bool
		if notifier, ok := w.(http.CloseNotifier); ok {
			closed = notifier.CloseNotify()
		}
		ticker := time.NewTicker(2 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-r.Context().Done():
				return
			case <-closed:
				return
			case <-cfg.Submission.Done():
				return
			case <-ticker.C:
				if _, err := io.WriteString(w, ": ping\n\n"); err != nil {
					return
				}
				flusher.Flush()
			}
		}
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

// Flush keeps one-shot API responses (submission) on the wire before the
// review process shuts the server down.
func (g *gzipResponseWriter) Flush() {
	if !g.wrote {
		g.WriteHeader(http.StatusOK)
	}
	if !g.plain {
		_ = g.writer.Flush()
	}
	if flusher, ok := g.ResponseWriter.(http.Flusher); ok {
		flusher.Flush()
	}
}

func gzipMiddleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodHead || !strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") || r.URL.Path == "/api/events" {
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
	return listenServe(cfg.Host, cfg.Port, cfg.OpenBrowser, handler, "review 工作台", cfg.Out, cfg.Log, cfg.Ready, cfg.Stop)
}

// listen shares socket, URL and browser handling between one-diff and
// multi-PR modes.
func listen(host string, port int, open bool, handler http.Handler, title string) error {
	return listenServe(host, port, open, handler, title, nil, nil, nil, nil)
}

func listenServe(host string, port int, open bool, handler http.Handler, title string, out, logOut io.Writer, ready func([]string, int), stop <-chan struct{}) error {
	if host == "" {
		host = "0.0.0.0"
	}
	ln, err := net.Listen("tcp", net.JoinHostPort(host, fmt.Sprint(port)))
	if err != nil {
		return fmt.Errorf("监听失败: %w", err)
	}
	actual := ln.Addr().(*net.TCPAddr).Port
	urls := accessURLs(host, actual)
	if out == nil {
		out = os.Stdout
	}
	fmt.Fprintln(out, title+":")
	for _, url := range urls {
		fmt.Fprintln(out, "  "+url)
	}
	fmt.Fprintln(out, "端口:", actual)
	if logOut == nil {
		logOut = out
	}
	server := &http.Server{Handler: logRequests(handler, logOut)}
	if stop != nil {
		go func() {
			<-stop
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = server.Shutdown(ctx)
		}()
	}
	served := make(chan error, 1)
	go func() { served <- server.Serve(ln) }()
	if ready != nil {
		ready(urls, actual)
	}
	if open {
		go openBrowser(urls[0])
	}
	err = <-served
	if errors.Is(err, http.ErrServerClosed) {
		return nil
	}
	return err
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

// openBrowser 打开默认浏览器。只在本地有图形会话时调用。
func openBrowser(url string) {
	if os.Getenv("DISPLAY") == "" && os.Getenv("WAYLAND_DISPLAY") == "" {
		return
	}
	for _, name := range []string{"xdg-open", "open"} {
		if _, err := exec.LookPath(name); err != nil {
			continue
		}
		cmd := exec.Command(name, url)
		cmd.Stdout, cmd.Stderr = nil, nil
		_ = cmd.Start()
		return
	}
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
func logRequests(next http.Handler, out io.Writer) http.Handler {
	if out == nil {
		out = os.Stdout
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			fmt.Fprintf(out, "  %s %s %s\n", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
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

func flush(w http.ResponseWriter) {
	if flusher, ok := w.(http.Flusher); ok {
		flusher.Flush()
	}
}
