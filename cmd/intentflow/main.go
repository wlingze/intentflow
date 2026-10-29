// Command intentflow 计算一次改动在三个层面的语义 diff。
//
// 用法：
//
//	intentflow diff --before <dir> --after <dir> --out <dir>
//
// 输出：
//	<out>/review.json   给 agent 读的结构化结果
//	<out>/index.html    给人 review 的三层视图
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/yaklang/intentflow/internal/emit"
	"github.com/yaklang/intentflow/internal/model"
	"github.com/yaklang/intentflow/internal/scan"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "intentflow:", err)
		os.Exit(1)
	}
}

func run() error {
	fs := flag.NewFlagSet("intentflow", flag.ExitOnError)
	var (
		before  = fs.String("before", "", "改动前的代码目录")
		after   = fs.String("after", "", "改动后的代码目录")
		out     = fs.String("out", "./intentflow-out", "输出目录")
		noSSA   = fs.Bool("no-ssa", false, "跳过 SSA，只做项目层与逻辑层 diff")
		dump    = fs.Bool("dump-facts", false, "额外写出两侧全量事实，用于调试")
		verbose = fs.Bool("v", false, "打印进度")
	)
	if len(os.Args) > 1 && os.Args[1] == "diff" {
		os.Args = append(os.Args[:1], os.Args[2:]...)
	}
	if err := fs.Parse(os.Args[1:]); err != nil {
		return err
	}
	if *before == "" || *after == "" {
		fs.Usage()
		return fmt.Errorf("--before 与 --after 都是必需的")
	}

	bRoot, err := scan.EnsureRoot(*before)
	if err != nil {
		return fmt.Errorf("before: %w", err)
	}
	aRoot, err := scan.EnsureRoot(*after)
	if err != nil {
		return fmt.Errorf("after: %w", err)
	}

	review := &model.Review{
		Before: displayPath(bRoot),
		After:  displayPath(aRoot),
	}

	// ---- L3 + L2：语法层，go/ast ----
	if *verbose {
		fmt.Println("· 解析项目结构层与逻辑结构层")
	}
	bSet, err := scan.ProjectFacts(bRoot)
	if err != nil {
		return fmt.Errorf("before 解析失败: %w", err)
	}
	aSet, err := scan.ProjectFacts(aRoot)
	if err != nil {
		return fmt.Errorf("after 解析失败: %w", err)
	}

	// ---- L1：IR 层，SSA + SyntaxFlow ----
	if !*noSSA {
		if *verbose {
			fmt.Println("· 编译 SSA 并抽取意图层（before）")
		}
		bIntent, bNotes, err := scan.IntentFacts(context.Background(), bRoot, "intentflow_before")
		if err != nil {
			review.Notes = append(review.Notes, "before 意图层抽取失败: "+err.Error())
		} else {
			mergeLayer(bSet, bIntent, model.LayerIntent)
			for _, n := range bNotes {
				review.Notes = append(review.Notes, "before: "+n)
			}
			if *verbose {
				fmt.Printf("  before 事实: project=%d logic=%d intent=%d\n",
					bSet.Len(model.LayerProject), bSet.Len(model.LayerLogic), bSet.Len(model.LayerIntent))
			}
		}

		if *verbose {
			fmt.Println("· 编译 SSA 并抽取意图层（after）")
		}
		aIntent, aNotes, err := scan.IntentFacts(context.Background(), aRoot, "intentflow_after")
		if err != nil {
			review.Notes = append(review.Notes, "after 意图层抽取失败: "+err.Error())
		} else {
			mergeLayer(aSet, aIntent, model.LayerIntent)
			for _, n := range aNotes {
				review.Notes = append(review.Notes, "after: "+n)
			}
			if *verbose {
				fmt.Printf("  after  事实: project=%d logic=%d intent=%d\n",
					aSet.Len(model.LayerProject), aSet.Len(model.LayerLogic), aSet.Len(model.LayerIntent))
			}
		}
	} else {
		review.Notes = append(review.Notes, "已跳过 SSA（--no-ssa），意图层结果不完整")
	}

	// ---- 三层 diff ----
	if *dump {
		if err := emit.FactSets(bSet, aSet, *out); err != nil {
			return fmt.Errorf("写出事实快照失败: %w", err)
		}
		fmt.Println("→", filepath.Join(*out, "facts.json"))
	}

	review.Project = model.Diff(model.LayerProject, bSet, aSet)
	review.Logic = model.Diff(model.LayerLogic, bSet, aSet)
	review.Intent = model.Diff(model.LayerIntent, bSet, aSet)
	review.Signals = scan.Signals(review)

	// ---- 输出 ----
	jsonPath, err := emit.JSON(review, *out)
	if err != nil {
		return fmt.Errorf("写出 review.json 失败: %w", err)
	}
	webPath, err := emit.Web(review, *out)
	if err != nil {
		return fmt.Errorf("写出 index.html 失败: %w", err)
	}

	fmt.Printf("意图层 ±%d/%d  逻辑层 ±%d/%d  项目层 ±%d/%d  关注点 %d\n",
		len(review.Intent.Added), len(review.Intent.Removed),
		len(review.Logic.Added), len(review.Logic.Removed),
		len(review.Project.Added), len(review.Project.Removed),
		len(review.Signals))
	fmt.Println("→", jsonPath)
	fmt.Println("→", webPath)
	return nil
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
