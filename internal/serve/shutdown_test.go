package serve

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"

	"github.com/wlingze/intentflow/internal/contract"
)

func withShutdown(t *testing.T) (http.Handler, *Shutdown) {
	t.Helper()
	shutdown := NewShutdown()
	h, err := NewHandler(Config{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Payload:  func() contract.Payload { return contract.Payload{} },
		Shutdown: shutdown,
	})
	if err != nil {
		t.Fatal(err)
	}
	return h, shutdown
}

func shutdownRequest(t *testing.T, h http.Handler, remote, origin string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/api/shutdown", nil)
	req.RemoteAddr = remote
	req.Host = "192.168.5.6:37100"
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	return w
}

func TestShutdownEndpointStopsOnceAndStaysIdempotent(t *testing.T) {
	h, shutdown := withShutdown(t)
	w := shutdownRequest(t, h, "127.0.0.1:5555", "")
	if w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"closing"`) {
		t.Fatalf("shutdown: %d %s", w.Code, w.Body)
	}
	select {
	case <-shutdown.Done():
	default:
		t.Fatal("shutdown was not triggered")
	}
	// A retry from the same page must not error; it still reports closing.
	again := shutdownRequest(t, h, "127.0.0.1:5555", "")
	if again.Code != http.StatusOK {
		t.Fatalf("second shutdown: %d %s", again.Code, again.Body)
	}
}

func TestShutdownRejectsCrossOrigin(t *testing.T) {
	for _, remote := range []string{"192.168.5.9:4444", "127.0.0.1:5555"} {
		h, shutdown := withShutdown(t)
		w := shutdownRequest(t, h, remote, "https://evil.example")
		if w.Code != http.StatusForbidden {
			t.Fatalf("cross origin from %s: %d %s", remote, w.Code, w.Body)
		}
		select {
		case <-shutdown.Done():
			t.Fatalf("cross-origin request from %s stopped the server", remote)
		default:
		}
	}
}

func TestShutdownAllowsSameOriginOverLAN(t *testing.T) {
	h, shutdown := withShutdown(t)
	w := shutdownRequest(t, h, "192.168.5.9:4444", "http://192.168.5.6:37100")
	if w.Code != http.StatusOK {
		t.Fatalf("same origin: %d %s", w.Code, w.Body)
	}
	select {
	case <-shutdown.Done():
	default:
		t.Fatal("same-origin request did not stop the server")
	}
}

func TestShutdownRequiresPost(t *testing.T) {
	h, _ := withShutdown(t)
	req := httptest.NewRequest(http.MethodGet, "/api/shutdown", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	// GET 走到 SPA 的 404，不会触发关闭。
	if w.Code != http.StatusNotFound && w.Code != http.StatusMethodNotAllowed {
		t.Fatalf("GET shutdown: %d", w.Code)
	}
}

func TestShutdownAbsentWithoutConfig(t *testing.T) {
	h := newTestHandler(t)
	req := httptest.NewRequest(http.MethodPost, "/api/shutdown", nil)
	req.RemoteAddr = "127.0.0.1:5555"
	w := httptest.NewRecorder()
	h.ServeHTTP(w, req)
	if w.Code != http.StatusNotFound {
		t.Fatalf("shutdown without config: %d", w.Code)
	}
}
