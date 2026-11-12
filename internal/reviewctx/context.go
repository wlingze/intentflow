// Package reviewctx derives the identity of a local review.
//
// A review belongs to one repository, one branch and one subdirectory. Every
// comparison range inside that session keeps its own identity, so line anchors
// from an older diff never apply to newer code. The document itself lives in
// the browser; the server only needs these ids to label a payload.
package reviewctx

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"

	"github.com/wlingze/intentflow/internal/contract"
)

func digest(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// NewContext builds the identity for the current comparison.
func NewContext(repository, branch, base, head, revision, subdir string, code contract.CodeBundle) contract.ReviewContext {
	ctx := contract.ReviewContext{
		Repository: repository, Branch: branch, Base: base, Head: head,
		Revision: revision, Subdir: subdir, DiffDigest: digest(code.Files),
		SessionId: digest([]string{repository, branch, subdir})[:24],
	}
	ctx.ComparisonId = digest(ctx)[:24]
	return ctx
}

// Empty returns a review document with no comments and no viewed marks.
func Empty(ctx contract.ReviewContext) contract.ReviewSession {
	return contract.ReviewSession{
		Version: 1, Context: ctx, Comments: []contract.Comment{}, Viewed: []string{}, ReviewedHunks: []string{},
	}
}
