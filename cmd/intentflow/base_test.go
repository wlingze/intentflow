package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/wlingze/intentflow/internal/gitcompare"
)

type fixture struct {
	t    *testing.T
	root string
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	f := &fixture{t: t, root: t.TempDir()}
	f.git("init", "-q", "-b", "main")
	f.git("config", "user.name", "fixture")
	f.git("config", "user.email", "fixture@example.invalid")
	return f
}

func (f *fixture) git(args ...string) string {
	f.t.Helper()
	cmd := exec.Command("git", append([]string{"-C", f.root}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=fixture", "GIT_AUTHOR_EMAIL=fixture@example.invalid",
		"GIT_COMMITTER_NAME=fixture", "GIT_COMMITTER_EMAIL=fixture@example.invalid",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		f.t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func (f *fixture) write(name, body string) {
	f.t.Helper()
	path := filepath.Join(f.root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		f.t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		f.t.Fatal(err)
	}
}

func (f *fixture) commit(message string) string {
	f.t.Helper()
	f.git("add", "-A")
	f.git("commit", "-qm", message)
	return f.head()
}

func (f *fixture) head() string {
	f.t.Helper()
	return strings.TrimSpace(f.git("rev-parse", "HEAD"))
}

func (f *fixture) repo() *gitcompare.Repo {
	f.t.Helper()
	repo, err := gitcompare.Open(f.root, "")
	if err != nil {
		f.t.Fatal(err)
	}
	return repo
}

func (f *fixture) noRebaseInProgress() {
	f.t.Helper()
	for _, name := range []string{"rebase-merge", "rebase-apply"} {
		out := strings.TrimSpace(f.git("rev-parse", "--git-path", name))
		path := out
		if !filepath.IsAbs(path) {
			path = filepath.Join(f.root, path)
		}
		if _, err := os.Stat(path); err == nil {
			f.t.Fatalf("%s still exists after the fallback", path)
		}
	}
}

// 分支从别的分支分出、main 已前进、分支带本地提交：仍能启动并取共同祖先。
func TestDetectBaseHandlesNonAncestorBranch(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	c1 := f.commit("c1")

	f.git("switch", "-qc", "release/1.x")
	f.write("release.txt", "r1\n")
	f.commit("r1")

	f.git("switch", "-qc", "feature/side")
	f.write("feature.txt", "f1\n")
	f.commit("f1")
	f.write("feature.txt", "f2\n")
	f2 := f.commit("f2")

	f.git("switch", "-q", "main")
	f.write("main.txt", "m1\n")
	f.commit("m1")
	f.git("switch", "-q", "feature/side")

	info, err := detectBase(f.repo(), f2)
	if err != nil {
		t.Fatal(err)
	}
	if info.Ref != "main" || info.SHA != c1 {
		t.Fatalf("base = %s %s, want main %s", info.Ref, info.SHA, c1)
	}
	if info.Ahead != 3 || info.Behind != 1 {
		t.Fatalf("ahead/behind = %d/%d, want 3/1", info.Ahead, info.Behind)
	}
	if info.Contains {
		t.Fatal("feature branch must not contain the new main commit")
	}
	if want := "merge-base(main@" + shortSHA(c1) + ")"; info.label() != want {
		t.Fatalf("label = %q, want %q", info.label(), want)
	}

	a, err := newApp(options{target: f.root})
	if err != nil {
		t.Fatalf("startup failed for a non-ancestor branch: %v", err)
	}
	defer a.close()
	p := a.payload()
	if p.Review.BaseLabel != info.label() || p.Review.BaseBehind != 1 || p.Review.BaseUpstream != "main" || !p.Review.NeedsRebase {
		t.Fatalf("contract base status = %+v", p.Review)
	}
	paths := make([]string, 0, len(p.Code.Files))
	for _, file := range p.Code.Files {
		paths = append(paths, file.Path)
	}
	if strings.Join(paths, ",") != "feature.txt,release.txt" {
		t.Fatalf("diff must start at merge-base; files = %v", paths)
	}
}

// 本地 main 过期时，同距离应选落后的 origin/main，而不是本地 main。
func TestDetectBasePrefersFresherOriginMain(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	c1 := f.commit("c1")

	f.git("switch", "-qc", "feature/side")
	f.write("feature.txt", "f1\n")
	f.commit("f1")

	f.git("switch", "-q", "main")
	f.write("main.txt", "m1\n")
	m1 := f.commit("m1")
	f.git("update-ref", "refs/remotes/origin/main", m1)
	f.git("reset", "-q", "--hard", c1)
	f.git("switch", "-q", "feature/side")

	info, err := detectBase(f.repo(), f.head())
	if err != nil {
		t.Fatal(err)
	}
	if info.Ref != "origin/main" || info.Upstream != "origin/main" {
		t.Fatalf("base ref = %q / upstream %q, want origin/main", info.Ref, info.Upstream)
	}
	if info.SHA != c1 || info.Behind != 1 || info.Contains {
		t.Fatalf("sha/behind/contains = %s/%d/%v, want %s/1/false", info.SHA, info.Behind, info.Contains, c1)
	}
}

func TestDetectBaseWithoutMainRefsPointsToBaseFlag(t *testing.T) {
	root := t.TempDir()
	cmd := exec.Command("git", "-C", root, "init", "-q", "-b", "work")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, out)
	}
	cmd = exec.Command("git", "-C", root, "config", "user.name", "fixture")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git config: %v\n%s", err, out)
	}
	cmd = exec.Command("git", "-C", root, "config", "user.email", "fixture@example.invalid")
	if out, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git config: %v\n%s", err, out)
	}
	if err := os.WriteFile(filepath.Join(root, "a.txt"), []byte("a\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	for _, args := range [][]string{{"add", "-A"}, {"commit", "-qm", "c1"}} {
		cmd = exec.Command("git", append([]string{"-C", root}, args...)...)
		if out, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("git %v: %v\n%s", args, err, out)
		}
	}

	f := &fixture{t: t, root: root}
	_, err := detectBase(f.repo(), f.head())
	if err == nil || !strings.Contains(err.Error(), "--base") {
		t.Fatalf("error = %v, want a --base hint", err)
	}
}

func TestDetectBaseFallsBackToOriginHead(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	c1 := f.commit("c1")
	f.write("main.txt", "m1\n")
	m1 := f.commit("m1")
	f.git("branch", "-m", "main", "work")
	f.git("reset", "-q", "--hard", c1)
	f.git("update-ref", "refs/remotes/origin/develop", m1)
	f.git("symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/develop")

	info, err := detectBase(f.repo(), f.head())
	if err != nil {
		t.Fatal(err)
	}
	if info.Ref != "origin/HEAD" || info.SHA != c1 || info.Behind != 1 {
		t.Fatalf("base = %s %s behind %d, want origin/HEAD %s behind 1", info.Ref, info.SHA, info.Behind, c1)
	}
}

func TestExplicitBaseTakesPriority(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	f.commit("c1")
	f.git("switch", "-qc", "feature/side")
	f.write("feature.txt", "f1\n")
	f.commit("f1")
	f.write("feature.txt", "f2\n")
	f.commit("f2")
	f.git("switch", "-q", "main")
	f.write("main.txt", "m1\n")
	f.commit("m1")
	f.git("switch", "-q", "feature/side")

	want := strings.TrimSpace(f.git("rev-parse", "HEAD~1"))
	a, err := newApp(options{target: f.root, base: "HEAD~1"})
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	p := a.payload()
	if a.baseRef != "HEAD~1" || a.baseSHA != want {
		t.Fatalf("base = %s %s, want HEAD~1 %s", a.baseRef, a.baseSHA, want)
	}
	if p.Review.BaseLabel != "HEAD~1" || p.Review.BaseBehind != 1 || !p.Review.NeedsRebase {
		t.Fatalf("contract base status = %+v", p.Review)
	}
}

func TestRebaseConflictFallsBackToMergeBase(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	c1 := f.commit("c1")

	f.git("switch", "-qc", "feature/side")
	f.write("a.txt", "feature\n")
	f.commit("f1")
	before := f.head()

	f.git("switch", "-q", "main")
	f.write("a.txt", "main\n")
	f.commit("m1")
	f.git("switch", "-q", "feature/side")

	a, err := newApp(options{target: f.root, rebase: true})
	if err != nil {
		t.Fatalf("startup must continue after a rebase conflict: %v", err)
	}
	defer a.close()
	if a.headSHA != before {
		t.Fatalf("HEAD moved to %s, want %s", a.headSHA, before)
	}
	if a.baseSHA != c1 {
		t.Fatalf("base = %s, want merge-base %s", a.baseSHA, c1)
	}
	p := a.payload()
	if !p.Review.NeedsRebase || p.Review.BaseBehind != 1 {
		t.Fatalf("contract base status = %+v", p.Review)
	}
	if dirty := strings.TrimSpace(f.git("status", "--porcelain")); dirty != "" {
		t.Fatalf("worktree dirty after abort:\n%s", dirty)
	}
	f.noRebaseInProgress()
}

func TestRebaseSuccessMovesHeadOntoBase(t *testing.T) {
	f := newFixture(t)
	f.write("a.txt", "base\n")
	f.commit("c1")

	f.git("switch", "-qc", "feature/side")
	f.write("feature.txt", "f1\n")
	f.commit("f1")

	f.git("switch", "-q", "main")
	f.write("main.txt", "m1\n")
	m1 := f.commit("m1")
	f.git("switch", "-q", "feature/side")

	a, err := newApp(options{target: f.root, rebase: true})
	if err != nil {
		t.Fatal(err)
	}
	defer a.close()
	if a.baseSHA != m1 {
		t.Fatalf("base = %s, want rebased main tip %s", a.baseSHA, m1)
	}
	p := a.payload()
	if p.Review.NeedsRebase || p.Review.BaseBehind != 0 {
		t.Fatalf("contract base status = %+v", p.Review)
	}
	if parents := strings.Fields(f.git("log", "-1", "--format=%P")); len(parents) != 1 || parents[0] != m1 {
		t.Fatalf("rebased commit parents = %v, want %s", parents, m1)
	}
	if branch := strings.TrimSpace(f.git("branch", "--show-current")); branch != "feature/side" {
		t.Fatalf("branch = %q, want feature/side", branch)
	}
}
