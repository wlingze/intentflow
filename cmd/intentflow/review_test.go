package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wlingze/intentflow/internal/reviewflow"
)

const reviewPatch = `diff --git a/main.go b/main.go
index 1111111..2222222 100644
--- a/main.go
+++ b/main.go
@@ -1,3 +1,3 @@
 package main
-old line
+new line
 func main() {}
`

type reviewHarness struct {
	ctx    context.Context
	cancel context.CancelFunc
	done   chan struct{}
	err    error
	stdout *bytes.Buffer
	stderr *bytes.Buffer
	ready  reviewflow.Ready
}

func startReview(t *testing.T, args ...string) *reviewHarness {
	t.Helper()
	dir := t.TempDir()
	patch := filepath.Join(dir, "change.patch")
	if err := os.WriteFile(patch, []byte(reviewPatch), 0o644); err != nil {
		t.Fatal(err)
	}
	readyPath := filepath.Join(dir, "ready.json")
	dist := filepath.Join(dir, "dist")
	if err := os.MkdirAll(dist, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dist, "index.html"), []byte("embedded frontend"), 0o644); err != nil {
		t.Fatal(err)
	}
	args = append(args, "--diff", patch, "--ready-file", readyPath, "--no-open", "--dist", dist)
	ctx, cancel := context.WithCancel(context.Background())
	h := &reviewHarness{ctx: ctx, cancel: cancel, done: make(chan struct{}), stdout: &bytes.Buffer{}, stderr: &bytes.Buffer{}}
	go func() {
		h.err = reviewCommand(ctx, args, h.stdout, h.stderr)
		close(h.done)
	}()
	t.Cleanup(func() {
		cancel()
		select {
		case <-h.done:
		case <-time.After(5 * time.Second):
			t.Errorf("review command did not stop; stderr=%s", h.stderr.String())
		}
	})
	deadline := time.Now().Add(10 * time.Second)
	for {
		raw, err := os.ReadFile(readyPath)
		if err == nil {
			if err := json.Unmarshal(raw, &h.ready); err != nil {
				t.Fatalf("ready file: %v (%s)", err, raw)
			}
			break
		}
		select {
		case <-h.done:
			t.Fatalf("review exited before ready: %v; stderr=%s", h.err, h.stderr.String())
		default:
		}
		if time.Now().After(deadline) {
			t.Fatalf("ready file never appeared; stderr=%s", h.stderr.String())
		}
		time.Sleep(10 * time.Millisecond)
	}
	return h
}

func (h *reviewHarness) wait(t *testing.T) error {
	t.Helper()
	select {
	case <-h.done:
		return h.err
	case <-time.After(10 * time.Second):
		t.Fatalf("review did not exit; stderr=%s", h.stderr.String())
		return nil
	}
}

func (h *reviewHarness) post(t *testing.T, body string) (int, string) {
	t.Helper()
	var response *http.Response
	var err error
	for attempt := 0; attempt < 100; attempt++ {
		response, err = http.Post(h.ready.URL+"/api/submission", "application/json", strings.NewReader(body))
		if err == nil {
			break
		}
		time.Sleep(20 * time.Millisecond)
	}
	if err != nil {
		t.Fatalf("POST submission: %v", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	return response.StatusCode, string(raw)
}

func decodeOne(t *testing.T, raw []byte) reviewflow.Result {
	t.Helper()
	decoder := json.NewDecoder(bytes.NewReader(raw))
	var result reviewflow.Result
	if err := decoder.Decode(&result); err != nil {
		t.Fatalf("stdout is not JSON: %v\n%s", err, raw)
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		t.Fatalf("stdout has more than one JSON document: %s", raw)
	}
	return result
}

func submissionBody(comparisonID string) string {
	return fmt.Sprintf(`{"action":"submit","comparison_id":%q,"verdict":"request-changes","summary":"fix the line","comments":[{"id":"c-1","body":"change old to new","file":"main.go","line":2,"end_line":2,"side":"after","quote":"new line","resolved":false}]}`, comparisonID)
}

func TestReviewSubmitKeepsStdoutPureJSON(t *testing.T) {
	h := startReview(t, "--wait", "--json")
	status, body := h.post(t, submissionBody(h.ready.ComparisonID))
	if status != http.StatusOK {
		t.Fatalf("submit = %d %s", status, body)
	}
	if err := h.wait(t); err != nil {
		t.Fatalf("exit = %v; stdout=%s stderr=%s", err, h.stdout.String(), h.stderr.String())
	}
	result := decodeOne(t, h.stdout.Bytes())
	if result.SchemaVersion != 1 || result.Status != reviewflow.StatusSubmitted || result.Verdict == nil || *result.Verdict != reviewflow.VerdictRequestChanges {
		t.Fatalf("result = %+v", result)
	}
	if result.Revision == nil || result.Revision.Mode != "patch" || result.Revision.ID != "patch" || result.Revision.Base != "" || result.Revision.Head != "" {
		t.Fatalf("revision = %+v", result.Revision)
	}
	if len(result.Comments) != 1 || result.Comments[0].Body != "change old to new" || result.Comments[0].File == nil || *result.Comments[0].File != "main.go" || result.Comments[0].Line == nil || *result.Comments[0].Line != 2 {
		t.Fatalf("comments = %+v", result.Comments)
	}
	if strings.Contains(h.stdout.String(), "review 工作台") || strings.Contains(h.stdout.String(), "http://") {
		t.Fatalf("human log leaked to stdout: %s", h.stdout.String())
	}
	if !strings.Contains(h.stderr.String(), "review 工作台") {
		t.Fatalf("URL was not logged to stderr: %s", h.stderr.String())
	}
}

func TestReviewCancelExitsTwo(t *testing.T) {
	h := startReview(t, "--wait", "--json")
	status, _ := h.post(t, fmt.Sprintf(`{"action":"cancel","comparison_id":%q}`, h.ready.ComparisonID))
	if status != http.StatusOK {
		t.Fatalf("cancel = %d", status)
	}
	err := h.wait(t)
	var exit *exitStatus
	if !errors.As(err, &exit) || exit.code != 2 {
		t.Fatalf("exit = %v, want 2", err)
	}
	result := decodeOne(t, h.stdout.Bytes())
	if result.Status != reviewflow.StatusCancelled || result.Reason == nil || *result.Reason != reviewflow.ReasonUser || result.Verdict != nil {
		t.Fatalf("result = %+v", result)
	}
	if result.Comments == nil {
		t.Fatal("comments must be [] not null")
	}
}

func TestReviewTimeoutExitsThree(t *testing.T) {
	h := startReview(t, "--wait", "--json", "--timeout", "120ms")
	err := h.wait(t)
	var exit *exitStatus
	if !errors.As(err, &exit) || exit.code != 3 {
		t.Fatalf("exit = %v, want 3", err)
	}
	result := decodeOne(t, h.stdout.Bytes())
	if result.Status != reviewflow.StatusTimeout || result.Reason == nil || *result.Reason != reviewflow.ReasonTimeout {
		t.Fatalf("result = %+v", result)
	}
}

func TestReviewUsageErrorStillJSON(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := reviewCommand(context.Background(), []string{"--json", "--diff", "x", "--pr", "o/r#1"}, &stdout, &stderr)
	var exit *exitStatus
	if !errors.As(err, &exit) || exit.code != 1 {
		t.Fatalf("exit = %v, want 1", err)
	}
	result := decodeOne(t, stdout.Bytes())
	if result.Status != reviewflow.StatusError || result.Reason == nil || *result.Reason != reviewflow.ReasonUsage || result.Revision != nil {
		t.Fatalf("result = %+v", result)
	}
	if !strings.Contains(stderr.String(), "不能同时使用") {
		t.Fatalf("stderr = %s", stderr.String())
	}
}

func TestReviewFlagErrorStillJSON(t *testing.T) {
	var stdout, stderr bytes.Buffer
	err := reviewCommand(context.Background(), []string{"--json", "--timeout", "nope"}, &stdout, &stderr)
	var exit *exitStatus
	if !errors.As(err, &exit) || exit.code != 1 {
		t.Fatalf("exit = %v, want 1", err)
	}
	result := decodeOne(t, stdout.Bytes())
	if result.Status != reviewflow.StatusError || result.Reason == nil || *result.Reason != reviewflow.ReasonUsage {
		t.Fatalf("result = %+v", result)
	}
}

func TestJSONFlagPresent(t *testing.T) {
	cases := map[string]bool{
		"--json":       true,
		"-json":        true,
		"--json=true":  true,
		"--json=false": false,
		"--json=0":     false,
		"--no-json":    false,
	}
	for arg, want := range cases {
		if got := jsonFlagPresent([]string{arg}); got != want {
			t.Fatalf("%s = %v, want %v", arg, got, want)
		}
	}
}
