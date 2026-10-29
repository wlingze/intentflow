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

	"github.com/yaklang/intentflow/internal/contract"
	"github.com/yaklang/intentflow/internal/emit"
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
}

func (o *options) register(fs *flag.FlagSet) {
	fs.StringVar(&o.before, "before", "", "改动前的代码目录")
	fs.StringVar(&o.after, "after", "", "改动后的代码目录")
	fs.StringVar(&o.beforeLabel, "before-label", "", "改动前的显示标签")
	fs.StringVar(&o.afterLabel, "after-label", "", "改动后的显示标签")
	fs.StringVar(&o.out, "out", "./intentflow-out", "输出目录")
	fs.BoolVar(&o.dump, "dump-facts", false, "额外写出两侧全量事实，用于调试")
	fs.BoolVar(&o.verbose, "v", false, "打印进度")
}

func runDiff(args []string) error {
	var opt options
	fs := flag.NewFlagSet("intentflow diff", flag.ExitOnError)
	opt.register(fs)
	if err := fs.Parse(args); err != nil {
		return err
	}
	review, err := analyze(opt)
	if err != nil {
		return err
	}
	review.Ai = insight.Analyze(context.Background(), review, nil)
	jsonPath, err := emit.JSON(review, opt.out)
	if err != nil {
		return fmt.Errorf("写出 review.json 失败: %w", err)
	}
	printStats(review)
	fmt.Println("→", jsonPath)
	fmt.Printf("提示：运行 intentflow serve --before %s --after %s 打开工作台\n", opt.before, opt.after)
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
	review := &model.Review{
		Before:  beforeLabel,
		After:   afterLabel,
		Notes:   []string{},
		Signals: []model.Signal{},
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
