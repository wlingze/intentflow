// Command intentflow is a local Git diff and PR review workbench.
// It never compiles or executes the reviewed source code.
package main

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/yaklang/intentflow/frontend"
	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/emit"
	"github.com/yaklang/intentflow/internal/gitcompare"
	"github.com/yaklang/intentflow/internal/model"
	"github.com/yaklang/intentflow/internal/payload"
	"github.com/yaklang/intentflow/internal/reviewstore"
	"github.com/yaklang/intentflow/internal/serve"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, "intentflow:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	command := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	switch command {
	case "serve":
		return runServe(args)
	case "diff":
		return runDiff(args)
	case "help", "version":
		usage()
		return nil
	default:
		return fmt.Errorf("未知命令 %q", command)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `intentflow — 本地 diff + PR review

  intentflow -t . --base main
  intentflow -t . --head WORKTREE
  intentflow diff -t . --base main

  --mode diff    默认且唯一模式；不运行 SSA、扫描或 AI
  --review-dir   评审 JSON 目录，默认启动目录下的 .intentflow
  --base         基线；默认取当前分支历史中的 main / master
  --head         终点，默认 HEAD；WORKTREE 包含未提交改动
  --host         监听地址，默认 0.0.0.0
  --port         默认由系统分配空闲端口
  --before/after 目录比较
  --dist         覆盖内嵌前端，仅调试用
`)
}

type options struct {
	target, language, base, head, mode string
	before, after                      string
	beforeLabel, afterLabel            string
	out, reviewDir                     string
	verbose                            bool
}

func (o *options) register(fs *flag.FlagSet) {
	fs.StringVar(&o.target, "t", ".", "Git 代码目录")
	fs.StringVar(&o.target, "target", ".", "Git 代码目录")
	fs.StringVar(&o.language, "l", "go", "兼容参数；diff 支持所有文本语言")
	fs.StringVar(&o.language, "language", "go", "兼容参数；不编译源码")
	fs.StringVar(&o.base, "base", "", "Git 基线；默认找 main / master")
	fs.StringVar(&o.head, "head", "HEAD", "Git 终点；WORKTREE 表示工作区")
	fs.StringVar(&o.mode, "mode", "diff", "仅支持 diff")
	fs.StringVar(&o.before, "before", "", "改动前目录")
	fs.StringVar(&o.after, "after", "", "改动后目录")
	fs.StringVar(&o.beforeLabel, "before-label", "", "改动前标签")
	fs.StringVar(&o.afterLabel, "after-label", "", "改动后标签")
	fs.StringVar(&o.out, "out", "./intentflow-out", "Markdown 导出目录")
	fs.StringVar(&o.reviewDir, "review-dir", ".intentflow", "评审 JSON 目录")
	fs.BoolVar(&o.verbose, "v", false, "打印进度")
}

func runServe(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow", flag.ContinueOnError)
	opt.register(fs)
	host := fs.String("host", "0.0.0.0", "HTTP 监听地址")
	port := fs.Int("port", 0, "HTTP 端口；0 自动分配")
	dist := fs.String("dist", "", "覆盖内嵌前端")
	if err := fs.Parse(args); err != nil {
		return err
	}
	a, err := newApp(opt)
	if err != nil {
		return err
	}
	defer a.close()
	fmt.Println("评审 JSON:", a.store.Dir)
	return serve.Listen(serve.Config{
		Host: *host, Port: *port, DistDir: *dist, DistFS: frontend.Dist(), OutDir: opt.out,
		Payload: a.payload, Revisions: a.revisions, Load: a.load, SaveReview: a.saveReview,
		SaveAsset: a.store.SaveAsset, ReadAsset: a.store.ReadAsset,
		ListDrafts: a.store.ListDrafts, RestoreDraft: a.store.RestoreDraft,
	})
}

func runDiff(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow diff", flag.ContinueOnError)
	opt.register(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	a, err := newApp(opt)
	if err != nil {
		return err
	}
	defer a.close()
	p := a.payload()
	path, err := emit.JSON(&p.Review, opt.out)
	if err == nil {
		fmt.Println("→", path)
	}
	return err
}

type revision struct {
	id   string
	data contract.Payload
}

type app struct {
	mu                                sync.Mutex
	opt                               options
	store                             *reviewstore.Store
	repo                              *gitcompare.Repo
	branch, baseRef, baseSHA, headSHA string
	headIsWorktree                    bool
	folder                            bool
	current                           *revision
	cache                             map[string]*revision
	dirs                              []string
}

func newApp(opt options) (*app, error) {
	if opt.mode != "" && opt.mode != "diff" {
		return nil, fmt.Errorf("仅支持 --mode diff；当前版本不运行 SSA、扫描或 AI")
	}
	if opt.head == "" {
		opt.head = "HEAD"
	}
	store, err := reviewstore.New(opt.reviewDir)
	if err != nil {
		return nil, err
	}
	a := &app{opt: opt, store: store, cache: map[string]*revision{}}
	if opt.before != "" || opt.after != "" {
		if opt.before == "" || opt.after == "" {
			return nil, fmt.Errorf("--before 与 --after 需要同时提供")
		}
		before, err := ensureRoot(opt.before)
		if err != nil {
			return nil, err
		}
		after, err := ensureRoot(opt.after)
		if err != nil {
			return nil, err
		}
		bl, al := displayPath(before), displayPath(after)
		if opt.beforeLabel != "" {
			bl = opt.beforeLabel
		}
		if opt.afterLabel != "" {
			al = opt.afterLabel
		}
		code, err := payload.Build(before, after, bl+" → "+al)
		if err != nil {
			return nil, err
		}
		comparison := model.Comparison{Mode: contract.Folder, BeforeLabel: bl, AfterLabel: al, Commits: []contract.Commit{}, Selected: []string{}, Note: "目录比较"}
		ctx := reviewstore.NewContext(before+" → "+after, "目录比较", before, after, "range", "", code)
		p, err := a.newPayload(comparison, code, ctx)
		if err != nil {
			return nil, err
		}
		a.folder = true
		a.current = &revision{id: "range", data: p}
		a.cache["range"] = a.current
		a.printCompare(p)
		return a, nil
	}
	a.repo, err = openTarget(opt.target)
	if err != nil {
		return nil, err
	}
	a.branch, err = a.repo.Branch()
	if err != nil {
		return nil, err
	}
	a.headIsWorktree = strings.EqualFold(opt.head, "WORKTREE") || opt.head == "."
	head := opt.head
	if a.headIsWorktree {
		head = "HEAD"
	}
	a.headSHA, err = a.repo.Resolve(head)
	if err != nil {
		return nil, err
	}
	a.baseRef = opt.base
	if a.baseRef == "" {
		var distance int
		a.baseRef, a.baseSHA, distance, err = detectBase(a.repo, a.headSHA)
		if err != nil {
			return nil, err
		}
		fmt.Printf("· 分支 %s；基线 %s（%s，领先 %d 个提交）\n", a.branch, a.baseRef, shortSHA(a.baseSHA), distance)
	} else {
		a.baseSHA, err = a.repo.Resolve(a.baseRef)
		if err != nil {
			return nil, err
		}
		fmt.Printf("· 分支 %s；基线 %s\n", a.branch, a.baseRef)
	}
	dirty, err := a.repo.StatusFiles()
	if err != nil {
		return nil, err
	}
	id := "range"
	if len(dirty) > 0 && (a.headIsWorktree || a.baseSHA == a.headSHA) {
		id = "worktree"
	}
	if _, err := a.load(id); err != nil {
		a.close()
		return nil, err
	}
	return a, nil
}

func (a *app) newPayload(comparison model.Comparison, code contract.CodeBundle, ctx contract.ReviewContext) (contract.Payload, error) {
	doc, err := a.store.Load(ctx, code.Files)
	if err != nil {
		return contract.Payload{}, fmt.Errorf("读取评审 %s: %w", a.store.Path(ctx), err)
	}
	return contract.Payload{Code: code, Session: doc, Review: model.Review{
		Before: comparison.BeforeLabel, After: comparison.AfterLabel, Comparison: comparison,
		Notes: []string{}, Signals: []model.Signal{}, Findings: []contract.Finding{},
		Scan: contract.ScanState{Mode: contract.ScanModeDiff, Status: contract.ScanStatusSkipped},
	}}, nil
}

func (a *app) buildRevision(id string) (*revision, error) {
	tmp, err := os.MkdirTemp("", "intentflow-rev-*")
	if err != nil {
		return nil, err
	}
	a.dirs = append(a.dirs, tmp)
	before, after := filepath.Join(tmp, "before"), filepath.Join(tmp, "after")
	base, head := a.baseSHA, a.headSHA
	bl, al, note := "", "", ""
	baseRef, headRef := a.baseRef, a.opt.head
	switch {
	case id == "range":
		bl, al = shortSHA(base), shortSHA(head)
		note = "提交范围；不含未提交改动"
	case id == "worktree":
		// Uncommitted changes are always relative to HEAD, not a custom --head.
		base, err = a.repo.Resolve("HEAD")
		if err != nil {
			return nil, err
		}
		head, headRef = "WORKTREE", "WORKTREE"
		after = a.repo.Worktree()
		bl, al, note = shortSHA(base), "工作区", "HEAD → 工作区；包含未跟踪文件"
	case strings.HasPrefix(id, "commit:"):
		commit, err := a.repo.Show(strings.TrimPrefix(id, "commit:"))
		if err != nil {
			return nil, err
		}
		base = ""
		if len(commit.Parents) > 0 {
			base = commit.Parents[0]
		}
		head = commit.Sha
		bl, al = shortSHA(base), commit.Short
		if base == "" {
			bl = "空树"
		}
		baseRef, headRef, note = bl, al, "单提交："+commit.Subject
	default:
		return nil, fmt.Errorf("未知 revision %q", id)
	}
	if base != "" {
		if err := a.repo.ArchiveRef(base, before); err != nil {
			return nil, err
		}
	} else if err := os.MkdirAll(before, 0o755); err != nil {
		return nil, err
	}
	if head != "WORKTREE" {
		if err := a.repo.ArchiveRef(head, after); err != nil {
			return nil, err
		}
	}
	comparison := model.Comparison{Mode: contract.Git, BeforeLabel: bl, AfterLabel: al,
		Repo: ptr(a.repo.Root), Subdir: ptr(a.repo.Subdir), BaseRef: ptr(baseRef), HeadRef: ptr(headRef),
		Commits: []contract.Commit{}, Selected: []string{}, Note: note}
	code, err := payload.Build(before, after, bl+" → "+al)
	if err != nil {
		return nil, err
	}
	ctx := reviewstore.NewContext(a.repo.Root, a.branch, base, head, id, a.repo.Subdir, code)
	p, err := a.newPayload(comparison, code, ctx)
	if err != nil {
		return nil, err
	}
	return &revision{id: id, data: p}, nil
}

func (a *app) load(id string) (contract.Payload, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if id == "" && a.current != nil {
		id = a.current.id
	}
	if rev, ok := a.cache[id]; ok {
		a.current = rev
		return rev.data, nil
	}
	if a.folder {
		return contract.Payload{}, fmt.Errorf("目录比较不支持 revision %q", id)
	}
	rev, err := a.buildRevision(id)
	if err != nil {
		return contract.Payload{}, err
	}
	a.cache[id], a.current = rev, rev
	a.printCompare(rev.data)
	return rev.data, nil
}

func (a *app) payload() contract.Payload {
	a.mu.Lock()
	defer a.mu.Unlock()
	return a.current.data
}

func (a *app) saveReview(doc contract.ReviewSession) (contract.ReviewSession, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	rev := a.cache[doc.Context.Revision]
	if rev == nil {
		return doc, reviewstore.ErrMismatch
	}
	saved, err := a.store.Save(doc, rev.data.Session.Context, rev.data.Code.Files)
	if err == nil {
		rev.data.Session = saved
	}
	return saved, err
}

func (a *app) revisions() (contract.RevisionList, error) {
	a.mu.Lock()
	defer a.mu.Unlock()
	if a.folder {
		return contract.RevisionList{Current: "range", Base: a.current.data.Review.Before, Head: a.current.data.Review.After,
			Revisions: []contract.Revision{{Id: "range", Kind: contract.RevisionKindRange, Label: "目录比较"}}}, nil
	}
	dirty, err := a.repo.StatusFiles()
	if err != nil {
		return contract.RevisionList{}, err
	}
	revs := []contract.Revision{}
	if len(dirty) > 0 || a.headIsWorktree {
		label := "未提交的改动"
		if len(dirty) == 0 {
			label = "工作区（无改动）"
		}
		revs = append(revs, contract.Revision{Id: "worktree", Kind: contract.RevisionKindWorktree, Label: label, Short: "WORKTREE", Files: int32(len(dirty))})
	}
	revs = append(revs, contract.Revision{Id: "range", Kind: contract.RevisionKindRange, Label: "全部改动", Sha: a.headSHA, Short: shortSHA(a.headSHA), Subject: shortSHA(a.baseSHA) + " → " + shortSHA(a.headSHA)})
	commits, err := a.repo.Commits(a.baseSHA, a.headSHA)
	if err != nil {
		return contract.RevisionList{}, err
	}
	for i := len(commits) - 1; i >= 0; i-- {
		c := commits[i]
		revs = append(revs, contract.Revision{Id: "commit:" + c.Sha, Kind: contract.RevisionKindCommit, Label: c.Short + " " + c.Subject, Sha: c.Sha, Short: c.Short, Subject: c.Subject, Author: c.Author, Date: c.Date})
	}
	return contract.RevisionList{Base: a.baseRef, Head: a.opt.head, Current: a.current.id, Dirty: len(dirty) > 0, Revisions: revs}, nil
}

func (a *app) printCompare(p contract.Payload) {
	fmt.Printf("· 比较 %s → %s，%d 个改动文件\n", p.Review.Before, p.Review.After, len(p.Code.Files))
	if p.Code.Truncated {
		fmt.Printf("  注意：%d 个文件超出体积上限，未携带正文\n", len(p.Code.Skipped))
	}
	if p.Session.UpdatedAt != "" {
		fmt.Printf("· 已恢复 session %s：%d 条评论\n", p.Session.Context.SessionId, len(p.Session.Comments))
	}
}

func (a *app) close() {
	for _, dir := range a.dirs {
		_ = os.RemoveAll(dir)
	}
}

func ensureRoot(dir string) (string, error) {
	abs, err := filepath.Abs(dir)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(abs)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("不是目录: %s", dir)
	}
	return abs, nil
}

func detectBase(repo *gitcompare.Repo, head string) (string, string, int, error) {
	ref, sha, distance := "", "", 0
	for _, candidate := range []string{"main", "master", "origin/main", "origin/master"} {
		s, err := repo.Resolve(candidate)
		if err != nil || !repo.IsAncestor(s, head) {
			continue
		}
		d, err := repo.Distance(s, head)
		if err != nil {
			continue
		}
		if ref == "" || d < distance {
			ref, sha, distance = candidate, s, d
		}
	}
	if ref == "" {
		return "", "", 0, fmt.Errorf("当前分支不在 main / master / origin/main / origin/master 之上；用 --base 指定基线")
	}
	return ref, sha, distance, nil
}

func openTarget(target string) (*gitcompare.Repo, error) {
	if target == "" {
		target = "."
	}
	abs, err := filepath.Abs(target)
	if err != nil {
		return nil, err
	}
	r, err := gitcompare.Open(abs, "")
	if err != nil {
		return nil, err
	}
	if rel, err := filepath.Rel(r.Root, abs); err == nil && rel != "." && !strings.HasPrefix(rel, "..") {
		r.Subdir = filepath.ToSlash(rel)
	}
	return r, nil
}

func displayPath(abs string) string {
	if wd, err := os.Getwd(); err == nil {
		if rel, err := filepath.Rel(wd, abs); err == nil && !strings.HasPrefix(rel, "..") {
			return rel
		}
	}
	return abs
}
func shortSHA(sha string) string {
	if len(sha) > 8 {
		return sha[:8]
	}
	return sha
}
func ptr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
