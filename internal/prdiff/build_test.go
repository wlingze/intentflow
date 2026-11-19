package prdiff

import (
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
)

func TestBuildPatchPayload(t *testing.T) {
	data := []byte(`diff --git a/a.go b/a.go
--- a/a.go
+++ b/a.go
@@ -1 +1 @@
-old
+new
`)
	p, revisions, err := Build(data, Params{
		Repository: "github.com/acme/repo", Branch: "pull/7", Before: "base", After: "head",
		Title: "Fix login", Mode: contract.Git, Note: "GitHub PR #7",
	})
	if err != nil {
		t.Fatal(err)
	}
	if p.Review.Before != "base" || p.Review.After != "head" || p.Review.Comparison.Mode != contract.Git {
		t.Fatalf("review = %+v", p.Review)
	}
	if len(p.Review.Notes) != 1 || p.Review.Notes[0] != "GitHub PR #7" {
		t.Fatalf("notes = %#v", p.Review.Notes)
	}
	if p.Session.Context.Repository != "github.com/acme/repo" || p.Session.Context.Branch != "pull/7" {
		t.Fatalf("context = %+v", p.Session.Context)
	}
	if len(p.Code.Files) != 1 || p.Code.Files[0].Before != "old" || p.Code.Files[0].After != "new" {
		t.Fatalf("code = %+v", p.Code.Files)
	}
	if revisions.Current != "range" || len(revisions.Revisions) != 1 || revisions.Revisions[0].Subject != "Fix login" {
		t.Fatalf("revisions = %+v", revisions)
	}
}

func TestBuildRejectsEmptyPatch(t *testing.T) {
	if _, _, err := Build([]byte("not a patch"), Params{}); err == nil {
		t.Fatal("expected an error")
	}
}
