package serve

import (
	"fmt"
	"io"
	"net/http"
	"testing"
	"testing/fstest"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
)

type runningServer struct {
	port int
	done chan error
}

func startServe(t *testing.T, handler http.Handler, stop <-chan struct{}, shutdown *Shutdown) runningServer {
	t.Helper()
	ready := make(chan int, 1)
	done := make(chan error, 1)
	go func() {
		done <- listenServe("127.0.0.1", 0, false, handler, "test", io.Discard, io.Discard, func(_ []string, port int) {
			ready <- port
		}, stop, shutdown)
	}()
	select {
	case port := <-ready:
		return runningServer{port: port, done: done}
	case err := <-done:
		t.Fatalf("server exited before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("server did not become ready")
	}
	return runningServer{}
}

func (s runningServer) wait(t *testing.T) error {
	t.Helper()
	select {
	case err := <-s.done:
		return err
	case <-time.After(5 * time.Second):
		t.Fatal("listenServe did not return after shutdown")
		return nil
	}
}

func testHandler(t *testing.T, shutdown *Shutdown) http.Handler {
	t.Helper()
	handler, err := NewHandler(Config{
		DistFS:   fstest.MapFS{"index.html": {Data: []byte("frontend")}},
		Payload:  func() contract.Payload { return contract.Payload{} },
		Shutdown: shutdown,
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func postShutdown(t *testing.T, port int) {
	t.Helper()
	req, err := http.NewRequest(http.MethodPost, fmt.Sprintf("http://127.0.0.1:%d/api/shutdown", port), nil)
	if err != nil {
		t.Fatal(err)
	}
	req.Header.Set("Origin", fmt.Sprintf("http://127.0.0.1:%d", port))
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("shutdown status = %d", resp.StatusCode)
	}
}

func TestListenServeReturnsAfterShutdown(t *testing.T) {
	shutdown := NewShutdown()
	srv := startServe(t, testHandler(t, shutdown), nil, shutdown)
	postShutdown(t, srv.port)
	if err := srv.wait(t); err != nil {
		t.Fatalf("listenServe returned %v", err)
	}
}

func TestListenServeReturnsAfterStop(t *testing.T) {
	stop := make(chan struct{})
	srv := startServe(t, testHandler(t, nil), stop, nil)
	close(stop)
	if err := srv.wait(t); err != nil {
		t.Fatalf("listenServe returned %v", err)
	}
}

// Shutdown 必须先等在途请求结束；超过 5 秒才强制 Close。
func TestListenServeDrainsActiveRequest(t *testing.T) {
	shutdown := NewShutdown()
	started := make(chan struct{})
	release := make(chan struct{})
	mux := http.NewServeMux()
	mux.HandleFunc("GET /slow", func(w http.ResponseWriter, r *http.Request) {
		close(started)
		<-release
		_, _ = io.WriteString(w, "done")
	})
	srv := startServe(t, mux, nil, shutdown)
	requestDone := make(chan struct{})
	go func() {
		resp, err := http.Get(fmt.Sprintf("http://127.0.0.1:%d/slow", srv.port))
		if err == nil {
			_, _ = io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
		close(requestDone)
	}()
	<-started
	shutdown.Trigger()
	select {
	case err := <-srv.done:
		t.Fatalf("listenServe returned %v before the active request finished", err)
	case <-time.After(150 * time.Millisecond):
	}
	close(release)
	<-requestDone
	if err := srv.wait(t); err != nil {
		t.Fatalf("listenServe returned %v", err)
	}
}
