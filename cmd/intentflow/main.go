// Command intentflow is a local Git diff and PR review workbench.
// It never compiles or executes the reviewed source code.
package main

import (
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/wlingze/intentflow/frontend"
	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/emit"
	"github.com/wlingze/intentflow/internal/export"
	"github.com/wlingze/intentflow/internal/gitcompare"
	"github.com/wlingze/intentflow/internal/model"
	"github.com/wlingze/intentflow/internal/payload"
	"github.com/wlingze/intentflow/internal/prdiff"
	"github.com/wlingze/intentflow/internal/reviewctx"
	"github.com/wlingze/intentflow/internal/serve"
	"github.com/wlingze/intentflow/internal/version"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		var status *exitStatus
		if errors.As(err, &status) {
			os.Exit(status.code)
		}
		fmt.Fprintln(os.Stderr, "intentflow:", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case "-h", "--help", "-help", "help":
			usage()
			return nil
		case "version", "--version", "-version":
			fmt.Println(version.String())
			return nil
		}
	}
	command := "serve"
	if len(args) > 0 && !strings.HasPrefix(args[0], "-") {
		command, args = args[0], args[1:]
	}
	switch command {
	case "serve":
		return runServe(args)
	case "diff":
		return runDiff(args)
	case "export":
		return runExport(args)
	case "github":
		return runGithub(args)
	case "update":
		return runUpdate(args)
	default:
		return fmt.Errorf("未知命令 %q", command)
	}
}

func usage() {
	usageTo(os.Stderr)
}

func usageTo(w io.Writer) {
	fmt.Fprint(w, `intentflow — 本地 diff + PR review

  intentflow -t . --base main
  intentflow -t . --head WORKTREE
  intentflow diff -t . --base main
  intentflow diff <patch|->         从补丁启动工作台，不需要 Git 仓库
  intentflow export --diff <patch> --out <dir>
  intentflow serve --pr-dir <dir> [--no-github]
  intentflow github [open] --repo owner/name --pr N
  intentflow github submit --repo owner/name --pr N --review <json> --event comment
  intentflow update [--check] [--version v0.2.0] [--force] [--repo owner/name]
  intentflow version

  --mode diff    默认且唯一模式；不运行 SSA、扫描或 AI
  --no-open      不自动打开浏览器
  --base         基线；默认对 main/master/origin/main/origin/master 取最近 merge-base
  --rebase       先 rebase 到基线；冲突自动 abort，改用 merge-base 继续
  --head         终点，默认 HEAD；WORKTREE 包含未提交改动
  --host         监听地址，默认 0.0.0.0
  --port         默认由系统分配空闲端口
  --before/after 目录比较
  --dist         覆盖内嵌前端，仅调试用
  --patch        补丁文件；- 表示 stdin
  --pr-dir       PR 目录；按 /pr/<owner>/<repo>/<number> 路由
  --no-github    只读本地 PR 目录，不回退抓取 GitHub
  --repo         GitHub 仓库，owner/name
  --pr           GitHub PR 编号
  --event        comment | approve | request-changes
  --dry-run      只打印将提交的 review JSON

  update --check     只打印当前与最新版本；有新版本时退出码 2
  update --version   安装指定版本；--force 同版本也重装
  update --repo      release 仓库，默认 wlingze/intentflow
`)
}

type options struct {
	target, language, base, head, mode string
	before, after                      string
	beforeLabel, afterLabel            string
	out                                string
	patch                              string
	verbose                            bool
	rebase                             bool
}

func (o *options) register(fs *flag.FlagSet) {
	fs.StringVar(&o.target, "t", ".", "Git 代码目录")
	fs.StringVar(&o.target, "target", ".", "Git 代码目录")
	fs.StringVar(&o.language, "l", "go", "兼容参数；diff 支持所有文本语言")
	fs.StringVar(&o.language, "language", "go", "兼容参数；不编译源码")
	fs.StringVar(&o.base, "base", "", "Git 基线；默认取最近 merge-base")
	fs.BoolVar(&o.rebase, "rebase", false, "先 rebase 到基线；冲突自动 abort 并继续")
	fs.StringVar(&o.head, "head", "HEAD", "Git 终点；WORKTREE 表示工作区")
	fs.StringVar(&o.mode, "mode", "diff", "仅支持 diff")
	fs.StringVar(&o.before, "before", "", "改动前目录")
	fs.StringVar(&o.after, "after", "", "改动后目录")
	fs.StringVar(&o.beforeLabel, "before-label", "", "改动前标签")
	fs.StringVar(&o.afterLabel, "after-label", "", "改动后标签")
	fs.StringVar(&o.out, "out", "./intentflow-out", "Markdown 导出目录")
	fs.StringVar(&o.patch, "patch", "", "补丁文件；- 表示 stdin")
	fs.BoolVar(&o.verbose, "v", false, "打印进度")
}

// isTerminal 判断标准输出是否接到终端，避免后台启动时弹出浏览器。
func isTerminal(f *os.File) bool {
	info, err := f.Stat()
	if err != nil {
		return false
	}
	return info.Mode()&os.ModeCharDevice != 0
}

func runServe(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow", flag.ContinueOnError)
	opt.register(fs)
	host := fs.String("host", "0.0.0.0", "HTTP 监听地址")
	port := fs.Int("port", 0, "HTTP 端口；0 自动分配")
	dist := fs.String("dist", "", "覆盖内嵌前端")
	noOpen := fs.Bool("no-open", false, "不自动打开浏览器")
	prDir := fs.String("pr-dir", "", "PR 目录；按 /pr/<owner>/<repo>/<number> 路由")
	noGitHub := fs.Bool("no-github", false, "只读本地 PR 目录，不回退抓取 GitHub")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 0 {
		return fmt.Errorf("serve 不接受位置参数；补丁用 --patch，PR 目录用 --pr-dir")
	}
	if *prDir != "" && opt.patch != "" {
		return fmt.Errorf("--pr-dir 与 --patch 不能同时使用")
	}
	run := serveRunOptions{host: *host, port: *port, dist: *dist, open: !*noOpen && isTerminal(os.Stdout)}
	if *prDir != "" {
		source, err := serve.NewPRSource(serve.PRSourceConfig{Dir: *prDir, GitHub: !*noGitHub})
		if err != nil {
			return err
		}
		return serve.ListenPR(serve.PRConfig{
			Host: *host, Port: *port, DistDir: *dist, DistFS: frontend.Dist(),
			Source: source, OpenBrowser: run.open,
		})
	}
	if opt.patch != "" {
		return servePatch(opt.patch, patchLabels{}, run)
	}
	a, err := newApp(opt)
	if err != nil {
		return err
	}
	defer a.close()
	return serve.Listen(serve.Config{
		Host: *host, Port: *port, DistDir: *dist, DistFS: frontend.Dist(),
		Payload: a.payload, Revisions: a.revisions, Load: a.load,
		OpenBrowser: run.open,
	})
}

func runDiff(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow diff", flag.ContinueOnError)
	opt.register(fs)
	host := fs.String("host", "0.0.0.0", "HTTP 监听地址")
	port := fs.Int("port", 0, "HTTP 端口；0 自动分配")
	dist := fs.String("dist", "", "覆盖内嵌前端")
	noOpen := fs.Bool("no-open", false, "不自动打开浏览器")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 1 {
		return fmt.Errorf("diff 只接受一个补丁路径")
	}
	patchPath := opt.patch
	if patchPath == "" && fs.NArg() == 1 {
		patchPath = fs.Arg(0)
	} else if patchPath != "" && fs.NArg() == 1 {
		return fmt.Errorf("补丁路径重复：位置参数 %q 与 --patch %q", fs.Arg(0), patchPath)
	}
	if patchPath != "" {
		return servePatch(patchPath, patchLabels{}, serveRunOptions{host: *host, port: *port, dist: *dist, open: !*noOpen && isTerminal(os.Stdout)})
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

type patchLabels struct {
	before, after, title string
}

type serveRunOptions struct {
	host string
	port int
	dist string
	open bool
}

func servePatch(path string, labels patchLabels, run serveRunOptions) error {
	data, err := readPatch(path)
	if err != nil {
		return err
	}
	payload, revisions, err := prdiff.Build(data, prdiff.Params{
		Repository: "patch", Branch: "patch", Before: labels.before, After: labels.after,
		Title: labels.title, Mode: contract.Folder,
		Note: "补丁模式：只含改动 hunk；展开的未改区间是空占位行。",
	})
	if err != nil {
		return err
	}
	fmt.Printf("· 补丁 %s，%d 个改动文件\n", displayPatch(path), len(payload.Code.Files))
	return serve.Listen(serve.Config{
		Host: run.host, Port: run.port, DistDir: run.dist, DistFS: frontend.Dist(),
		Payload:     func() contract.Payload { return payload },
		Revisions:   func() (contract.RevisionList, error) { return revisions, nil },
		OpenBrowser: run.open,
	})
}

func runExport(args []string) error {
	fs := flag.NewFlagSet("intentflow export", flag.ContinueOnError)
	var diffPath, out, dist, beforeLabel, afterLabel, title string
	fs.StringVar(&diffPath, "diff", "", "补丁文件；- 表示 stdin")
	fs.StringVar(&diffPath, "patch", "", "补丁文件；- 表示 stdin")
	fs.StringVar(&out, "out", "intentflow-static", "静态站点输出目录")
	fs.StringVar(&dist, "dist", "", "覆盖内嵌前端，仅调试用")
	fs.StringVar(&beforeLabel, "before-label", "", "补丁前标签")
	fs.StringVar(&afterLabel, "after-label", "", "补丁后标签")
	fs.StringVar(&title, "title", "", "补丁标题")
	force := fs.Bool("force", false, "输出目录非空时覆盖同名文件")
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() > 1 {
		return fmt.Errorf("export 只接受一个补丁路径")
	}
	if diffPath == "" && fs.NArg() == 1 {
		diffPath = fs.Arg(0)
	} else if diffPath != "" && fs.NArg() == 1 {
		return fmt.Errorf("补丁路径重复：位置参数 %q 与 --diff %q", fs.Arg(0), diffPath)
	}
	if diffPath == "" {
		return fmt.Errorf("缺少补丁：用 --diff <patch|-> 或位置参数")
	}
	data, err := readPatch(diffPath)
	if err != nil {
		return err
	}
	payload, revisions, err := prdiff.Build(data, prdiff.Params{
		Repository: "patch", Branch: "patch", Before: beforeLabel, After: afterLabel,
		Title: title, Mode: contract.Folder,
		Note: "静态导出：只含改动 hunk；展开的未改区间是空占位行。",
	})
	if err != nil {
		return err
	}
	distFS := frontend.Dist()
	if dist != "" {
		info, err := os.Stat(dist)
		if err != nil || !info.IsDir() {
			return fmt.Errorf("--dist 目录不存在: %s", dist)
		}
		distFS = os.DirFS(dist)
	}
	if err := export.Write(out, distFS, payload, revisions, *force); err != nil {
		return err
	}
	abs, _ := filepath.Abs(out)
	fmt.Println("→", abs)
	fmt.Printf("  %d 个改动文件；用任意静态服务器打开，例如：\n", len(payload.Code.Files))
	fmt.Printf("  python3 -m http.server --directory %s 8000\n", abs)
	return nil
}

const maxPatchBytes = 32 << 20

func readPatch(path string) ([]byte, error) {
	if path == "-" {
		if isTerminal(os.Stdin) {
			fmt.Fprintln(os.Stderr, "粘贴补丁，Ctrl-D 结束：")
		}
		return readLimited(os.Stdin)
	}
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.IsDir() {
		return nil, fmt.Errorf("%s 是目录；需要补丁文件", path)
	}
	if info.Size() > maxPatchBytes {
		return nil, fmt.Errorf("补丁超过 %d 字节", maxPatchBytes)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("补丁为空: %s", path)
	}
	return raw, nil
}

func readLimited(reader io.Reader) ([]byte, error) {
	raw, err := io.ReadAll(io.LimitReader(reader, maxPatchBytes+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxPatchBytes {
		return nil, fmt.Errorf("补丁超过 %d 字节", maxPatchBytes)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("补丁为空")
	}
	return raw, nil
}

func displayPatch(path string) string {
	if path == "-" {
		return "stdin"
	}
	return displayPath(path)
}

type revision struct {
	id   string
	data contract.Payload
}

type app struct {
	mu                                sync.Mutex
	opt                               options
	repo                              *gitcompare.Repo
	branch, baseRef, baseSHA, headSHA string
	base                              baseInfo
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
	if opt.rebase && (opt.before != "" || opt.after != "") {
		return nil, fmt.Errorf("--rebase 只适用于 Git 比较；目录比较请去掉该参数")
	}
	a := &app{opt: opt, cache: map[string]*revision{}}
	var err error
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
		code, err := payload.Build(before, after, bl+" → "+al, nil)
		if err != nil {
			return nil, err
		}
		comparison := model.Comparison{Mode: contract.Folder, BeforeLabel: bl, AfterLabel: al, Commits: []contract.Commit{}, Selected: []string{}, Note: "目录比较"}
		ctx := reviewctx.NewContext(before+" → "+after, "目录比较", before, after, "range", "", code)
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
	if a.baseRef != "" {
		a.base, err = resolveExplicitBase(a.repo, a.baseRef, a.headSHA)
		if err != nil {
			return nil, err
		}
		a.baseSHA = a.base.SHA
	} else {
		a.base, err = detectBase(a.repo, a.headSHA)
		if err != nil {
			return nil, err
		}
		a.baseRef, a.baseSHA = a.base.Ref, a.base.SHA
	}
	if opt.rebase {
		if err := a.tryRebase(a.base); err != nil {
			return nil, err
		}
		// rebase 成功或冲突回退后都重算，避免沿用旧 HEAD 的距离。
		if opt.base != "" {
			a.base, err = resolveExplicitBase(a.repo, a.baseRef, a.headSHA)
			if err != nil {
				return nil, err
			}
			a.baseSHA = a.base.SHA
		} else {
			var next baseInfo
			next, err = detectBase(a.repo, a.headSHA)
			if err != nil {
				return nil, err
			}
			a.base, a.baseRef, a.baseSHA = next, next.Ref, next.SHA
		}
	}
	a.printBase()
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

// tryRebase 只在显式 --rebase 时调用。冲突或无法执行时保持原 HEAD，
// 继续用 merge-base 基线启动；只有 git rebase --abort 失败才终止。
func (a *app) tryRebase(base baseInfo) error {
	target := base.Ref
	if target == "" {
		return nil
	}
	if !a.headIsWorktree && !strings.EqualFold(a.opt.head, "HEAD") && a.opt.head != "." {
		fmt.Printf("· --rebase：--head %s 不是当前分支，跳过\n", a.opt.head)
		return nil
	}
	tip := base.UpstreamSHA
	if !base.MergeBase {
		tip = base.SHA
	}
	if tip != "" && a.repo.IsAncestor(tip, a.headSHA) {
		fmt.Printf("· --rebase：HEAD 已包含 %s，跳过\n", target)
		return nil
	}
	dirty, err := a.repo.StatusFiles()
	if err != nil {
		return err
	}
	if len(dirty) > 0 {
		fmt.Printf("· --rebase：工作区有 %d 个未提交改动，跳过（不会自动 stash）\n", len(dirty))
		return nil
	}
	res, err := a.repo.Rebase(target)
	if err != nil {
		return err
	}
	if !res.Rebased {
		if res.Conflict {
			fmt.Printf("· --rebase 冲突，已自动 git rebase --abort；继续用 merge-base 基线\n")
		} else {
			fmt.Printf("· --rebase 未执行：%s；继续用 merge-base 基线\n", res.Detail)
		}
	} else {
		fmt.Printf("· --rebase：已 rebase 到 %s\n", target)
	}
	head, err := a.repo.Resolve("HEAD")
	if err != nil {
		return err
	}
	a.headSHA = head
	return nil
}

func (a *app) printBase() {
	b := a.base
	fmt.Printf("· 分支 %s；基线 %s（%s，领先 %d 个提交）\n", a.branch, b.label(), shortSHA(b.SHA), b.Ahead)
	if b.Upstream == "" {
		return
	}
	switch {
	case b.Behind > 0 && !b.Contains:
		fmt.Printf("  落后 %s %d 个提交，建议 rebase\n", b.Upstream, b.Behind)
	case b.Behind > 0:
		fmt.Printf("  基线与 %s 相差 %d 个提交\n", b.Upstream, b.Behind)
	case !b.Contains:
		fmt.Printf("  未包含 %s 最新提交，建议 rebase\n", b.Upstream)
	default:
		fmt.Printf("  已包含 %s 最新提交\n", b.Upstream)
	}
}

func (a *app) newPayload(comparison model.Comparison, code contract.CodeBundle, ctx contract.ReviewContext) (contract.Payload, error) {
	return contract.Payload{Code: code, Session: reviewctx.Empty(ctx), Review: model.Review{
		Before: comparison.BeforeLabel, After: comparison.AfterLabel, Comparison: comparison,
		Notes: []string{}, Signals: []model.Signal{}, Findings: []contract.Finding{},
		Scan:       contract.ScanState{Mode: contract.ScanModeDiff, Status: contract.ScanStatusSkipped},
		BaseLabel:  a.base.label(),
		BaseBehind: int32(a.base.Behind), BaseUpstream: a.base.Upstream, NeedsRebase: a.base.needsRebase(),
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
	renames, err := a.repo.Renames(base, head)
	if err != nil {
		return nil, err
	}
	code, err := payload.Build(before, after, bl+" → "+al, renames)
	if err != nil {
		return nil, err
	}
	ctx := reviewctx.NewContext(a.repo.Root, a.branch, base, head, id, a.repo.Subdir, code)
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

// mainRefCandidates 是自动基线的首选 ref，顺序决定距离相同时的优先级。
var mainRefCandidates = []string{"main", "master", "origin/main", "origin/master"}

// baseInfo 描述一次比较所用的基线，以及它与主分支最新提交的关系。
type baseInfo struct {
	Ref         string // 选中的 ref，例如 origin/main 或显式 --base
	SHA         string // 实际基线提交；自动模式是 merge-base
	Ahead       int    // HEAD 比基线多出的提交数
	Upstream    string // 计算落后量所用的主分支 ref
	UpstreamSHA string // 主分支 ref 的最新提交
	Behind      int    // 基线落后主分支的提交数
	Contains    bool   // HEAD 是否已包含主分支最新提交
	MergeBase   bool   // SHA 是否来自 git merge-base
}

func (b baseInfo) label() string {
	if b.MergeBase {
		return "merge-base(" + b.Ref + "@" + shortSHA(b.SHA) + ")"
	}
	return b.Ref
}

func (b baseInfo) needsRebase() bool { return b.Upstream != "" && !b.Contains }

// nearestMain 依次尝试主分支 ref，选 merge-base 距 HEAD 最近的一个。
// 距离相同时取落后主分支更多（更新）的 ref，避免选中过期的本地 main。
func nearestMain(repo *gitcompare.Repo, head string) (baseInfo, bool) {
	groups := [][]string{mainRefCandidates, fallbackRefs(repo)}
	for _, candidates := range groups {
		if best, found := pickNearest(repo, head, candidates); found {
			return best, true
		}
	}
	return baseInfo{}, false
}

func fallbackRefs(repo *gitcompare.Repo) []string {
	refs := []string{"origin/HEAD"}
	if up := repo.Upstream(); up != "" && up != "origin/HEAD" {
		refs = append(refs, up)
	}
	return refs
}

func pickNearest(repo *gitcompare.Repo, head string, candidates []string) (baseInfo, bool) {
	var best baseInfo
	found := false
	for _, candidate := range candidates {
		tip, err := repo.Resolve(candidate)
		if err != nil {
			continue
		}
		mb, err := repo.MergeBase(head, tip)
		if err != nil {
			continue
		}
		distance, err := repo.Distance(mb, head)
		if err != nil {
			continue
		}
		behind, _ := repo.Distance(mb, tip)
		if found && (distance > best.Ahead || (distance == best.Ahead && behind <= best.Behind)) {
			continue
		}
		best = baseInfo{Ref: candidate, SHA: mb, Ahead: distance, Upstream: candidate, UpstreamSHA: tip, Behind: behind, MergeBase: true}
		found = true
	}
	return best, found
}

func detectBase(repo *gitcompare.Repo, head string) (baseInfo, error) {
	info, ok := nearestMain(repo, head)
	if !ok {
		return baseInfo{}, fmt.Errorf("找不到可用基线：main / master / origin/main / origin/master / origin/HEAD / 当前分支上游都不可用；用 --base <ref> 指定基线")
	}
	info.Behind, _ = repo.Distance(info.SHA, info.UpstreamSHA)
	info.Contains = repo.IsAncestor(info.UpstreamSHA, head)
	return info, nil
}

// resolveExplicitBase 保留用户指定的基线，只补充与主分支的差距。
func resolveExplicitBase(repo *gitcompare.Repo, ref, head string) (baseInfo, error) {
	sha, err := repo.Resolve(ref)
	if err != nil {
		return baseInfo{}, err
	}
	info := baseInfo{Ref: ref, SHA: sha}
	info.Ahead, _ = repo.Distance(sha, head)
	if upstream, ok := nearestMain(repo, head); ok {
		info.Upstream, info.UpstreamSHA = upstream.Ref, upstream.UpstreamSHA
		info.Behind, _ = repo.Distance(sha, upstream.UpstreamSHA)
		info.Contains = repo.IsAncestor(upstream.UpstreamSHA, head)
	}
	return info, nil
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
