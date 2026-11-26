package serve

import (
	"net"
	"net/http"
	"net/url"
	"strings"
	"sync"
)

// Shutdown is the one-shot switch between the HTTP handler and the listener.
// Trigger is idempotent: a second close request still gets 200 but does not
// close the channel again.
type Shutdown struct {
	once sync.Once
	done chan struct{}
}

func NewShutdown() *Shutdown {
	return &Shutdown{done: make(chan struct{})}
}

func (s *Shutdown) Trigger() {
	if s == nil {
		return
	}
	s.once.Do(func() { close(s.done) })
}

func (s *Shutdown) Done() <-chan struct{} {
	if s == nil {
		return nil
	}
	return s.done
}

// allowShutdown 只接受同源页面或本机请求。
//
// 浏览器对跨站 POST 会带自己的 Origin；Origin 与 Host 不一致就拒绝，
// 因此其他网页无法用表单或 fetch 关掉本机服务。本机命令行（curl）没有
// Origin，按 RemoteAddr 放行。
func allowShutdown(r *http.Request) bool {
	// 浏览器对跨站 POST 会带自己的 Origin。Origin 存在时必须与 Host
	// 一致，即使请求来自本机，否则任意网页都能关掉本地服务。
	if origin := r.Header.Get("Origin"); origin != "" {
		parsed, err := url.Parse(origin)
		if err != nil || parsed.Host == "" {
			return false
		}
		return strings.EqualFold(parsed.Host, r.Host)
	}
	// 命令行（curl）没有 Origin；只放行本机连接。
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return false
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}

func shutdownHandler(shutdown *Shutdown) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if !allowShutdown(r) {
			writeError(w, http.StatusForbidden, "只允许同源页面或本机请求关闭服务")
			return
		}
		// Trigger after the body is on the wire: http.Server.Shutdown waits
		// for this handler to return, so the 200 is never truncated.
		writeJSON(w, http.StatusOK, map[string]string{"status": "closing"})
		flush(w)
		shutdown.Trigger()
	}
}
