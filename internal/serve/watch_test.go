package serve

import (
	"bufio"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
)

func testWatcher(value *atomic.Value) *Watcher {
	w := NewWatcher(func() (string, error) { return value.Load().(string), nil })
	w.interval = 10 * time.Millisecond
	w.settle = 20 * time.Millisecond
	return w
}

func waitBaseline(t *testing.T, w *Watcher) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		w.mu.Lock()
		ready := w.last != ""
		w.mu.Unlock()
		if ready {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("watcher did not read its baseline")
}

func TestWatcherEmitsOneSettledChange(t *testing.T) {
	var value atomic.Value
	value.Store("v1")
	w := testWatcher(&value)
	defer w.Stop()
	changes, unsubscribe := w.Subscribe()
	defer unsubscribe()
	waitBaseline(t, w)

	value.Store("v2")
	select {
	case <-changes:
	case <-time.After(2 * time.Second):
		t.Fatal("no change event")
	}
	select {
	case <-changes:
		t.Fatal("duplicate change event for one save")
	case <-time.After(150 * time.Millisecond):
	}
}

func TestWatcherDebouncesRapidWrites(t *testing.T) {
	var value atomic.Value
	value.Store("v1")
	w := testWatcher(&value)
	defer w.Stop()
	changes, unsubscribe := w.Subscribe()
	defer unsubscribe()
	waitBaseline(t, w)

	// 保存过程中的中间状态不应各推一次。
	value.Store("tmp")
	time.Sleep(5 * time.Millisecond)
	value.Store("final")
	select {
	case <-changes:
	case <-time.After(2 * time.Second):
		t.Fatal("no change event")
	}
	select {
	case <-changes:
		t.Fatal("rapid writes produced more than one event")
	case <-time.After(150 * time.Millisecond):
	}
}

func TestEventsStreamPushesRepoChanged(t *testing.T) {
	var value atomic.Value
	value.Store("v1")
	w := testWatcher(&value)
	defer w.Stop()
	shutdown := NewShutdown()
	h, err := NewHandler(Config{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Payload:  func() contract.Payload { return contract.Payload{} },
		Watcher:  w,
		Shutdown: shutdown,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()

	client := &http.Client{Transport: &http.Transport{DisableCompression: true}}
	req, err := http.NewRequest(http.MethodGet, srv.URL+"/api/events", nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Accept-Encoding", "gzip")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if got := resp.Header.Get("Content-Encoding"); got != "" {
		t.Fatalf("SSE was compressed: %q", got)
	}
	if got := resp.Header.Get("Content-Type"); got == "" || got[:17] != "text/event-stream" {
		t.Fatalf("Content-Type = %q", got)
	}

	lines := make(chan string, 32)
	go func() {
		scanner := bufio.NewScanner(resp.Body)
		for scanner.Scan() {
			lines <- scanner.Text()
		}
		close(lines)
	}()
	waitLine := func(want string) {
		t.Helper()
		deadline := time.After(3 * time.Second)
		for {
			select {
			case line, ok := <-lines:
				if !ok {
					t.Fatalf("stream closed before %q", want)
				}
				if line == want {
					return
				}
			case <-deadline:
				t.Fatalf("timeout waiting for %q", want)
			}
		}
	}
	waitLine("retry: 1000")
	waitBaseline(t, w)
	value.Store("v2")
	waitLine("event: repo-changed")
}

func TestPayloadCapabilities(t *testing.T) {
	shutdown := NewShutdown()
	watcher := NewWatcher(func() (string, error) { return "", nil })
	h, err := NewHandler(Config{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Payload:  func() contract.Payload { return contract.Payload{} },
		Shutdown: shutdown,
		Watcher:  watcher,
	})
	if err != nil {
		t.Fatal(err)
	}
	w := httptest.NewRecorder()
	h.ServeHTTP(w, httptest.NewRequest(http.MethodGet, "/api/payload", nil))
	var payload contract.Payload
	if err := json.Unmarshal(w.Body.Bytes(), &payload); err != nil {
		t.Fatal(err)
	}
	if payload.Capabilities == nil || !payload.Capabilities.Shutdown || !payload.Capabilities.Watch {
		t.Fatalf("capabilities = %+v", payload.Capabilities)
	}

	// 静态导出没有服务端能力，字段必须缺省。
	plain := newTestHandler(t)
	raw := httptest.NewRecorder()
	plain.ServeHTTP(raw, httptest.NewRequest(http.MethodGet, "/api/payload", nil))
	var static contract.Payload
	if err := json.Unmarshal(raw.Body.Bytes(), &static); err != nil {
		t.Fatal(err)
	}
	if static.Capabilities != nil {
		t.Fatalf("static payload has capabilities: %+v", static.Capabilities)
	}
}

func TestEventsStreamEndsOnShutdown(t *testing.T) {
	shutdown := NewShutdown()
	h, err := NewHandler(Config{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Payload:  func() contract.Payload { return contract.Payload{} },
		Shutdown: shutdown,
	})
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(h)
	defer srv.Close()
	resp, err := http.Get(srv.URL + "/api/events")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	shutdown.Trigger()
	done := make(chan error, 1)
	go func() {
		_, err := io.ReadAll(resp.Body)
		done <- err
	}()
	select {
	case <-done:
	case <-time.After(3 * time.Second):
		t.Fatal("SSE stream stayed open after shutdown")
	}
}
