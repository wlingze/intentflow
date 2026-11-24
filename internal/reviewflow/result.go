package reviewflow

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"

	"github.com/wlingze/intentflow/internal/contract"
)

// Revision describes the comparison a submission belongs to. It is also the
// input description used when the CLI builds a patch or PR payload.
type Revision struct {
	ID         string
	Mode       string
	Repository string
	Branch     string
	Base       string
	Head       string
	BaseLabel  string
	HeadLabel  string
}

// ResultRevision is the small revision block in the CLI JSON.
type ResultRevision struct {
	ID   string `json:"id"`
	Base string `json:"base"`
	Head string `json:"head"`
}

// OutputComment is one actionable comment in the CLI JSON. Resolved comments
// and quote snippets stay in the human Markdown only.
type OutputComment struct {
	File    *string `json:"file"`
	Line    *int    `json:"line"`
	EndLine *int    `json:"end_line"`
	Side    *string `json:"side"`
	Body    string  `json:"body"`
}

// Result is the one JSON document `intentflow review --json` writes to stdout.
// Message and Markdown are human channels and never enter JSON.
type Result struct {
	SchemaVersion int             `json:"schema_version"`
	Status        string          `json:"status"`
	Reason        *string         `json:"reason"`
	Verdict       *Verdict        `json:"verdict"`
	Summary       *string         `json:"summary"`
	Comments      []OutputComment `json:"comments"`
	Revision      *ResultRevision `json:"revision"`

	Message  string `json:"-"`
	Markdown string `json:"-"`
}

// RevisionFromPayload copies the identity a page was looking at.
func RevisionFromPayload(p contract.Payload) *ResultRevision {
	ctx := p.Session.Context
	return &ResultRevision{ID: ctx.Revision, Base: ctx.Base, Head: ctx.Head}
}

func newResult(status string, revision *ResultRevision) Result {
	return Result{SchemaVersion: SchemaVersion, Status: status, Comments: []OutputComment{}, Revision: revision}
}

// SubmittedResult is emitted when the human clicked 提交并关闭.
func SubmittedResult(outcome Outcome, revision *ResultRevision) Result {
	result := newResult(StatusSubmitted, revision)
	verdict := outcome.Submission.Verdict
	summary := outcome.Submission.Summary
	result.Verdict = &verdict
	result.Summary = &summary
	for _, comment := range outcome.Submission.Comments {
		// A resolved comment is no longer a task. Keep it out of the machine
		// output, including the overall comments that only carry a body.
		if comment.Resolved {
			continue
		}
		result.Comments = append(result.Comments, OutputComment{
			File: comment.File, Line: comment.Line, EndLine: comment.EndLine,
			Side: comment.Side, Body: comment.Body,
		})
	}
	return result
}

// CancelledResult is emitted for an explicit cancel, a closed page or a
// signal. The reason stays machine readable; message is for humans.
func CancelledResult(outcome Outcome, revision *ResultRevision) Result {
	result := newResult(StatusCancelled, revision)
	reason := outcome.Reason
	if reason == "" {
		reason = ReasonUser
	}
	result.Reason = &reason
	result.Message = outcome.Message
	return result
}

// TimeoutResult is emitted when --timeout expires.
func TimeoutResult(revision *ResultRevision) Result {
	result := newResult(StatusTimeout, revision)
	reason := ReasonTimeout
	result.Reason = &reason
	result.Message = "等待审阅超时，未收到提交"
	return result
}

// ErrorResult is emitted after the flags were parsed. Early flag parse errors
// still go to stderr because the output mode is not known yet.
func ErrorResult(reason, message string, revision *ResultRevision) Result {
	result := newResult(StatusError, revision)
	result.Reason = &reason
	result.Message = message
	return result
}

// ExitCode maps the envelope to the documented process exit code.
func (r Result) ExitCode() int {
	switch r.Status {
	case StatusSubmitted:
		return ExitSubmitted
	case StatusTimeout:
		return ExitTimeout
	case StatusError:
		return ExitError
	case StatusCancelled:
		if r.Reason != nil && *r.Reason == ReasonInterrupted {
			return ExitInterrupted
		}
		return ExitCancelled
	default:
		return ExitError
	}
}

// WriteJSON writes exactly one JSON document plus a trailing newline.
func (r Result) WriteJSON(w io.Writer) error {
	encoder := json.NewEncoder(w)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(r); err != nil {
		return fmt.Errorf("写结果 JSON 失败: %w", err)
	}
	return nil
}

// Ready is written to --ready-file once the listener is bound.
type Ready struct {
	SchemaVersion int    `json:"schema_version"`
	URL           string `json:"url"`
	Port          int    `json:"port"`
	PID           int    `json:"pid"`
	SessionID     string `json:"session_id"`
	ComparisonID  string `json:"comparison_id"`
}

// WriteReady writes atomically: a reader never sees a half-written file.
func WriteReady(path string, ready Ready) error {
	raw, err := json.Marshal(ready)
	if err != nil {
		return err
	}
	raw = append(raw, '\n')
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".intentflow-ready-*")
	if err != nil {
		return fmt.Errorf("写 ready 文件失败: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(raw); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return fmt.Errorf("写 ready 文件失败: %w", err)
	}
	return nil
}
