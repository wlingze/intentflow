// Package serve 提供 review 工作台的 HTTP 层。
//
// 职责只有三件事：
//   - GET  /api/payload  返回一次分析的全部数据
//   - POST /api/review   把用户整理的 review 写成 review.md
//   - 其余路径           托管 frontend/dist（不做 embed）
package serve

import (
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/yaklang/intentflow/internal/contract"
)

// Config 是 server 的启动参数。
type Config struct {
	Addr    string
	DistDir string
	OutDir  string
	Payload contract.Payload
	// Commits 返回可选的提交列表；nil 表示目录模式。
	Commits func() (contract.CommitList, error)
	// Rebuild 按选中的提交重建 payload；selected 为空表示全部提交。
	Rebuild func(selected []string) (contract.Payload, error)
}

// NewHandler 组装 API 与静态资源。dist 不存在时返回可读错误，
// 而不是在浏览器里给出一个空目录。
func NewHandler(cfg Config) (http.Handler, error) {
	index := filepath.Join(cfg.DistDir, "index.html")
	if _, err := os.Stat(index); err != nil {
		return nil, fmt.Errorf("前端产物不存在: %s\n先在 frontend/ 运行 pnpm install && pnpm build，或用 --dist 指定目录", index)
	}

	body, err := json.Marshal(cfg.Payload)
	if err != nil {
		return nil, fmt.Errorf("序列化 payload 失败: %w", err)
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/payload", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		if cfg.Rebuild != nil && r.URL.Query().Has("commits") {
			selected := parseSelection(r.URL.Query().Get("commits"))
			payload, err := cfg.Rebuild(selected)
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			_ = json.NewEncoder(w).Encode(payload)
			return
		}
		_, _ = w.Write(body)
	})

	if cfg.Commits != nil {
		mux.HandleFunc("GET /api/commits", func(w http.ResponseWriter, r *http.Request) {
			list, err := cfg.Commits()
			if err != nil {
				writeError(w, http.StatusInternalServerError, err.Error())
				return
			}
			writeJSON(w, http.StatusOK, list)
		})
	}

	mux.HandleFunc("POST /api/review", func(w http.ResponseWriter, r *http.Request) {
		defer r.Body.Close()
		raw, err := io.ReadAll(io.LimitReader(r.Body, 16<<20))
		if err != nil {
			writeError(w, http.StatusBadRequest, "读取请求失败")
			return
		}
		var req contract.ReviewRequest
		if err := json.Unmarshal(raw, &req); err != nil {
			writeError(w, http.StatusBadRequest, "请求不是合法 JSON")
			return
		}
		if strings.TrimSpace(req.Markdown) == "" {
			writeError(w, http.StatusBadRequest, "markdown 不能为空")
			return
		}
		target, err := writeReview(cfg.OutDir, req)
		if err != nil {
			writeError(w, http.StatusInternalServerError, err.Error())
			return
		}
		writeJSON(w, http.StatusOK, contract.ReviewResponse{Path: target})
	})

	mux.Handle("/", spaHandler(cfg.DistDir))
	return mux, nil
}

// Listen 启动 HTTP 服务，并在启动后打印实际监听地址。
func Listen(cfg Config) error {
	handler, err := NewHandler(cfg)
	if err != nil {
		return err
	}
	addr := cfg.Addr
	if addr == "" {
		addr = "127.0.0.1:8123"
	}
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		return fmt.Errorf("监听 %s 失败: %w", addr, err)
	}
	fmt.Printf("review 工作台: http://%s\n", prettyAddr(ln.Addr().String()))
	return http.Serve(ln, logRequests(handler))
}

// parseSelection 把逗号分隔的提交 SHA 列表解析成去重切片。
func parseSelection(raw string) []string {
	out := []string{}
	seen := map[string]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		sha := strings.TrimSpace(part)
		if sha == "" {
			continue
		}
		if _, ok := seen[sha]; ok {
			continue
		}
		seen[sha] = struct{}{}
		out = append(out, sha)
	}
	return out
}

// writeReview 原子写入 review.md，避免中途失败留下半个文件。
func writeReview(dir string, req contract.ReviewRequest) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("创建输出目录失败: %w", err)
	}
	target := filepath.Join(dir, "review.md")
	tmp, err := os.CreateTemp(dir, ".review-*.md")
	if err != nil {
		return "", fmt.Errorf("写入 review.md 失败: %w", err)
	}
	defer os.Remove(tmp.Name())

	if err := tmp.Chmod(0o644); err != nil {
		tmp.Close()
		return "", fmt.Errorf("设置 review.md 权限失败: %w", err)
	}
	if _, err := tmp.WriteString(req.Markdown); err != nil {
		tmp.Close()
		return "", fmt.Errorf("写入 review.md 失败: %w", err)
	}
	if err := tmp.Close(); err != nil {
		return "", fmt.Errorf("写入 review.md 失败: %w", err)
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		return "", fmt.Errorf("替换 review.md 失败: %w", err)
	}

	// 附带一份结构化评论，方便后续工具读取；失败不影响主流程。
	if raw, err := json.Marshal(req.Data); err == nil {
		_ = os.WriteFile(filepath.Join(dir, "review-state.json"), raw, 0o644)
	}
	return target, nil
}

// spaHandler 托管静态资源，并把无扩展名的路径回落到 index.html。
func spaHandler(dist string) http.Handler {
	files := http.FileServer(http.Dir(dist))
	index := filepath.Join(dist, "index.html")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := path.Clean("/" + r.URL.Path)
		rel := strings.TrimPrefix(clean, "/")
		if rel == "" || rel == "." {
			http.ServeFile(w, r, index)
			return
		}
		full := filepath.Join(dist, filepath.FromSlash(rel))
		if info, err := os.Stat(full); err == nil && !info.IsDir() {
			files.ServeHTTP(w, r)
			return
		}
		if strings.HasPrefix(rel, "api/") || path.Ext(rel) != "" {
			http.NotFound(w, r)
			return
		}
		http.ServeFile(w, r, index)
	})
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

func prettyAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if host == "::" || host == "0.0.0.0" || host == "" {
		host = "127.0.0.1"
	}
	return net.JoinHostPort(host, port)
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}

func writeError(w http.ResponseWriter, status int, message string) {
	writeJSON(w, status, map[string]string{"error": message})
}
