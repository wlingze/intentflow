package gitcompare

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"
)

func run(t *testing.T, dir string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	cmd.Env = append(os.Environ(),
		"GIT_AUTHOR_NAME=t", "GIT_AUTHOR_EMAIL=t@t",
		"GIT_COMMITTER_NAME=t", "GIT_COMMITTER_EMAIL=t@t",
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, out)
	}
	return string(out)
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	path := filepath.Join(dir, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
}

// 关键语义：只应用所选提交；未选中的提交不能进入比较结果。
func TestMaterializeAppliesOnlySelectedCommits(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, "init", "-q", "-b", "main")
	write(t, dir, "pkg/a.go", "v1\n")
	run(t, dir, "add", ".")
	run(t, dir, "commit", "-qm", "c1")
	write(t, dir, "pkg/a.go", "v2\n")
	write(t, dir, "pkg/b.go", "b\n")
	run(t, dir, "add", ".")
	run(t, dir, "commit", "-qm", "c2")
	write(t, dir, "pkg/a.go", "v3\n")
	run(t, dir, "add", ".")
	run(t, dir, "commit", "-qm", "c3")

	repo, err := Open(dir, "pkg")
	if err != nil {
		t.Fatal(err)
	}
	base, err := repo.Resolve("HEAD~2")
	if err != nil {
		t.Fatal(err)
	}
	head, err := repo.Resolve("HEAD")
	if err != nil {
		t.Fatal(err)
	}
	commits, err := repo.Commits(base, head)
	if err != nil {
		t.Fatal(err)
	}
	if len(commits) != 2 {
		t.Fatalf("commits = %d, want 2", len(commits))
	}

	// 只选 c2：a.go 应该是 v2（不是 v3），b.go 应该存在。
	out := t.TempDir()
	beforeDir, afterDir, err := repo.Materialize(base, []string{commits[0].Sha}, out)
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, beforeDir, "a.go"); got != "v1\n" {
		t.Errorf("before a.go = %q", got)
	}
	if got := read(t, afterDir, "a.go"); got != "v2\n" {
		t.Errorf("after a.go = %q, want v2", got)
	}
	if got := read(t, afterDir, "b.go"); got != "b\n" {
		t.Errorf("after b.go = %q", got)
	}
	if _, err := os.Stat(filepath.Join(afterDir, "b.go")); err != nil {
		t.Fatalf("b.go missing: %v", err)
	}

	// 全部提交：a.go 到 v3。
	all := make([]string, 0, len(commits))
	for _, commit := range commits {
		all = append(all, commit.Sha)
	}
	_, afterAll, err := repo.Materialize(base, all, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got := read(t, afterAll, "a.go"); got != "v3\n" {
		t.Errorf("afterAll a.go = %q", got)
	}
}

func read(t *testing.T, dir, name string) string {
	t.Helper()
	data, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		t.Fatal(err)
	}
	return string(data)
}

// 单提交入口用「第一父提交」作为基线；subdir 为 "." 时按整仓比较。
func TestSingleCommitAndDotSubdir(t *testing.T) {
	dir := t.TempDir()
	run(t, dir, "init", "-q", "-b", "main")
	write(t, dir, "pkg/a.go", "v1\n")
	run(t, dir, "add", ".")
	run(t, dir, "commit", "-qm", "one")
	write(t, dir, "pkg/a.go", "v2\n")
	run(t, dir, "add", ".")
	run(t, dir, "commit", "-qm", "two")

	repo, err := Open(dir, ".")
	if err != nil {
		t.Fatal(err)
	}
	if repo.Subdir != "" {
		t.Fatalf("subdir %q, want empty", repo.Subdir)
	}
	head, err := repo.Resolve("HEAD")
	if err != nil {
		t.Fatal(err)
	}
	commits, err := repo.Commits("", head)
	if err != nil || len(commits) != 2 {
		t.Fatalf("commits %v %v", commits, err)
	}
	before, after, err := repo.Materialize(commits[1].Parents[0], []string{commits[1].Sha}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(after, "pkg", "a.go"))
	if err != nil {
		t.Fatal(err)
	}
	if string(data) != "v2\n" {
		t.Fatalf("after = %q", data)
	}
	base, err := os.ReadFile(filepath.Join(before, "pkg", "a.go"))
	if err != nil {
		t.Fatal(err)
	}
	if string(base) != "v1\n" {
		t.Fatalf("before = %q", base)
	}
}
