package reviewflow

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
)

// Revision describes the comparison a submission belongs to.
type Revision struct {
	ID           string `json:"id"`
	Mode         string `json:"mode"`
	Repository   string `json:"repository"`
	Branch       string `json:"branch"`
	Subdir       string `json:"subdir"`
	Base         string `json:"base"`
	Head         string `json:"head"`
	BaseLabel    string `json:"base_label"`
	HeadLabel    string `json:"head_label"`
	SessionID    string `json:"session_id"`
	ComparisonID string `json:"comparison_id"`
	DiffDigest   string `json:"diff_digest"`
}

// Result is the one JSON document `intentflow review --json` writes to stdout.
// Every field is always present so agents can read a fixed schema.
type Result struct {
	SchemaVersion int       `json:"schema_version"`
	Status        string    `json:"status"`
	Reason        *string   `json:"reason"`
	Message       string    `json:"message"`
	Verdict       *Verdict  `json:"verdict"`
	Summary       *string   `json:"summary"`
	Comments      []Comment `json:"comments"`
	Revision      *Revision `json:"revision"`
	SubmittedAt   *string   `json:"submitted_at"`
}

// RevisionFromPayload copies the identity a page was looking at.
func RevisionFromPayload(p contract.Payload) *Revision {
	ctx := p.Session.Context
	return &Revision{
		ID:           ctx.Revision,
		Mode:         string(p.Review.Comparison.Mode),
		Repository:   ctx.Repository,
		Branch:       ctx.Branch,
		Subdir:       ctx.Subdir,
		Base:         ctx.Base,
		Head:         ctx.Head,
		BaseLabel:    p.Review.Comparison.BeforeLabel,
		HeadLabel:    p.Review.Comparison.AfterLabel,
		SessionID:    ctx.SessionId,
		ComparisonID: ctx.ComparisonId,
		DiffDigest:   ctx.DiffDigest,
	}
}

func newResult(status string, revision *Revision) Result {
	return Result{SchemaVersion: SchemaVersion, Status: status, Comments: []Comment{}, Revision: revision}
}

// SubmittedResult is emitted when the human clicked 提交并关闭.
func SubmittedResult(outcome Outcome, revision *Revision) Result {
	result := newResult(StatusSubmitted, revision)
	verdict := outcome.Submission.Verdict
	summary := outcome.Submission.Summary
	result.Verdict = &verdict
	result.Summary = &summary
	if outcome.Submission.Comments != nil {
		result.Comments = outcome.Submission.Comments
	}
	if !outcome.At.IsZero() {
		at := outcome.At.UTC().Format(time.RFC3339)
		result.SubmittedAt = &at
	}
	return result
}

// CancelledResult is emitted for an explicit cancel, a closed page or a
// signal. The reason stays machine readable; message is for humans.
func CancelledResult(outcome Outcome, revision *Revision) Result {
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
func TimeoutResult(revision *Revision) Result {
	result := newResult(StatusTimeout, revision)
	reason := ReasonTimeout
	result.Reason = &reason
	result.Message = "等待审阅超时，未收到提交"
	return result
}

// ErrorResult is emitted after the flags were parsed. Early flag parse errors
// still go to stderr because the output mode is not known yet.
func ErrorResult(reason, message string, revision *Revision) Result {
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
