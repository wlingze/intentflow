// Package reviewflow defines the machine protocol for `intentflow review`.
//
// The package is shared by the HTTP server (which receives one submission)
// and the CLI (which prints one stable JSON document). stdout is reserved for
// that document: every human message belongs on stderr.
package reviewflow

import (
	"fmt"
	"strings"

	"github.com/wlingze/intentflow/internal/contract"
)

// SchemaVersion is the version of the result envelope on stdout.
const SchemaVersion = 1

// Exit codes are part of the protocol: agents branch on them.
const (
	ExitSubmitted   = 0
	ExitError       = 1
	ExitCancelled   = 2
	ExitTimeout     = 3
	ExitInterrupted = 130
)

// Status values of the result envelope.
const (
	StatusSubmitted = "submitted"
	StatusCancelled = "cancelled"
	StatusTimeout   = "timeout"
	StatusError     = "error"
)

// Cancel reasons.
const (
	ReasonUser        = "user"
	ReasonPageClosed  = "page-closed"
	ReasonInterrupted = "interrupted"
	ReasonTimeout     = "timeout"
)

// Error reasons.
const (
	ReasonUsage    = "usage"
	ReasonGit      = "git"
	ReasonPatch    = "patch"
	ReasonPR       = "pr"
	ReasonListen   = "listen"
	ReasonInternal = "internal"
)

// Verdict is the human's overall conclusion.
type Verdict string

const (
	VerdictApprove        Verdict = "approve"
	VerdictRequestChanges Verdict = "request-changes"
	VerdictComment        Verdict = "comment"
)

// Valid reports whether v is one of the three wire values.
func (v Verdict) Valid() bool {
	switch v {
	case VerdictApprove, VerdictRequestChanges, VerdictComment:
		return true
	}
	return false
}

// Comment is one review comment in the result JSON. A comment without a file
// is a general remark; its anchor fields stay null.
type Comment struct {
	ID       string  `json:"id"`
	Body     string  `json:"body"`
	File     *string `json:"file"`
	Line     *int    `json:"line"`
	EndLine  *int    `json:"end_line"`
	Side     *string `json:"side"`
	Quote    *string `json:"quote"`
	Resolved bool    `json:"resolved"`
}

// Submission is a validated review submission.
type Submission struct {
	Verdict  Verdict
	Summary  string
	Comments []Comment
}

const (
	maxCommentBody = 64 << 10
	maxSummary     = 64 << 10
	maxComments    = 1000
	maxFile        = 1024
)

// FromRequest validates the wire request and converts it to the internal
// shape. The caller handles action=cancel before calling this.
func FromRequest(req contract.ReviewSubmission) (Submission, error) {
	if req.Verdict == nil {
		return Submission{}, fmt.Errorf("提交缺少 verdict")
	}
	verdict := Verdict(*req.Verdict)
	if !verdict.Valid() {
		return Submission{}, fmt.Errorf("未知 verdict %q", *req.Verdict)
	}
	summary := ""
	if req.Summary != nil {
		summary = *req.Summary
		if len(summary) > maxSummary {
			return Submission{}, fmt.Errorf("summary 超过 %d 字节", maxSummary)
		}
	}
	var raw []contract.SubmissionComment
	if req.Comments != nil {
		raw = *req.Comments
	}
	if len(raw) > maxComments {
		return Submission{}, fmt.Errorf("评论超过 %d 条", maxComments)
	}
	comments := make([]Comment, 0, len(raw))
	for index, item := range raw {
		comment, err := fromComment(item)
		if err != nil {
			return Submission{}, fmt.Errorf("第 %d 条评论：%w", index+1, err)
		}
		comments = append(comments, comment)
	}
	return Submission{Verdict: verdict, Summary: summary, Comments: comments}, nil
}

func fromComment(item contract.SubmissionComment) (Comment, error) {
	if strings.TrimSpace(item.Id) == "" {
		return Comment{}, fmt.Errorf("id 不能为空")
	}
	if strings.TrimSpace(item.Body) == "" {
		return Comment{}, fmt.Errorf("正文不能为空")
	}
	if len(item.Body) > maxCommentBody {
		return Comment{}, fmt.Errorf("正文超过 %d 字节", maxCommentBody)
	}
	comment := Comment{
		ID: item.Id, Body: item.Body, Resolved: item.Resolved,
		Quote: trimPtr(item.Quote),
	}
	file := ""
	if item.File != nil {
		file = strings.TrimSpace(*item.File)
	}
	if file == "" {
		if (item.Line != nil && *item.Line != 0) || (item.EndLine != nil && *item.EndLine != 0) || (item.Side != nil && *item.Side != "") {
			return Comment{}, fmt.Errorf("没有 file 时不能带行号或 side")
		}
		return comment, nil
	}
	if len(file) > maxFile {
		return Comment{}, fmt.Errorf("file 超过 %d 字节", maxFile)
	}
	if item.Line == nil || *item.Line < 1 {
		return Comment{}, fmt.Errorf("有 file 时 line 必须 ≥ 1")
	}
	line := int(*item.Line)
	end := line
	if item.EndLine != nil && *item.EndLine != 0 {
		end = int(*item.EndLine)
	}
	if end < line {
		return Comment{}, fmt.Errorf("end_line 必须 ≥ line")
	}
	if item.Side == nil || (*item.Side != contract.Before && *item.Side != contract.After) {
		return Comment{}, fmt.Errorf("有 file 时 side 必须是 before 或 after")
	}
	side := string(*item.Side)
	comment.File = &file
	comment.Line = &line
	comment.EndLine = &end
	comment.Side = &side
	return comment, nil
}

func trimPtr(value *string) *string {
	if value == nil {
		return nil
	}
	trimmed := strings.TrimSpace(*value)
	if trimmed == "" {
		return nil
	}
	return value
}
