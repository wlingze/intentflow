package reviewctx

import (
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
)

func TestIdentitySeparatesRepositoryAndBranch(t *testing.T) {
	code := contract.CodeBundle{Files: []contract.CodeFile{{Path: "a.go", After: "package a\n"}}}
	base := NewContext("/repo/a", "main", "a", "b", "range", "", code)
	same := NewContext("/repo/a", "main", "a", "b", "range", "", code)
	if base != same {
		t.Fatalf("same input gave different ids: %+v %+v", base, same)
	}
	if other := NewContext("/repo/b", "main", "a", "b", "range", "", code); other.SessionId == base.SessionId {
		t.Fatal("different repositories share a session id")
	}
	if other := NewContext("/repo/a", "dev", "a", "b", "range", "", code); other.SessionId == base.SessionId {
		t.Fatal("different branches share a session id")
	}
	if other := NewContext("/repo/a", "main", "a", "b", "worktree", "", code); other.ComparisonId == base.ComparisonId {
		t.Fatal("different revisions share a comparison id")
	}
}

func TestEmptyDocumentHasArrays(t *testing.T) {
	doc := Empty(NewContext("/repo", "main", "a", "b", "range", "", contract.CodeBundle{}))
	if doc.Version != 1 || doc.Comments == nil || doc.Viewed == nil || doc.ReviewedHunks == nil {
		t.Fatalf("empty document: %+v", doc)
	}
}
