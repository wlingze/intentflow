package reviewflow

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
)

func ptr[T any](value T) *T { return &value }

func validRequest() contract.ReviewSubmission {
	line := int32(15)
	end := int32(17)
	side := contract.After
	file := "internal/store/store.go"
	return contract.ReviewSubmission{
		Action:       contract.Submit,
		ComparisonId: "comparison",
		Verdict:      ptr(contract.ReviewSubmissionVerdictRequestChanges),
		Summary:      ptr("fix the query"),
		Comments: &[]contract.SubmissionComment{
			{Id: "c-1", Body: "parameterize it", File: &file, Line: &line, EndLine: &end, Side: &side, Resolved: false},
			{Id: "c-2", Body: "overall note", Resolved: true},
		},
	}
}

func TestFromRequestValid(t *testing.T) {
	sub, err := FromRequest(validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if sub.Verdict != VerdictRequestChanges || sub.Summary != "fix the query" || len(sub.Comments) != 2 {
		t.Fatalf("submission = %+v", sub)
	}
	first := sub.Comments[0]
	if first.File == nil || *first.File != "internal/store/store.go" || first.Line == nil || *first.Line != 15 || *first.EndLine != 17 || first.Side == nil || *first.Side != "after" {
		t.Fatalf("anchored comment = %+v", first)
	}
	second := sub.Comments[1]
	if second.File != nil || second.Line != nil || second.Side != nil || !second.Resolved {
		t.Fatalf("general comment = %+v", second)
	}
}

func TestFromRequestRejects(t *testing.T) {
	bad := func(mutate func(*contract.ReviewSubmission)) error {
		req := validRequest()
		mutate(&req)
		_, err := FromRequest(req)
		return err
	}
	line := int32(3)
	side := contract.After
	cases := map[string]error{
		"missing verdict": bad(func(r *contract.ReviewSubmission) { r.Verdict = nil }),
		"unknown verdict": bad(func(r *contract.ReviewSubmission) {
			r.Verdict = ptr(contract.ReviewSubmissionVerdict("ship-it"))
		}),
		"empty body": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].Body = "  "
		}),
		"missing id": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].Id = ""
		}),
		"file without line": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].Line = nil
		}),
		"line without file": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[1].Line = &line
		}),
		"missing side": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].Side = nil
		}),
		"end before line": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].EndLine = ptr(int32(1))
		}),
		"bad side": bad(func(r *contract.ReviewSubmission) {
			(*r.Comments)[0].Side = ptr(contract.Side("middle"))
		}),
		"empty file": bad(func(r *contract.ReviewSubmission) {
			empty := ""
			(*r.Comments)[0].File = &empty
			(*r.Comments)[0].Side = &side
		}),
	}
	for name, err := range cases {
		if err == nil {
			t.Fatalf("%s: expected an error", name)
		}
	}
}

func TestWaiterSubmitWins(t *testing.T) {
	w := NewWaiter(Options{})
	sub, err := FromRequest(validRequest())
	if err != nil {
		t.Fatal(err)
	}
	if !w.Submit(sub) {
		t.Fatal("first submit refused")
	}
	if w.Submit(sub) {
		t.Fatal("second submit accepted")
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Second)
	defer cancel()
	outcome := w.Wait(ctx, func() Outcome { return Outcome{Status: StatusTimeout} })
	if outcome.Status != StatusSubmitted || outcome.Submission.Verdict != VerdictRequestChanges {
		t.Fatalf("outcome = %+v", outcome)
	}
	select {
	case <-w.Done():
	default:
		t.Fatal("Done not closed")
	}
}

func TestWaiterCancel(t *testing.T) {
	w := NewWaiter(Options{})
	if !w.Cancel(ReasonUser, "cancelled") {
		t.Fatal("cancel refused")
	}
	outcome := w.Wait(context.Background(), func() Outcome { return Outcome{Status: StatusTimeout} })
	if outcome.Status != StatusCancelled || outcome.Reason != ReasonUser {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestWaiterPageCloseGraceAndReconnect(t *testing.T) {
	w := NewWaiter(Options{Grace: 40 * time.Millisecond})
	w.ClientConnected()
	w.ClientDisconnected()
	time.Sleep(20 * time.Millisecond)
	w.ClientConnected() // refresh inside the grace window
	time.Sleep(80 * time.Millisecond)
	if w.Settled() {
		t.Fatal("reconnect did not stop the page-close timer")
	}
	w.ClientDisconnected()
	deadline := time.Now().Add(time.Second)
	for !w.Settled() && time.Now().Before(deadline) {
		time.Sleep(5 * time.Millisecond)
	}
	outcome := w.Wait(context.Background(), func() Outcome { return Outcome{Status: StatusTimeout} })
	if outcome.Status != StatusCancelled || outcome.Reason != ReasonPageClosed {
		t.Fatalf("outcome = %+v", outcome)
	}
}

func TestWaiterContextFallback(t *testing.T) {
	w := NewWaiter(Options{})
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	outcome := w.Wait(ctx, func() Outcome { return Outcome{Status: StatusCancelled, Reason: ReasonInterrupted} })
	if outcome.Status != StatusCancelled || outcome.Reason != ReasonInterrupted {
		t.Fatalf("outcome = %+v", outcome)
	}
	sub, _ := FromRequest(validRequest())
	if w.Submit(sub) {
		t.Fatal("submit accepted after context settlement")
	}
}

func TestResultEnvelopeHasFixedKeys(t *testing.T) {
	revision := &ResultRevision{ID: "range", Base: "a", Head: "b"}
	checks := []Result{
		SubmittedResult(Outcome{Submission: Submission{Verdict: VerdictApprove, Summary: "ok", Comments: []Comment{}}, At: time.Unix(1, 0)}, revision),
		CancelledResult(Outcome{Reason: ReasonUser}, revision),
		TimeoutResult(revision),
		ErrorResult(ReasonPatch, "bad patch", nil),
	}
	want := []string{"schema_version", "status", "reason", "verdict", "summary", "comments", "revision"}
	for _, result := range checks {
		raw, err := json.Marshal(result)
		if err != nil {
			t.Fatal(err)
		}
		var doc map[string]json.RawMessage
		if err := json.Unmarshal(raw, &doc); err != nil {
			t.Fatal(err)
		}
		if len(doc) != len(want) {
			t.Fatalf("%s keys = %v", result.Status, doc)
		}
		for _, key := range want {
			if _, ok := doc[key]; !ok {
				t.Fatalf("%s missing key %q: %s", result.Status, key, raw)
			}
		}
		if string(doc["comments"]) == "null" {
			t.Fatalf("%s comments null: %s", result.Status, raw)
		}
	}
}

func TestResultCommentsStayMinimalAndDropResolved(t *testing.T) {
	file := "internal/store/store.go"
	line := 7
	end := 8
	side := "after"
	quote := "old line"
	revision := &ResultRevision{ID: "range", Base: "base", Head: "head"}
	result := SubmittedResult(Outcome{Submission: Submission{
		Verdict: VerdictRequestChanges,
		Summary: "fix it",
		Comments: []Comment{
			{ID: "c-1", Body: "change old to new", File: &file, Line: &line, EndLine: &end, Side: &side, Quote: &quote},
			{ID: "c-2", Body: "already done", Resolved: true},
			{ID: "c-3", Body: "overall note"},
		},
	}}, revision)
	raw, err := json.Marshal(result)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Comments []map[string]json.RawMessage `json:"comments"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	if len(doc.Comments) != 2 {
		t.Fatalf("comments = %s", raw)
	}
	want := []string{"file", "line", "end_line", "side", "body"}
	for _, comment := range doc.Comments {
		if len(comment) != len(want) {
			t.Fatalf("comment keys = %v", comment)
		}
		for _, key := range want {
			if _, ok := comment[key]; !ok {
				t.Fatalf("comment missing %q: %s", key, raw)
			}
		}
	}
	if strings.Contains(string(raw), "quote") || strings.Contains(string(raw), "resolved") || strings.Contains(string(raw), "already done") {
		t.Fatalf("extra fields leaked: %s", raw)
	}
}

func TestMarkdownIncludesConcreteComments(t *testing.T) {
	file := "main.go"
	line := 2
	end := 2
	side := "after"
	quote := "new line"
	sub := Submission{
		Verdict: VerdictRequestChanges,
		Summary: "fix the line",
		Comments: []Comment{
			{ID: "c-1", Body: "change old to new", File: &file, Line: &line, EndLine: &end, Side: &side, Quote: &quote},
			{ID: "c-2", Body: "already done", Resolved: true},
			{ID: "c-3", Body: "overall note"},
		},
	}
	got := Markdown(contract.Payload{
		Review: contract.Review{Before: "HEAD", After: "WORKTREE", Notes: []string{"patch input"}},
		Session: contract.ReviewSession{Context: contract.ReviewContext{
			Repository: "repo", Branch: "main", Revision: "range", Base: "aaaaaaaaaaaaaaaa", Head: "bbbbbbbbbbbbbbbb",
		}},
	}, sub)
	for _, want := range []string{"# Review: HEAD → WORKTREE", "仓库：repo", "**request-changes**（要求修改）", "fix the line", "main.go:2 · 改动后", "> new line", "change old to new", "整体意见", "overall note", "patch input"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in:\n%s", want, got)
		}
	}
	if strings.Contains(got, "already done") {
		t.Fatalf("resolved comment leaked:\n%s", got)
	}
}

func TestResultExitCodes(t *testing.T) {
	revision := &ResultRevision{}
	cases := []struct {
		result Result
		code   int
	}{
		{SubmittedResult(Outcome{Submission: Submission{Verdict: VerdictComment}}, revision), 0},
		{CancelledResult(Outcome{Reason: ReasonUser}, revision), 2},
		{CancelledResult(Outcome{Reason: ReasonPageClosed}, revision), 2},
		{CancelledResult(Outcome{Reason: ReasonInterrupted}, revision), 130},
		{TimeoutResult(revision), 3},
		{ErrorResult(ReasonUsage, "bad", revision), 1},
	}
	for _, item := range cases {
		if got := item.result.ExitCode(); got != item.code {
			t.Fatalf("%s/%v: exit = %d, want %d", item.result.Status, item.result.Reason, got, item.code)
		}
	}
}

func TestWriteReady(t *testing.T) {
	path := filepath.Join(t.TempDir(), "ready.json")
	ready := Ready{SchemaVersion: 1, URL: "http://127.0.0.1:8123", Port: 8123, PID: 42}
	if err := WriteReady(path, ready); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var got Ready
	if err := json.Unmarshal(raw, &got); err != nil || got.URL != ready.URL || got.Port != 8123 {
		t.Fatalf("ready = %+v, err = %v", got, err)
	}
}
