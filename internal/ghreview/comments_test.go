package ghreview

import (
	"strings"
	"testing"
	"time"

	"github.com/wlingze/intentflow/internal/contract"
)

const mapDiff = `diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1,3 +1,4 @@
 one
-old
+new
+extra
 three
@@ -10,2 +11,2 @@
 ten
-eleven
+ELEVEN
`

func quote(file string, side contract.Side, start, end int32) *contract.Quote {
	return &contract.Quote{File: file, Side: side, Start: start, End: end, Snippet: ""}
}

func comment(id, text string, q *contract.Quote) contract.Comment {
	return contract.Comment{Id: id, Text: text, Source: contract.CommentSourceManual, Quote: q}
}

func TestMapReviewMapsInlineAndFallsBack(t *testing.T) {
	resolved := true
	doc := contract.ReviewSession{Comments: []contract.Comment{
		comment("1", "after line", quote("a.go", contract.After, 2, 2)),
		comment("2", "before line", quote("a.go", contract.Before, 2, 2)),
		comment("3", "multi", quote("a.go", contract.After, 11, 12)),
		comment("4", "between hunks", quote("a.go", contract.After, 5, 5)),
		comment("5", "old side wrong", quote("a.go", contract.Before, 12, 12)),
		comment("6", "general note", nil),
		comment("gh-7", "already on GitHub", quote("a.go", contract.After, 2, 2)),
		{Id: "8", Text: "resolved", Resolved: &resolved},
		{Id: "9", Text: "**Title**\n\nbody", Quote: quote("missing.go", contract.After, 1, 1)},
	}}
	mapped, err := MapReview(doc, []byte(mapDiff), "整体 LGTM")
	if err != nil {
		t.Fatal(err)
	}
	if len(mapped.Comments) != 3 {
		t.Fatalf("comments = %+v", mapped.Comments)
	}
	first := mapped.Comments[0]
	if first.Path != "a.go" || first.Line != 2 || first.Side != "RIGHT" || first.StartLine != 0 {
		t.Fatalf("first = %+v", first)
	}
	if mapped.Comments[1].Side != "LEFT" || mapped.Comments[1].Line != 2 {
		t.Fatalf("second = %+v", mapped.Comments[1])
	}
	multi := mapped.Comments[2]
	if multi.StartLine != 11 || multi.Line != 12 || multi.StartSide != "RIGHT" {
		t.Fatalf("multi = %+v", multi)
	}
	if mapped.Imported != 1 || mapped.Resolved != 1 {
		t.Fatalf("imported/resolved = %d/%d", mapped.Imported, mapped.Resolved)
	}
	if len(mapped.Skipped) != 3 {
		t.Fatalf("skipped = %+v", mapped.Skipped)
	}
	for _, needle := range []string{"整体 LGTM", "## 整体意见", "general note", "## 未映射到当前 diff 的评论", "between hunks", "missing.go"} {
		if !strings.Contains(mapped.Body, needle) {
			t.Fatalf("body missing %q:\n%s", needle, mapped.Body)
		}
	}
}

func TestImportComments(t *testing.T) {
	line, start, original := 12, 10, 7
	items := []ReviewComment{
		{ID: 1, Path: "a.go", Body: "inline", Side: "RIGHT", Line: &line, StartLine: &start},
		{ID: 2, Path: "a.go", Body: "outdated", OriginalLine: &original, OriginalSide: "LEFT"},
		{ID: 3, Path: "a.go", Body: "file level", SubjectType: "file"},
	}
	comments := ImportComments(items)
	if len(comments) != 3 {
		t.Fatalf("comments = %+v", comments)
	}
	if comments[0].Id != "gh-1" || comments[0].Quote == nil || comments[0].Quote.Start != 10 || comments[0].Quote.End != 12 {
		t.Fatalf("first = %+v", comments[0])
	}
	if comments[1].Quote == nil || comments[1].Quote.Side != contract.Before || comments[1].Quote.Start != 7 {
		t.Fatalf("outdated = %+v", comments[1])
	}
	if comments[2].Quote != nil || comments[2].Title != "a.go" {
		t.Fatalf("file = %+v", comments[2])
	}
}

func TestImportCommentsKeepsTimestamp(t *testing.T) {
	at := time.Unix(1_700_000_000, 0)
	comments := ImportComments([]ReviewComment{{ID: 4, Path: "a.go", Body: "x", CreatedAt: at, Side: "RIGHT", Line: intPtr(1)}})
	if comments[0].CreatedAt != at.Unix() {
		t.Fatalf("createdAt = %d", comments[0].CreatedAt)
	}
}
