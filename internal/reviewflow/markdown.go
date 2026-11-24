package reviewflow

import (
	"fmt"
	"strings"

	"github.com/wlingze/intentflow/internal/contract"
)

// Markdown renders the submitted review for a human. It is the non-JSON
// stdout format: the same verdict, summary and comments the page showed, with
// file anchors and quoted code. Resolved comments are omitted because they are
// no longer tasks.
func Markdown(p contract.Payload, sub Submission) string {
	ctx := p.Session.Context
	lines := []string{
		fmt.Sprintf("# Review: %s → %s", p.Review.Before, p.Review.After),
		"",
		"仓库：" + ctx.Repository,
		"分支：" + ctx.Branch,
		"比较：" + comparisonSummary(ctx),
		"",
		"## 结论",
		"",
		fmt.Sprintf("**%s**（%s）", sub.Verdict, verdictLabel(sub.Verdict)),
	}
	if summary := strings.TrimSpace(sub.Summary); summary != "" {
		lines = append(lines, "", summary)
	}
	lines = append(lines, "", "## Review 意见", "")

	comments := unresolvedComments(sub.Comments)
	if len(comments) == 0 {
		lines = append(lines, "（暂无未解决评论）")
	}
	for index, comment := range comments {
		lines = append(lines, fmt.Sprintf("### %d. %s", index+1, commentScope(comment)))
		lines = append(lines, "")
		if comment.Quote != nil {
			for _, line := range strings.Split(*comment.Quote, "\n") {
				lines = append(lines, "> "+line)
			}
			lines = append(lines, "")
		}
		lines = append(lines, strings.TrimSpace(comment.Body))
		lines = append(lines, "")
	}
	if len(p.Review.Notes) > 0 {
		lines = append(lines, "## 运行说明", "")
		for _, note := range p.Review.Notes {
			lines = append(lines, "- "+note)
		}
		lines = append(lines, "")
	}
	return strings.TrimRight(strings.Join(lines, "\n"), "\n") + "\n"
}

func unresolvedComments(comments []Comment) []Comment {
	out := make([]Comment, 0, len(comments))
	for _, comment := range comments {
		if comment.Resolved {
			continue
		}
		out = append(out, comment)
	}
	return out
}

func commentScope(comment Comment) string {
	if comment.File == nil {
		return "整体意见"
	}
	line := 0
	if comment.Line != nil {
		line = *comment.Line
	}
	end := line
	if comment.EndLine != nil {
		end = *comment.EndLine
	}
	rangeText := fmt.Sprintf("%d", line)
	if end > line {
		rangeText = fmt.Sprintf("%d-%d", line, end)
	}
	side := "改动后"
	if comment.Side != nil && *comment.Side == string(contract.Before) {
		side = "改动前"
	}
	return fmt.Sprintf("%s:%s · %s", *comment.File, rangeText, side)
}

func verdictLabel(verdict Verdict) string {
	switch verdict {
	case VerdictApprove:
		return "通过"
	case VerdictRequestChanges:
		return "要求修改"
	case VerdictComment:
		return "仅评论"
	default:
		return "未确认"
	}
}

func comparisonSummary(ctx contract.ReviewContext) string {
	base := shortSHA(ctx.Base)
	head := shortSHA(ctx.Head)
	switch {
	case base == "" && head == "":
		return ctx.Revision
	case base == "":
		return ctx.Revision + " · → " + head
	case head == "":
		return ctx.Revision + " · " + base
	default:
		return ctx.Revision + " · " + base + " → " + head
	}
}

func shortSHA(value string) string {
	if len(value) <= 12 {
		return value
	}
	return value[:12]
}
