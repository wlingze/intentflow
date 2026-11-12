package main

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/yaklang/intentflow/internal/contract"
)

func TestDefaultIsPureDiff(t *testing.T) {
	var opt options
	opt.register(flag.NewFlagSet("test", flag.ContinueOnError))
	if opt.mode != "diff" {
		t.Fatalf("default mode = %q", opt.mode)
	}
	for _, mode := range []string{"scan", "review"} {
		if _, err := newApp(options{mode: mode}); err == nil {
			t.Fatalf("accepted mode %q", mode)
		}
	}
}

func TestFolderReviewRestoresFromJSON(t *testing.T) {
	before, after := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(after, "main.go"), []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opt := options{before: before, after: after, reviewDir: t.TempDir()}
	a, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	p := a.payload()
	doc := p.Session
	doc.Viewed = []string{"main.go"}
	doc.Comments = []contract.Comment{{Id: "c1", Text: "补充测试", Source: "manual", Quote: &contract.Quote{File: "main.go", Side: contract.After, Start: 2, End: 2}}}
	if _, err := a.saveReview(doc); err != nil {
		t.Fatal(err)
	}
	reopened, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.close()
	got := reopened.payload().Session
	if len(got.Comments) != 1 || len(got.Viewed) != 1 || got.UpdatedAt == "" {
		t.Fatalf("not restored: %+v", got)
	}
	if reopened.payload().Review.Scan.Status != contract.ScanStatusSkipped {
		t.Fatal("diff must never scan")
	}
}

func TestBranchSessionsDoNotMix(t *testing.T) {
	root := t.TempDir()
	git := func(args ...string) {
		t.Helper()
		cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}
	git("init", "-q", "-b", "main")
	git("config", "user.name", "fixture")
	git("config", "user.email", "fixture@example.invalid")
	if err := os.WriteFile(filepath.Join(root, "a.go"), []byte("package a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	git("add", ".")
	git("commit", "-qm", "init")
	git("switch", "-qc", "feature/a")
	opt := options{target: root, base: "main", reviewDir: filepath.Join(root, ".intentflow")}
	a, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	doc := a.payload().Session
	doc.Comments = []contract.Comment{{Id: "a1", Text: "belongs to branch A", Source: "manual"}}
	if _, err := a.saveReview(doc); err != nil {
		t.Fatal(err)
	}
	git("switch", "-qc", "feature/b")
	b, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	if b.payload().Session.Context.Revision != "range" {
		t.Fatal("review metadata polluted git status and selected the worktree")
	}
	if b.payload().Session.Context.SessionId == doc.Context.SessionId || len(b.payload().Session.Comments) != 0 {
		t.Fatal("reviews leaked across branches at the same commit")
	}
	if _, err := b.saveReview(doc); err == nil {
		t.Fatal("import accepted a different branch")
	}
	git("switch", "-q", "feature/a")
	reopened, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.close()
	if len(reopened.payload().Session.Comments) != 1 {
		t.Fatal("branch A review not restored")
	}
}
