// Package gitcompare 把「Git 提交选择」物化成两份源码目录。
//
// 语义刻意保持朴素：before 是 base 提交的子树，after 是 base 叠加
// 所选提交的文件版本。未选中的提交不会以任何形式进入比较结果，
// 即使它们改过同一个文件。代价是同一文件里未选中提交的改动会被
// 当成所选提交的改动；这一点写进 Comparison.Note，不隐藏。
package gitcompare

import (
	"archive/tar"
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wlingze/intentflow/internal/contract"
)

// Repo 绑定一个可执行的 Git 仓库（普通仓库或 worktree 均可）。
type Repo struct {
	Root   string // git rev-parse --show-toplevel 的结果
	Subdir string // 只比较这个子树；空表示整个仓库
}

// Open 打开仓库并校验 Git 可用。
func Open(dir, subdir string) (*Repo, error) {
	if dir == "" {
		return nil, fmt.Errorf("尚未指定 Git 仓库目录")
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	out, err := git(abs, "rev-parse", "--show-toplevel")
	if err != nil {
		return nil, fmt.Errorf("%s 不是 Git 仓库: %w", dir, err)
	}
	root := strings.TrimSpace(out)
	if root == "" {
		root = abs
	}
	sub := strings.Trim(strings.TrimSpace(subdir), "/")
	if sub == "." {
		sub = ""
	}
	return &Repo{Root: root, Subdir: sub}, nil
}

// Branch returns an explicit identity even in detached-HEAD checkouts.
func (r *Repo) Branch() (string, error) {
	out, err := git(r.Root, "symbolic-ref", "--quiet", "--short", "HEAD")
	if err == nil && strings.TrimSpace(out) != "" {
		return strings.TrimSpace(out), nil
	}
	sha, err := r.Resolve("HEAD")
	if err != nil {
		return "", err
	}
	return "detached:" + sha, nil
}

// Resolve 把一个 ref 解析成完整 commit SHA。
func (r *Repo) Resolve(ref string) (string, error) {
	if strings.TrimSpace(ref) == "" {
		ref = "HEAD"
	}
	out, err := git(r.Root, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil {
		return "", fmt.Errorf("无法解析 %q: %w", ref, err)
	}
	return strings.TrimSpace(out), nil
}

// IsAncestor 判断 ancestor 是否在 descendant 的历史里。
func (r *Repo) IsAncestor(ancestor, descendant string) bool {
	if ancestor == "" || descendant == "" {
		return false
	}
	_, err := git(r.Root, "merge-base", "--is-ancestor", ancestor, descendant)
	return err == nil
}

// Distance 返回 descendant 比 ancestor 多出的提交数。anchors 必须是祖先。
func (r *Repo) Distance(ancestor, descendant string) (int, error) {
	out, err := git(r.Root, "rev-list", "--count", ancestor+".."+descendant)
	if err != nil {
		return 0, err
	}
	n, err := strconv.Atoi(strings.TrimSpace(out))
	if err != nil {
		return 0, fmt.Errorf("解析提交距离失败: %w", err)
	}
	return n, nil
}

// Commits 列出 base..head 范围内、触及 Subdir 的提交，按时间正序。
func (r *Repo) Commits(base, head string) ([]contract.Commit, error) {
	args := []string{
		"log", "--reverse", "--no-color",
		"--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s",
	}
	// An empty base means "from the root": git reads "..HEAD" as an empty range.
	if base == "" {
		args = append(args, head)
	} else {
		args = append(args, base+".."+head)
	}
	if r.Subdir != "" {
		args = append(args, "--", r.Subdir)
	}
	out, err := git(r.Root, args...)
	if err != nil {
		return nil, err
	}
	commits := []contract.Commit{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.SplitN(line, "\x1f", 6)
		if len(parts) < 6 {
			continue
		}
		parents := []string{}
		if fields := strings.Fields(parts[4]); len(fields) > 0 {
			parents = fields
		}
		commits = append(commits, contract.Commit{
			Sha:     parts[0],
			Short:   parts[1],
			Author:  parts[2],
			Date:    parts[3],
			Parents: parents,
			Subject: parts[5],
		})
	}
	return commits, nil
}

// Show 读取单个提交的元数据，用于提交选择器。
func (r *Repo) Show(sha string) (contract.Commit, error) {
	out, err := git(r.Root, "show", "-s", "--no-color", "--format=%H%x1f%h%x1f%an%x1f%aI%x1f%P%x1f%s", sha)
	if err != nil {
		return contract.Commit{}, err
	}
	parts := strings.SplitN(strings.TrimSpace(out), "\x1f", 6)
	if len(parts) < 6 {
		return contract.Commit{}, fmt.Errorf("无法解析提交 %s", sha)
	}
	parents := []string{}
	if fields := strings.Fields(parts[4]); len(fields) > 0 {
		parents = fields
	}
	return contract.Commit{
		Sha:     parts[0],
		Short:   parts[1],
		Author:  parts[2],
		Date:    parts[3],
		Parents: parents,
		Subject: parts[5],
	}, nil
}

// Renames 返回 base..head 之间的重命名对，键为旧路径，值为新路径。
// 路径相对 Subdir，子树外的改动被丢弃。head 为空表示工作区。
func (r *Repo) Renames(base, head string) (map[string]string, error) {
	if strings.TrimSpace(base) == "" {
		return nil, nil
	}
	args := []string{"diff", "-M", "--name-status", "--no-color", base}
	if head != "" && !strings.EqualFold(head, "WORKTREE") {
		args = append(args, head)
	}
	if r.Subdir != "" {
		args = append(args, "--", r.Subdir)
	}
	out, err := git(r.Root, args...)
	if err != nil {
		return nil, err
	}
	renames := map[string]string{}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		parts := strings.Split(line, "\t")
		if len(parts) < 3 || !strings.HasPrefix(parts[0], "R") {
			continue
		}
		oldRel, oldOK := r.rel(parts[1])
		newRel, newOK := r.rel(parts[2])
		if oldOK && newOK {
			renames[oldRel] = newRel
		}
	}
	return renames, nil
}

// StatusFiles 返回工作区里未提交的文件，路径相对 Subdir。
func (r *Repo) StatusFiles() ([]string, error) {
	out, err := git(r.Root, "status", "--porcelain", "-uall")
	if err != nil {
		return nil, err
	}
	files := []string{}
	for _, line := range strings.Split(out, "\n") {
		line = strings.TrimRight(line, "\r")
		if len(line) < 4 {
			continue
		}
		p := strings.TrimSpace(line[3:])
		if i := strings.Index(p, " -> "); i >= 0 {
			p = p[i+4:]
		}
		p = strings.Trim(p, `"`)
		if r.Subdir != "" {
			prefix := r.Subdir + "/"
			if p == r.Subdir {
				p = ""
			} else if strings.HasPrefix(p, prefix) {
				p = strings.TrimPrefix(p, prefix)
			} else {
				continue
			}
		}
		if p != "" && !strings.Contains("/"+p+"/", "/.intentflow/") {
			files = append(files, p)
		}
	}
	return files, nil
}

// HasParent 判断提交是否有第一父提交。
func (r *Repo) HasParent(sha string) bool {
	_, err := r.Resolve(sha + "^1")
	return err == nil
}

// ArchiveRef 把 ref 下的子树导出到 dst。用于「基线提交 → 当前工作区」比较。
func (r *Repo) ArchiveRef(ref, dst string) error {
	if err := os.MkdirAll(dst, 0o755); err != nil {
		return err
	}
	return r.archive(ref, dst)
}

// Worktree 返回工作区中参与比较的目录。
func (r *Repo) Worktree() string {
	if r.Subdir == "" {
		return r.Root
	}
	return filepath.Join(r.Root, filepath.FromSlash(r.Subdir))
}

// Materialize 生成两份目录，返回 before、after 路径。调用方负责删除 tempRoot。
func (r *Repo) Materialize(base string, shas []string, tempRoot string) (string, string, error) {
	beforeDir := filepath.Join(tempRoot, "before")
	afterDir := filepath.Join(tempRoot, "after")
	if err := os.MkdirAll(beforeDir, 0o755); err != nil {
		return "", "", err
	}
	// base 为空表示根提交之前的空树：before 侧保持空目录。
	if base != "" {
		if err := r.archive(base, beforeDir); err != nil {
			return "", "", fmt.Errorf("导出 %s 失败: %w", base, err)
		}
	}
	if err := copyTree(beforeDir, afterDir); err != nil {
		return "", "", fmt.Errorf("复制基线失败: %w", err)
	}
	for _, sha := range shas {
		if err := r.applyCommit(sha, afterDir); err != nil {
			return "", "", fmt.Errorf("应用提交 %s 失败: %w", sha, err)
		}
	}
	return beforeDir, afterDir, nil
}

// archive 用 git archive 导出 ref 下的子树，直接解包到 dst。
func (r *Repo) archive(ref, dst string) error {
	treeish := ref
	if r.Subdir != "" {
		treeish = ref + ":" + r.Subdir
	}
	cmd := exec.Command("git", "-C", r.Root, "archive", "--format=tar", treeish)
	cmd.Stderr = &bytes.Buffer{}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	extractErr := extractTar(stdout, dst)
	waitErr := cmd.Wait()
	if waitErr != nil {
		return fmt.Errorf("%v %s", waitErr, strings.TrimSpace(cmd.Stderr.(*bytes.Buffer).String()))
	}
	return extractErr
}

func extractTar(reader io.Reader, dst string) error {
	tr := tar.NewReader(reader)
	for {
		header, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		name := filepath.Clean(header.Name)
		if name == "." || strings.HasPrefix(name, "..") || filepath.IsAbs(name) {
			continue
		}
		target := filepath.Join(dst, name)
		switch header.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			file, err := os.OpenFile(target, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o644)
			if err != nil {
				return err
			}
			if _, err := io.Copy(file, tr); err != nil {
				file.Close()
				return err
			}
			if err := file.Close(); err != nil {
				return err
			}
		}
	}
}

// applyCommit 把单个提交在子树内的文件版本覆盖到工作目录。
//
// 只看文件级结果：新增/修改写入选后提交的 blob，删除则移除文件。
// 合并提交取第一父提交作为 diff 基线；没有父提交的根提交按空树处理。
func (r *Repo) applyCommit(sha, workDir string) error {
	base := sha + "^1"
	if _, err := git(r.Root, "rev-parse", "--verify", base+"^{commit}"); err != nil {
		base = "4b825dc642cb6eb9a060e54bf8d69288fbee4904" // empty tree
	}
	out, err := git(r.Root, "diff-tree", "-r", "--no-commit-id", "--name-status", base, sha)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(strings.TrimSpace(out), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		parts := strings.Split(line, "\t")
		if len(parts) < 2 {
			continue
		}
		status := parts[0]
		switch {
		case strings.HasPrefix(status, "R"), strings.HasPrefix(status, "C"):
			if len(parts) < 3 {
				continue
			}
			r.removePath(workDir, parts[1])
			if err := r.writeBlob(sha, parts[2], workDir); err != nil {
				return err
			}
		case status == "D":
			r.removePath(workDir, parts[1])
		default:
			if err := r.writeBlob(sha, parts[1], workDir); err != nil {
				return err
			}
		}
	}
	return nil
}

func (r *Repo) removePath(workDir, repoPath string) {
	rel, ok := r.rel(repoPath)
	if !ok {
		return
	}
	_ = os.Remove(filepath.Join(workDir, rel))
}

func (r *Repo) writeBlob(sha, repoPath, workDir string) error {
	rel, ok := r.rel(repoPath)
	if !ok {
		return nil
	}
	out, err := git(r.Root, "show", sha+":"+repoPath)
	if err != nil {
		return err
	}
	target := filepath.Join(workDir, rel)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, []byte(out), 0o644)
}

// rel 只接受 Subdir 以内的路径；子树外的改动不影响比较结果。
func (r *Repo) rel(repoPath string) (string, bool) {
	clean := filepath.ToSlash(repoPath)
	if r.Subdir == "" {
		return clean, true
	}
	prefix := r.Subdir + "/"
	if clean == r.Subdir {
		return "", false
	}
	if !strings.HasPrefix(clean, prefix) {
		return "", false
	}
	return strings.TrimPrefix(clean, prefix), true
}

func copyTree(src, dst string) error {
	return filepath.WalkDir(src, func(path string, entry os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(src, path)
		if err != nil {
			return err
		}
		target := filepath.Join(dst, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o755)
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o644)
	})
}

func git(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", append([]string{"-C", dir}, args...)...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", fmt.Errorf("%s", msg)
	}
	return string(out), nil
}

// Depth 返回子目录的层数，供调用方拼显示标签。
func Depth(subdir string) int {
	subdir = strings.Trim(subdir, "/")
	if subdir == "" {
		return 0
	}
	return len(strings.Split(subdir, "/"))
}
