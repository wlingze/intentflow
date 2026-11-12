package main

import (
	"flag"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/wlingze/intentflow/internal/contract"
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

func TestFolderComparisonIsReadOnly(t *testing.T) {
	before, after := t.TempDir(), t.TempDir()
	if err := os.WriteFile(filepath.Join(after, "main.go"), []byte("package main\nfunc main() {}\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	opt := options{before: before, after: after}
	a, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	entries, err := os.ReadDir(before)
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Fatalf("server wrote next to the compared directories: %v", entries)
	}
	p := a.payload()
	if len(p.Code.Files) != 1 || p.Session.Version != 1 {
		t.Fatalf("payload: %+v", p.Code)
	}
	if len(p.Session.Comments) != 0 || len(p.Session.Viewed) != 0 {
		t.Fatal("server must hand out an empty document")
	}
	if p.Review.Scan.Status != contract.ScanStatusSkipped {
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
	opt := options{target: root, base: "main"}
	a, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	first := a.payload().Session.Context
	git("switch", "-qc", "feature/b")
	b, err := newApp(opt)
	if err != nil {
		t.Fatal(err)
	}
	defer b.close()
	if b.payload().Session.Context.Revision != "range" {
		t.Fatal("review metadata polluted git status and selected the worktree")
	}
	if b.payload().Session.Context.SessionId == first.SessionId {
		t.Fatal("same commit on two branches shares one session id")
	}
}

