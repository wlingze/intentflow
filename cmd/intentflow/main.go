// Command intentflow 计算一次改动在三个层面的语义 diff。
//
// 用法：
//
//	intentflow serve --before <dir> --after <dir> [--addr 127.0.0.1:8123]
//	intentflow diff  --before <dir> --after <dir> [--out ./intentflow-out]
//
// serve 会先完成分析，再直接启动 HTTP 工作台；diff 只写结构化结果。
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/emit"
	"github.com/yaklang/intentflow/internal/gitcompare"
	"github.com/yaklang/intentflow/internal/insight"
	"github.com/yaklang/intentflow/internal/model"
	"github.com/yaklang/intentflow/internal/payload"
	"github.com/yaklang/intentflow/internal/scan"
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
		command = args[0]
		args = args[1:]
	}
	switch command {
	case "diff":
		return runDiff(args)
	case "serve":
		return runServe(args)
	case "help", "version":
		usage()
		return nil
	default:
		usage()
		return fmt.Errorf("未知命令 %q", command)
	}
}

func usage() {
	fmt.Fprint(os.Stderr, `intentflow — 三层语义 diff

  intentflow serve --before <dir> --after <dir>
      分析后启动 review 工作台（默认 127.0.0.1:8123）

  intentflow diff --before <dir> --after <dir> [--out <dir>]
      只输出 review.json，不启动服务

通用参数：
  --before-label  页面上显示的改动前标签（默认用目录名）
  --after-label   页面上显示的改动后标签
  --dump-facts    额外写出两侧全量事实
  -v              打印进度
`)
}

// options 是两条命令共享的分析参数。
type options struct {
	before      string
	after       string
	beforeLabel string
	afterLabel  string
	out         string
	dump        bool
	verbose     bool
	repo        string
	subdir      string
	from        string
	to          string
	commits     string
}

func (o *options) register(fs *flag.FlagSet) {
	fs.StringVar(&o.before, "before", "", "改动前的代码目录")
	fs.StringVar(&o.after, "after", "", "改动后的代码目录")
	fs.StringVar(&o.beforeLabel, "before-label", "", "改动前的显示标签")
	fs.StringVar(&o.afterLabel, "after-label", "", "改动后的显示标签")
	fs.StringVar(&o.out, "out", "./intentflow-out", "输出目录")
	fs.BoolVar(&o.dump, "dump-facts", false, "额外写出两侧全量事实，用于调试")
	fs.BoolVar(&o.verbose, "v", false, "打印进度")
	fs.StringVar(&o.repo, "repo", "", "Git 仓库目录；设置后用提交范围代替目录比较")
	fs.StringVar(&o.subdir, "subdir", "", "只比较仓库内的这个子树")
	fs.StringVar(&o.from, "from", "HEAD~1", "提交范围的起点（不含）")
	fs.StringVar(&o.to, "to", "HEAD", "提交范围的终点")
	fs.StringVar(&o.commits, "commits", "", "初始选中的提交 SHA，逗号分隔；空表示全部")
}

func runDiff(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow diff", flag.ExitOnError)
	opt.register(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	var review *model.Review
	var err error
	if opt.repo != "" {
		var built contract.Payload
		built, err = buildGitReview(opt)
		if err == nil {
			review = &built.Review
		}
	} else {
		review, err = analyze(opt)
	}
	if err != nil {
		return err
	}
	if review.Ai.Status == "" {
		review.Ai = insight.Analyze(context.Background(), review, nil)
	}
	jsonPath, err := emit.JSON(review, opt.out)
	if err != nil {
		return fmt.Errorf("写出 review.json 失败: %w", err)
	}
	printStats(review)
	fmt.Println("→", jsonPath)
	if opt.repo != "" {
		fmt.Printf("提示：运行 intentflow serve --repo %s --subdir %s --from %s --to %s 打开工作台\n",
			opt.repo, opt.subdir, opt.from, opt.to)
	} else {
		fmt.Printf("提示：运行 intentflow serve --before %s --after %s 打开工作台\n", opt.before, opt.after)
	}
	return nil
}

func runServe(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow serve", flag.ExitOnError)
	opt.register(fs)
	addr := fs.String("addr", "127.0.0.1:8123", "HTTP 监听地址")
	dist := fs.String("dist", "frontend/dist", "前端构建产物目录")
	if err := fs.Parse(args); err != nil {
		return err
	}

	if opt.repo != "" {
		return runServeGit(opt, *addr, *dist)
	}

	review, err := analyze(opt)
	if err != nil {
		return err
	}
	bRoot, err := scan.EnsureRoot(opt.before)
	if err != nil {
		return fmt.Errorf("before: %w", err)
	}
	aRoot, err := scan.EnsureRoot(opt.after)
	if err != nil {
		return fmt.Errorf("after: %w", err)
	}
	code, err := payload.Build(bRoot, aRoot, review.Before+" → "+review.After)
	if err != nil {
		return fmt.Errorf("读取源码失败: %w", err)
	}
	if code.Truncated {
		fmt.Printf("注意：%d 个文件超出体积上限，未携带正文\n", len(code.Skipped))
	}
	review.Ai = insight.Analyze(context.Background(), review, code.Files)
	jsonPath, err := emit.JSON(review, opt.out)
	if err != nil {
		return fmt.Errorf("写出 review.json 失败: %w", err)
	}
	printStats(review)
	fmt.Println("→", jsonPath)

	return serve.Listen(serve.Config{
		Addr:    *addr,
		DistDir: *dist,
		OutDir:  opt.out,
		Payload: contract.Payload{Review: *review, Code: code},
	})
}

// analyze 跑完整的三层分析。serve 与 diff 共用这一条路径，
// 避免两个命令的结果出现偏差。
func analyze(opt options) (*model.Review, error) {
	if opt.before == "" || opt.after == "" {
		usage()
		return nil, fmt.Errorf("--before 与 --after 都是必需的")
	}

	bRoot, err := scan.EnsureRoot(opt.before)
	if err != nil {
		return nil, fmt.Errorf("before: %w", err)
	}
	aRoot, err := scan.EnsureRoot(opt.after)
	if err != nil {
		return nil, fmt.Errorf("after: %w", err)
	}

	beforeLabel := displayPath(bRoot)
	if opt.beforeLabel != "" {
		beforeLabel = opt.beforeLabel
	}
	afterLabel := displayPath(aRoot)
	if opt.afterLabel != "" {
		afterLabel = opt.afterLabel
	}
	return analyzeRoots(bRoot, aRoot, beforeLabel, afterLabel, opt, nil)
}

// analyzeRoots 对两个已就绪的目录跑完整分析。目录模式与 Git 模式共用它，
// 保证两种入口得到同一种结果结构。
func analyzeRoots(bRoot, aRoot, beforeLabel, afterLabel string, opt options, comparison *model.Comparison) (*model.Review, error) {
	review := &model.Review{
		Before:  beforeLabel,
		After:   afterLabel,
		Notes:   []string{},
		Signals: []model.Signal{},
	}
	if comparison == nil {
		review.Comparison = model.Comparison{
			Mode:        contract.Folder,
			BeforeLabel: beforeLabel,
			AfterLabel:  afterLabel,
			Commits:     []model.Commit{},
			Selected:    []string{},
			Note:        "目录比较：没有 Git 历史，提交选择不可用",
		}
	} else {
		review.Comparison = *comparison
	}

	// ---- 所有层级共用一次 SSA 编译 ----
	if opt.verbose {
		fmt.Println("· 编译 SSA（before）")
	}
	bSet, bIndex, bNotes, err := scan.AnalyzeSSA(context.Background(), bRoot, "intentflow_before")
	if err != nil {
		return nil, fmt.Errorf("before 分析失败: %w", err)
	}
	for _, n := range bNotes {
		review.Notes = append(review.Notes, "before: "+n)
	}
	if opt.verbose {
		fmt.Printf("  before 事实: project=%d logic=%d intent=%d funcs=%d\n",
			bSet.Len(model.LayerProject), bSet.Len(model.LayerLogic), bSet.Len(model.LayerIntent), len(bIndex.Funcs))
	}

	if opt.verbose {
		fmt.Println("· 编译 SSA（after）")
	}
	aSet, aIndex, aNotes, err := scan.AnalyzeSSA(context.Background(), aRoot, "intentflow_after")
	if err != nil {
		return nil, fmt.Errorf("after 分析失败: %w", err)
	}
	for _, n := range aNotes {
		review.Notes = append(review.Notes, "after: "+n)
	}
	if opt.verbose {
		fmt.Printf("  after  事实: project=%d logic=%d intent=%d funcs=%d\n",
			aSet.Len(model.LayerProject), aSet.Len(model.LayerLogic), aSet.Len(model.LayerIntent), len(aIndex.Funcs))
	}

	// ---- 三层 diff ----
	if opt.dump {
		if err := emit.FactSets(bSet, aSet, opt.out); err != nil {
			return nil, fmt.Errorf("写出事实快照失败: %w", err)
		}
		fmt.Println("→", filepath.Join(opt.out, "facts.json"))
	}

	review.Project = model.Diff(model.LayerProject, bSet, aSet)
	review.Logic = model.Diff(model.LayerLogic, bSet, aSet)
	review.Intent = model.Diff(model.LayerIntent, bSet, aSet)
	review.Signals = scan.Signals(review)
	review.Behavior = scan.BuildBehavior(bIndex, aIndex, scan.IntentFacts(bSet), review)
	review.Symbols = scan.BuildSymbolGraph(bIndex, aIndex)
	return review, nil
}

func printStats(review *model.Review) {
	fmt.Printf("意图层 ±%d/%d  逻辑层 ±%d/%d  项目层 ±%d/%d  关注点 %d\n",
		len(review.Intent.Added), len(review.Intent.Removed),
		len(review.Logic.Added), len(review.Logic.Removed),
		len(review.Project.Added), len(review.Project.Removed),
		len(review.Signals))
}

// displayPath 优先返回相对当前工作目录的路径，便于阅读。
func displayPath(abs string) string {
	wd, err := os.Getwd()
	if err != nil {
		return abs
	}
	if rel, err := filepath.Rel(wd, abs); err == nil && !strings.HasPrefix(rel, "..") {
		return rel
	}
	return abs
}

// mergeLayer 把 src 中指定层的事实并入 dst。
func mergeLayer(dst, src model.FactSet, layer model.Layer) {
	for _, f := range src[layer] {
		dst.Add(f)
	}
}

// ---- Git 比较模式 ----

// gitRequest 是一次「选择提交后重新分析」所需的全部输入。
type gitRequest struct {
	opt     options
	repo    *gitcompare.Repo
	baseSHA string
	all     []contract.Commit
}

// buildGitReview 给 diff 命令用的 Git 入口，复用 serve 的同一条分析路径。
func buildGitReview(opt options) (contract.Payload, error) {
	repo, err := gitcompare.Open(opt.repo, opt.subdir)
	if err != nil {
		return contract.Payload{}, err
	}
	baseSHA, err := repo.Resolve(opt.from)
	if err != nil {
		return contract.Payload{}, err
	}
	headSHA, err := repo.Resolve(opt.to)
	if err != nil {
		return contract.Payload{}, err
	}
	all, err := repo.Commits(baseSHA, headSHA)
	if err != nil {
		return contract.Payload{}, err
	}
	if len(all) == 0 {
		return contract.Payload{}, fmt.Errorf("%s..%s 内没有触及 %q 的提交", opt.from, opt.to, opt.subdir)
	}
	return buildGitPayload(gitRequest{opt: opt, repo: repo, baseSHA: baseSHA, all: all}, parseCSV(opt.commits)...)
}

// gitPayloadCache 缓存 (选中提交集合) -> payload。分析一次约一分钟，
// 用户来回切换勾选时不能每次都重跑。
type gitPayloadCache struct {
	mu    sync.Mutex
	items map[string]contract.Payload
}

// runServeGit 启动 Git 提交比较模式的工作台。
func runServeGit(opt options, addr, dist string) error {
	repo, err := gitcompare.Open(opt.repo, opt.subdir)
	if err != nil {
		return err
	}
	baseSHA, err := repo.Resolve(opt.from)
	if err != nil {
		return err
	}
	headSHA, err := repo.Resolve(opt.to)
	if err != nil {
		return err
	}
	all, err := repo.Commits(baseSHA, headSHA)
	if err != nil {
		return fmt.Errorf("读取提交列表失败: %w", err)
	}
	if len(all) == 0 {
		return fmt.Errorf("%s..%s 内没有触及 %q 的提交", opt.from, opt.to, opt.subdir)
	}

	req := gitRequest{opt: opt, repo: repo, baseSHA: baseSHA, all: all}
	selected := parseCSV(opt.commits)
	payload, err := buildGitPayload(req, selected...)
	if err != nil {
		return err
	}
	cache := &gitPayloadCache{items: map[string]contract.Payload{cacheKey(selected, all): payload}}

	commits := func() (contract.CommitList, error) {
		return contract.CommitList{
			Mode:     contract.Git,
			Repo:     ptr(repo.Root),
			Subdir:   ptr(repo.Subdir),
			BaseRef:  ptr(opt.from),
			HeadRef:  ptr(opt.to),
			Commits:  all,
			Selected: selected,
			Note:     "勾选提交后只比较这些提交的文件改动",
		}, nil
	}
	rebuild := func(chosen []string) (contract.Payload, error) {
		key := cacheKey(chosen, all)
		cache.mu.Lock()
		if hit, ok := cache.items[key]; ok {
			cache.mu.Unlock()
			return hit, nil
		}
		cache.mu.Unlock()
		built, err := buildGitPayload(req, chosen...)
		if err != nil {
			return contract.Payload{}, err
		}
		cache.mu.Lock()
		cache.items[key] = built
		cache.mu.Unlock()
		return built, nil
	}

	jsonPath, err := emit.JSON(&payload.Review, opt.out)
	if err != nil {
		return fmt.Errorf("写出 review.json 失败: %w", err)
	}
	printStats(&payload.Review)
	fmt.Println("→", jsonPath)

	return serve.Listen(serve.Config{
		Addr:    addr,
		DistDir: dist,
		OutDir:  opt.out,
		Payload: payload,
		Commits: commits,
		Rebuild: rebuild,
	})
}

// buildGitPayload 按选中提交物化目录并跑分析。空选择表示全部提交。
func buildGitPayload(req gitRequest, selected ...string) (contract.Payload, error) {
	chosen := selectCommits(req.all, selected)
	if len(chosen) == 0 {
		return contract.Payload{}, fmt.Errorf("没有选中任何提交")
	}
	base := req.baseSHA
	baseLabel := req.opt.from
	if chosen[0].Sha != req.all[0].Sha {
		if len(chosen[0].Parents) == 0 {
			base = ""
			baseLabel = "空树"
		} else {
			base = chosen[0].Parents[0]
			baseLabel = shortSHA(base)
		}
	} else {
		baseLabel = req.opt.from
	}
	shas := make([]string, 0, len(chosen))
	for _, commit := range chosen {
		shas = append(shas, commit.Sha)
	}
	afterLabel := shortSHA(chosen[len(chosen)-1].Sha)
	if len(chosen) == len(req.all) {
		afterLabel = req.opt.to
	} else {
		afterLabel = fmt.Sprintf("%s · %d/%d 提交", shortSHA(chosen[len(chosen)-1].Sha), len(chosen), len(req.all))
	}

	tmp, err := os.MkdirTemp("", "intentflow-git-*")
	if err != nil {
		return contract.Payload{}, fmt.Errorf("创建临时目录失败: %w", err)
	}
	defer os.RemoveAll(tmp)

	beforeDir, afterDir, err := req.repo.Materialize(base, shas, tmp)
	if err != nil {
		return contract.Payload{}, err
	}
	note := "只应用所选提交的文件版本；同一文件里未选中提交的改动不会单独进入比较"
	comparison := &model.Comparison{
		Mode:        contract.Git,
		BeforeLabel: baseLabel,
		AfterLabel:  afterLabel,
		Repo:        ptr(req.repo.Root),
		Subdir:      ptr(req.repo.Subdir),
		BaseRef:     ptr(baseLabel),
		HeadRef:     ptr(afterLabel),
		Commits:     req.all,
		Selected:    shas,
		Note:        note,
	}

	if req.opt.verbose {
		fmt.Printf("· Git 比较 %d 个提交（base=%s）\n", len(chosen), baseLabel)
	}
	review, err := analyzeRoots(beforeDir, afterDir, baseLabel, afterLabel, req.opt, comparison)
	if err != nil {
		return contract.Payload{}, err
	}
	code, err := payload.Build(beforeDir, afterDir, review.Before+" → "+review.After)
	if err != nil {
		return contract.Payload{}, fmt.Errorf("读取源码失败: %w", err)
	}
	review.Ai = insight.Analyze(context.Background(), review, code.Files)
	return contract.Payload{Review: *review, Code: code}, nil
}

func selectCommits(all []contract.Commit, selected []string) []contract.Commit {
	if len(selected) == 0 {
		return all
	}
	// 接受完整 SHA 或唯一前缀，前端传完整 SHA，手敲前缀也能用。
	matches := func(commit contract.Commit, sha string) bool {
		sha = strings.TrimSpace(sha)
		if len(sha) < 4 {
			return false
		}
		return strings.HasPrefix(commit.Sha, sha) || strings.HasPrefix(commit.Short, sha)
	}
	chosen := make([]contract.Commit, 0, len(selected))
	for _, commit := range all {
		for _, sha := range selected {
			if matches(commit, sha) {
				chosen = append(chosen, commit)
				break
			}
		}
	}
	return chosen
}

func cacheKey(selected []string, all []contract.Commit) string {
	if len(selected) == 0 {
		return "all"
	}
	return strings.Join(selected, ",")
}

func parseCSV(raw string) []string {
	out := []string{}
	for _, part := range strings.Split(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}

func shortSHA(sha string) string {
	if len(sha) <= 8 {
		return sha
	}
	return sha[:8]
}

func ptr(value string) *string {
	if value == "" {
		return nil
	}
	return &value
}
