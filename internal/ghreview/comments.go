package ghreview

import (
	"fmt"
	"strings"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/patch"
)

// LineRange is the set of lines one hunk exposes on one side.
type LineRange struct {
	Start int
	End   int
}

// FileRanges lists the old and new hunk ranges of one file.
type FileRanges struct {
	Old []LineRange
	New []LineRange
}

// DiffIndex tells whether a line is addressable by a GitHub review comment.
// GitHub rejects comments outside the current diff, so this check is the
// difference between an inline comment and a body fallback.
type DiffIndex struct {
	files map[string]FileRanges
}

// IndexPatch builds line ranges from the aggregate PR diff.
func IndexPatch(parsed *patch.Patch) DiffIndex {
	index := DiffIndex{files: map[string]FileRanges{}}
	if parsed == nil {
		return index
	}
	for _, file := range parsed.Files {
		ranges := FileRanges{}
		for _, hunk := range file.Hunks {
			if hunk.OldLines > 0 {
				ranges.Old = append(ranges.Old, LineRange{Start: hunk.OldStart, End: hunk.OldStart + hunk.OldLines - 1})
			}
			if hunk.NewLines > 0 {
				ranges.New = append(ranges.New, LineRange{Start: hunk.NewStart, End: hunk.NewStart + hunk.NewLines - 1})
			}
		}
		index.files[file.Path] = ranges
	}
	return index
}

// Valid reports whether start..end is inside one hunk on the requested side.
func (i DiffIndex) Valid(path string, side contract.Side, start, end int32) bool {
	if start < 1 || end < 1 {
		return false
	}
	if start > end {
		start, end = end, start
	}
	ranges, ok := i.files[path]
	if !ok {
		return false
	}
	list := ranges.New
	if side == contract.Before {
		list = ranges.Old
	}
	for _, item := range list {
		if int(start) >= item.Start && int(end) <= item.End {
			return true
		}
	}
	return false
}

// SkippedComment is a comment that could not be attached inline. The reason
// is written into the review body so the reviewer still sees it.
type SkippedComment struct {
	ID     string `json:"id"`
	Path   string `json:"path,omitempty"`
	Side   string `json:"side,omitempty"`
	Start  int32  `json:"start,omitempty"`
	End    int32  `json:"end,omitempty"`
	Text   string `json:"text"`
	Reason string `json:"reason"`
}

// Mapped is one review ready for the GitHub API.
type Mapped struct {
	Body     string           `json:"body"`
	Comments []SubmitComment  `json:"comments"`
	Skipped  []SkippedComment `json:"skipped"`
	Imported int              `json:"imported"`
	Resolved int              `json:"resolved"`
}

// MapReview converts intentflow comments into GitHub review comments.
//
// Existing GitHub comments (IDs starting with gh-) and locally resolved
// comments are not submitted again. Comments without a quote, or whose line
// is outside the current diff, go into the review body. bodyPrefix is the
// user's --body text and comes first.
func MapReview(doc contract.ReviewSession, diff []byte, bodyPrefix string) (Mapped, error) {
	parsed, err := patch.Parse(diff)
	if err != nil {
		return Mapped{}, fmt.Errorf("解析 PR diff 失败: %w", err)
	}
	index := IndexPatch(parsed)
	mapped := Mapped{Comments: []SubmitComment{}, Skipped: []SkippedComment{}}
	body := []string{}
	if strings.TrimSpace(bodyPrefix) != "" {
		body = append(body, strings.TrimSpace(bodyPrefix))
	}
	general := []string{}
	unmapped := []string{}
	for _, comment := range doc.Comments {
		if strings.HasPrefix(comment.Id, "gh-") {
			mapped.Imported++
			continue
		}
		if comment.Resolved != nil && *comment.Resolved {
			mapped.Resolved++
			continue
		}
		text := commentBody(comment)
		if strings.TrimSpace(text) == "" {
			continue
		}
		if comment.Quote == nil {
			general = append(general, "- "+oneLine(text))
			continue
		}
		quote := comment.Quote
		side := contract.After
		if quote.Side == contract.Before {
			side = contract.Before
		}
		if !index.Valid(quote.File, side, quote.Start, quote.End) {
			reason := "行号不在当前 diff 的 hunk 内（outdated 或未改动行）"
			mapped.Skipped = append(mapped.Skipped, SkippedComment{
				ID: comment.Id, Path: quote.File, Side: string(side), Start: quote.Start, End: quote.End, Text: text, Reason: reason,
			})
			unmapped = append(unmapped, fmt.Sprintf("- `%s:%d`（%s）：%s", quote.File, quote.End, sideLabel(side), oneLine(text)))
			continue
		}
		start, end := quote.Start, quote.End
		if start > end {
			start, end = end, start
		}
		submit := SubmitComment{Path: quote.File, Body: text, Line: int(end), Side: sideName(side)}
		if start != end {
			submit.StartLine = int(start)
			submit.StartSide = sideName(side)
		}
		mapped.Comments = append(mapped.Comments, submit)
	}
	if len(general) > 0 {
		body = append(body, "## 整体意见\n\n"+strings.Join(general, "\n"))
	}
	if len(unmapped) > 0 {
		body = append(body, "## 未映射到当前 diff 的评论\n\n"+strings.Join(unmapped, "\n"))
	}
	mapped.Body = strings.Join(body, "\n\n")
	return mapped, nil
}

// ImportComments turns GitHub review comments into intentflow comments so
// they appear in the workbench next to the diff.
func ImportComments(items []ReviewComment) []contract.Comment {
	out := make([]contract.Comment, 0, len(items))
	for _, item := range items {
		comment := contract.Comment{
			Id:        fmt.Sprintf("gh-%d", item.ID),
			Text:      item.Body,
			Title:     "",
			Source:    contract.CommentSourceManual,
			SignalId:  "",
			CreatedAt: item.CreatedAt.Unix(),
		}
		side, line, start, ok := commentAnchor(item)
		if ok {
			comment.Quote = &contract.Quote{File: item.Path, Side: side, Start: start, End: line, Snippet: ""}
		} else if item.Path != "" {
			comment.Title = item.Path
		}
		out = append(out, comment)
	}
	return out
}

func commentAnchor(item ReviewComment) (contract.Side, int32, int32, bool) {
	if item.Path == "" {
		return contract.After, 0, 0, false
	}
	side := contract.After
	if item.Side == "LEFT" || item.OriginalSide == "LEFT" {
		side = contract.Before
	}
	line := item.Line
	if line == nil {
		line = item.OriginalLine
	}
	if line == nil || *line < 1 {
		return side, 0, 0, false
	}
	start := item.StartLine
	if start == nil {
		start = item.OriginalStartLine
	}
	if start == nil || *start < 1 || *start > *line {
		start = line
	}
	return side, int32(*line), int32(*start), true
}

func commentBody(comment contract.Comment) string {
	text := strings.TrimSpace(comment.Text)
	if strings.TrimSpace(comment.Title) == "" {
		return text
	}
	if text == "" {
		return comment.Title
	}
	return "**" + comment.Title + "**\n\n" + text
}

func oneLine(text string) string {
	return strings.Join(strings.Fields(text), " ")
}

func sideName(side contract.Side) string {
	if side == contract.Before {
		return "LEFT"
	}
	return "RIGHT"
}

func sideLabel(side contract.Side) string {
	if side == contract.Before {
		return "改动前"
	}
	return "改动后"
}
