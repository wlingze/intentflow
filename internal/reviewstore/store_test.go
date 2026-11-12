package reviewstore

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/yaklang/intentflow/internal/contract"
)

func fixture() (contract.ReviewContext, []contract.CodeFile) {
	files := []contract.CodeFile{{Path: "a.go", Status: contract.CodeStatusModified, Before: "package a\n", After: "package b\n"}}
	return NewContext("/repo", "feature/review", "base-sha", "head-sha", "range", "", contract.CodeBundle{Files: files}), files
}

func TestSaveLoadReview(t *testing.T) {
	ctx, files := fixture()
	s, _ := New(t.TempDir())
	doc := Empty(ctx)
	doc.Viewed = []string{"a.go"}
	doc.Comments = []contract.Comment{{Id: "one", Text: "这里需要解释", Source: "manual", Quote: &contract.Quote{File: "a.go", Start: 1, End: 1, Side: contract.After}}}
	saved, err := s.Save(doc, ctx, files)
	if err != nil {
		t.Fatal(err)
	}
	reopened, _ := New(s.Dir)
	got, err := reopened.Load(ctx, files)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(got, saved) || got.UpdatedAt == "" {
		t.Fatalf("restore mismatch: %+v", got)
	}
	info, err := os.Stat(s.Path(ctx))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("review file permissions = %v", info.Mode().Perm())
	}
}

func TestImportsRejectMismatchedContext(t *testing.T) {
	ctx, files := fixture()
	for _, field := range []string{"Repository", "Branch", "Base", "Head", "Revision", "Subdir", "DiffDigest", "SessionId", "ComparisonId"} {
		t.Run(field, func(t *testing.T) {
			s, _ := New(t.TempDir())
			original := Empty(ctx)
			if _, err := s.Save(original, ctx, files); err != nil {
				t.Fatal(err)
			}
			wrong := original
			reflect.ValueOf(&wrong.Context).Elem().FieldByName(field).SetString("other")
			if _, err := s.Save(wrong, ctx, files); !errors.Is(err, ErrMismatch) {
				t.Fatalf("mismatched %s accepted: %v", field, err)
			}
			got, err := s.Load(ctx, files)
			if err != nil {
				t.Fatalf("original review was modified: %+v %v", got, err)
			}
		})
	}
}

func TestSessionIdentityTracksBranchNotCommits(t *testing.T) {
	ctx, files := fixture()
	next := NewContext(ctx.Repository, ctx.Branch, "new-base", "new-head", "range", "", contract.CodeBundle{Files: files})
	if next.SessionId != ctx.SessionId || next.ComparisonId == ctx.ComparisonId {
		t.Fatal("session should be branch-stable, comparison should track commits")
	}
	other := NewContext("/another/repo", ctx.Branch, ctx.Base, ctx.Head, "range", "", contract.CodeBundle{Files: files})
	if other.SessionId == ctx.SessionId {
		t.Fatal("same branch name leaked across repositories")
	}
	files[0].After = "package changed\n"
	dirty := NewContext(ctx.Repository, ctx.Branch, ctx.Base, ctx.Head, "range", "", contract.CodeBundle{Files: files})
	if dirty.ComparisonId == ctx.ComparisonId {
		t.Fatal("modified content kept stale line anchors")
	}
}

func TestInvalidLineAndViewedFileRejected(t *testing.T) {
	ctx, files := fixture()
	doc := Empty(ctx)
	doc.Comments = []contract.Comment{{Id: "one", Text: "test", Quote: &contract.Quote{File: "a.go", Side: contract.After, Start: 90, End: 90}}}
	if err := Validate(doc, ctx, files); err == nil {
		t.Fatal("out-of-range line accepted")
	}
	doc.Comments = nil
	doc.Viewed = []string{"missing.go"}
	if err := Validate(doc, ctx, files); err == nil {
		t.Fatal("unknown viewed file accepted")
	}
}

func TestCorruptJSONIsNotOverwrittenOnLoad(t *testing.T) {
	ctx, files := fixture()
	s, _ := New(t.TempDir())
	path := s.Path(ctx)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	const raw = "{broken"
	if err := os.WriteFile(path, []byte(raw), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.Load(ctx, files); err == nil {
		t.Fatal("corrupt JSON silently accepted")
	}
	got, _ := os.ReadFile(path)
	if string(got) != raw {
		t.Fatal("corrupt review was overwritten")
	}
}

func TestNullArraysRejected(t *testing.T) {
	ctx, files := fixture()
	s, _ := New(t.TempDir())
	doc := Empty(ctx)
	doc.Comments = nil
	if _, err := s.Save(doc, ctx, files); err == nil {
		t.Fatal("nil comments accepted")
	}
	doc = Empty(ctx)
	doc.Viewed = nil
	if _, err := s.Save(doc, ctx, files); err == nil {
		t.Fatal("nil viewed accepted")
	}
}

func TestAssetStoreIsContentAddressed(t *testing.T) {
	s, _ := New(t.TempDir())
	png := []byte("\x89PNG\r\n\x1a\nsmall-image")
	name, err := s.SaveAsset(png, ".png")
	if err != nil {
		t.Fatal(err)
	}
	if len(name) != 64+4 || filepath.Ext(name) != ".png" {
		t.Fatalf("unexpected asset name: %q", name)
	}
	again, err := s.SaveAsset(png, ".png")
	if err != nil || again != name {
		t.Fatalf("same bytes should dedupe: %q %v", again, err)
	}
	data, kind, err := s.ReadAsset(name)
	if err != nil || !reflect.DeepEqual(data, png) || kind != "image/png" {
		t.Fatalf("read asset: %q %s %v", data, kind, err)
	}
	for _, bad := range []string{"", "../x.png", "not-a-hash.png", name + "/x"} {
		if _, _, err := s.ReadAsset(bad); err == nil {
			t.Fatalf("accepted invalid asset name %q", bad)
		}
	}
	if _, err := s.SaveAsset(png, ".svg"); err == nil {
		t.Fatal("svg should be rejected")
	}
}

func TestGeneralCommentWithImagesRoundTrip(t *testing.T) {
	ctx, files := fixture()
	s, _ := New(t.TempDir())
	doc := Empty(ctx)
	doc.Comments = []contract.Comment{{
		Id: "overall", Text: "需要补测试", Title: "", Source: "manual", SignalId: "",
		CreatedAt: 1, Images: []string{},
	}}
	saved, err := s.Save(doc, ctx, files)
	if err != nil {
		t.Fatal(err)
	}
	got, err := s.Load(ctx, files)
	if err != nil || len(got.Comments) != 1 || got.Comments[0].Quote != nil {
		t.Fatalf("general comment not restored: %+v %v", got, err)
	}
	if saved.Comments[0].Images == nil {
		t.Fatal("images should normalize to an empty array")
	}
}

func TestDraftsListAndRestore(t *testing.T) {
	base, files := fixture()
	s, _ := New(t.TempDir())

	first := Empty(base)
	first.Comments = []contract.Comment{{Id: "a", Text: "range comment", Title: "", Source: "manual", SignalId: "", CreatedAt: 1, Images: []string{}, Quote: &contract.Quote{File: "a.go", Side: contract.After, Start: 1, End: 1}}}
	if _, err := s.Save(first, base, files); err != nil {
		t.Fatal(err)
	}

	worktree := NewContext(base.Repository, base.Branch, base.Base, "WORKTREE", "worktree", "", contract.CodeBundle{Files: files})
	drafts, err := s.ListDrafts(worktree)
	if err != nil || len(drafts) != 1 || drafts[0].ComparisonId != base.ComparisonId {
		t.Fatalf("drafts: %+v %v", drafts, err)
	}

	restored, adjusted, err := s.RestoreDraft(worktree, files, drafts[0].ComparisonId, false)
	if err != nil || adjusted != 0 {
		t.Fatalf("restore: %+v %d %v", restored, adjusted, err)
	}
	if restored.Context != worktree || len(restored.Comments) != 1 {
		t.Fatalf("restore context/comments: %+v", restored)
	}
	if _, err := s.Load(worktree, files); err != nil {
		t.Fatalf("restored draft not saved under the current comparison: %v", err)
	}

	// A different branch must not read or restore this session.
	other := NewContext(base.Repository, "feature/other", base.Base, "WORKTREE", "worktree", "", contract.CodeBundle{Files: files})
	if list, err := s.ListDrafts(other); err != nil || len(list) != 0 {
		t.Fatalf("cross-branch drafts leaked: %+v %v", list, err)
	}
	if _, _, err := s.RestoreDraft(other, files, drafts[0].ComparisonId, false); err == nil {
		t.Fatal("cross-branch restore accepted")
	}
}

func TestRestoreDropsStaleLineAnchors(t *testing.T) {
	base, files := fixture()
	s, _ := New(t.TempDir())
	doc := Empty(base)
	doc.Comments = []contract.Comment{
		{Id: "keep", Text: "line 1", Title: "", Source: "manual", SignalId: "", CreatedAt: 1, Images: []string{}, Quote: &contract.Quote{File: "a.go", Side: contract.After, Start: 1, End: 1}},
		{Id: "stale", Text: "line 40", Title: "", Source: "manual", SignalId: "", CreatedAt: 2, Images: []string{}, Quote: &contract.Quote{File: "a.go", Side: contract.After, Start: 40, End: 40}},
		{Id: "gone", Text: "missing file", Title: "", Source: "manual", SignalId: "", CreatedAt: 3, Images: []string{}, Quote: &contract.Quote{File: "gone.go", Side: contract.After, Start: 1, End: 1}},
	}
	doc.Viewed = []string{"a.go", "gone.go"}
	// Simulate a draft written when the file was still long: write the JSON
	// directly so the stale anchors survive on disk.
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	path := s.Path(base)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	worktree := NewContext(base.Repository, base.Branch, base.Base, "WORKTREE", "worktree", "", contract.CodeBundle{Files: files})
	restored, adjusted, err := s.RestoreDraft(worktree, files, base.ComparisonId, true)
	if err != nil {
		t.Fatal(err)
	}
	if adjusted != 2 {
		t.Fatalf("adjusted = %d", adjusted)
	}
	if restored.Comments[0].Quote == nil || restored.Comments[1].Quote != nil || restored.Comments[2].Quote != nil {
		t.Fatalf("quote adjustment wrong: %+v", restored.Comments)
	}
	if len(restored.Viewed) != 1 || restored.Viewed[0] != "a.go" {
		t.Fatalf("viewed files not filtered: %+v", restored.Viewed)
	}
}

// 默认不落盘：评审状态只存在进程内存和浏览器里。
func TestMemoryStoreWritesNothing(t *testing.T) {
	ctx, files := fixture()
	work := t.TempDir()
	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(work); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = os.Chdir(previous) })

	store, err := New("")
	if err != nil {
		t.Fatal(err)
	}
	if store.Dir != "" {
		t.Fatalf("默认目录应为空，实际 %q", store.Dir)
	}
	doc := Empty(ctx)
	doc.Comments = []contract.Comment{{Id: "one", Text: "内存里的评审", Source: "manual"}}
	if _, err := store.Save(doc, ctx, files); err != nil {
		t.Fatal(err)
	}
	got, err := store.Load(ctx, files)
	if err != nil {
		t.Fatal(err)
	}
	if len(got.Comments) != 1 || got.Comments[0].Text != "内存里的评审" {
		t.Fatalf("内存读取失败: %+v", got)
	}
	drafts, err := store.ListDrafts(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(drafts) != 1 || drafts[0].ComparisonId != ctx.ComparisonId {
		t.Fatalf("内存草稿列表错误: %+v", drafts)
	}
	name, err := store.SaveAsset([]byte("\x89PNG\r\n\x1a\nfake"), ".png")
	if err != nil {
		t.Fatal(err)
	}
	if _, kind, err := store.ReadAsset(name); err != nil || kind != "image/png" {
		t.Fatalf("内存图片读取失败: %v %q", err, kind)
	}
	entries, err := os.ReadDir(work)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("不应写任何文件，实际 %d 项", len(entries))
	}
}
