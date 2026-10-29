package scan

import (
	"context"
	"fmt"
	"sort"
	"strings"

	"github.com/yaklang/yaklang/common/yak/ssa_compile"
	"github.com/yaklang/yaklang/common/yak/ssaapi"
	"github.com/yaklang/yaklang/common/yak/ssaapi/ssaconfig"

	"github.com/yaklang/intentflow/internal/model"
)

// IntentFacts 用 SSA + SyntaxFlow 抽取 L1 意图事实。
//
// 每个 Sink 跑一条 SyntaxFlow 规则，对每个匹配到的调用做：
//  1. 记录调用所在函数与位置；
//  2. 对参数调用 GetTopDefs 回溯到数据源头；
//  3. 用源头叶子值的类型分类来源（HTTP 参数 / 环境变量 / 字面量 …）；
//  4. 判定数据「如何」到达（直接传参 / 格式化 / 拼接），这是安全与否的分界；
//  5. 汇总跨过的函数名，形成 path。
//
// 返回的事实 Confidence 为 DERIVED：存在性来自 IR，
// 但「来源分类」「到达形态」「跨函数路径」经过了一层规则映射。
func IntentFacts(ctx context.Context, root, programName string) (model.FactSet, []string, error) {
	set := model.NewFactSet()
	var notes []string

	cfg, err := ssaconfig.NewCLIScanConfig(
		ssaconfig.WithCodeSourceKind(ssaconfig.CodeSourceLocal),
		ssaconfig.WithCodeSourceLocalFile(root),
		ssaconfig.WithProjectRawLanguage("golang"),
		ssaconfig.WithSetProgramName(programName),
		ssaconfig.WithCompileMemoryCompile(true),
		ssaconfig.WithSyntaxFlowMemory(true),
	)
	if err != nil {
		return set, notes, fmt.Errorf("构建编译配置失败: %w", err)
	}

	prog, err := ssa_compile.CompileWithConfig(ctx, cfg)
	if err != nil {
		return set, notes, fmt.Errorf("SSA 编译失败: %w", err)
	}

	// Go 前端对标准库的签名覆盖不完整（fmt.Sprintf / os.Getenv 等当前是
	// Undefined）。这不影响调用边与参数回溯，但会削弱类型级分析。
	// 把这类错误收敛成一条可读的 note，不逐条刷屏。
	if errs := prog.GetErrors(); len(errs) > 0 {
		notes = append(notes, fmt.Sprintf("SSA 编译产生 %d 条诊断（多为 Go 标准库签名缺失，不影响调用链回溯）", len(errs)))
	}

	for _, sink := range GoSinks {
		res, qerr := prog.SyntaxFlowWithError(sink.Query)
		if qerr != nil {
			notes = append(notes, fmt.Sprintf("规则 %s 执行失败: %v", sink.Category, qerr))
			continue
		}
		if res == nil {
			continue
		}

		sinks := res.GetValues("sink")
		params := res.GetValues("param")

		for _, s := range sinks {
			if s == nil || s.IsNil() {
				continue
			}
			snippet := compact(s.String(), 120)
			if excluded(snippet, sink.Exclude) {
				continue
			}

			caller := funcName(s)

			var (
				sources []string
				srcLoc  string
				shape   string
				rank    = -2
			)
			pathSet := map[string]struct{}{}

			for _, p := range params {
				if p == nil || p.IsNil() {
					continue
				}
				// 常量入参不携带数据来源，也不影响「如何到达」的判定。
				if p.GetOpcode() == "ConstInst" {
					continue
				}
				if sh, r := shapeOf(p); r > rank {
					shape, rank = sh, r
				}

				// 候选集必须包含实参本身。GetTopDefs 只返回叶子，
				// 而「os.Getenv」(env) 「+」(concat) 这类信息只存在于中间节点。
				// 只看叶子会把 `os.Getenv("X") + "/a"` 判成没有来源。
				candidates := append(ssaapi.Values{p}, p.GetTopDefs()...)
				for _, leaf := range candidates {
					if leaf == nil || leaf.IsNil() {
						continue
					}
					cls := classifySource(leaf)
					if cls == "literal" || cls == "library" {
						continue
					}
					sources = append(sources, cls)
					if srcLoc == "" {
						srcLoc = position(leaf, programName)
					}
					if f := funcName(leaf); f != "" && f != caller && f != "@main" {
						pathSet[f] = struct{}{}
					}
				}
			}

			if len(sources) == 0 {
				continue
			}
			sources = normalizeSources(sources)
			if shape == "" {
				shape = "call"
			}

			path := make([]string, 0, len(pathSet)+1)
			path = append(path, caller)
			for f := range pathSet {
				path = append(path, f)
			}
			sort.Strings(path[1:])

			title := fmt.Sprintf("%s 中的数据流入%s", caller, sink.Label)
			if len(path) > 1 {
				title = fmt.Sprintf("%s → %s 的数据流入%s", path[len(path)-1], caller, sink.Label)
			}

			set.Add(model.Fact{
				// 身份由「函数 + 副作用类别 + 来源类别 + 到达形态」决定。
				// 行号、变量改名、注释调整都不产生新身份；
				// 但把直接传参改成字符串拼接会产生新身份 —— 这正是需要被看见的改动。
				Identity:   model.Identity("chain", caller, sink.Category, strings.Join(sources, ","), shape),
				Layer:      model.LayerIntent,
				Kind:       "chain",
				Title:      title,
				Detail:     fmt.Sprintf("来源 %s；到达方式 %s（%s）；源头位置 %s", strings.Join(sources, ", "), shape, shapeHint(shape), srcLoc),
				File:       fileOf(s, programName),
				Line:       lineOf(s),
				Function:   caller,
				Confidence: model.Derived,
				Path:       path,
				Source:     strings.Join(sources, ","),
				Category:   sink.Category,
				Shape:      shape,
				Snippet:    snippet,
			})
		}
	}

	return set, notes, nil
}

// shapeOf 判定一个实参「如何」把数据带进副作用点。
//
// 返回的 rank 用于在同一次调用有多个实参时取「最危险」的那个。
func shapeOf(v *ssaapi.Value) (string, int) {
	s := v.String()
	switch v.GetOpcode() {
	case "BinOp":
		// SSA 反汇编把加法写成 add(a, b)，源码里看到的是 a + b，两种都要认。
		if strings.Contains(s, "add(") || strings.Contains(s, "+") {
			return "concat", 3
		}
		return "binop", 2
	case "Call":
		for _, f := range []string{"Sprintf", "Sprint", "Sprintln", "Join", "Builder", "WriteString", "Format"} {
			if strings.Contains(s, f) {
				return "format", 3
			}
		}
		return "call", 1
	case "Parameter":
		return "direct", 0
	case "ParameterMember":
		return "member", 0
	}
	return "call", 1
}

// shapeHint 把到达形态翻成一句人话。
func shapeHint(shape string) string {
	switch shape {
	case "direct":
		return "参数化传参，值未参与字符串构造"
	case "format":
		return "经格式化函数拼接进字符串"
	case "concat":
		return "经字符串拼接构造"
	case "member":
		return "取字段或下标后传入"
	}
	return "经函数返回后传入"
}

// normalizeSources 去掉被更外部来源覆盖的中间来源。
//
// findUser 的 name 参数最终来自 HTTP 查询串时，function_param 只是中转，
// 保留它会让同一类链路在重构后换身份，产生假 diff。
func normalizeSources(in []string) []string {
	uniq := uniqueSorted(in)
	if len(uniq) <= 1 {
		return uniq
	}
	out := make([]string, 0, len(uniq))
	for _, s := range uniq {
		if s == "function_param" || s == "unknown" {
			continue
		}
		out = append(out, s)
	}
	if len(out) == 0 {
		return uniq
	}
	return out
}

// classifySource 把 SSA 叶子值归类成数据来源类别。
//
// 这是启发式规则，不是类型系统。分类错了只会影响标签，
// 不会影响「存在这条数据流」这个 IR 事实本身。
func classifySource(v *ssaapi.Value) string {
	s := v.String()
	op := v.GetOpcode()

	if op == "ExternLib" {
		return "library"
	}
	if op == "ConstInst" {
		return "literal"
	}

	switch {
	case strings.Contains(s, "http.Request"),
		strings.Contains(s, "URL.Query"),
		strings.Contains(s, "FormValue"),
		strings.Contains(s, "PostForm"),
		strings.Contains(s, "Header.Get"):
		return "http_input"
	case strings.Contains(s, "os.Getenv"),
		strings.Contains(s, "os.Environ"),
		strings.Contains(s, "flag."):
		return "env"
	case strings.Contains(s, "os.Args"):
		return "cli_args"
	case op == "Parameter" || op == "ParameterMember":
		return "function_param"
	}
	return "unknown"
}

func excluded(snippet string, list []string) bool {
	for _, e := range list {
		if strings.Contains(snippet, e) {
			return true
		}
	}
	return false
}

// funcName 返回值所属函数名。
func funcName(v *ssaapi.Value) string {
	f := v.GetFunction()
	if f == nil || f.IsNil() {
		return ""
	}
	return f.GetName()
}

// fileOf 返回值的文件路径。
//
// SSA 的 editor URL 形如 /<programName>/main.go，前缀是编译时的程序名，
// 不是项目结构的一部分，必须剥掉，否则换一次运行目录名就变了。
func fileOf(v *ssaapi.Value, programName string) string {
	r := v.GetRange()
	if r == nil {
		return ""
	}
	ed := r.GetEditor()
	if ed == nil {
		return ""
	}
	u := ed.GetUrl()
	if programName != "" {
		u = strings.TrimPrefix(u, "/"+programName+"/")
	}
	return u
}

// lineOf 返回值的起始行号。
func lineOf(v *ssaapi.Value) int {
	r := v.GetRange()
	if r == nil {
		return 0
	}
	start := r.GetStart()
	if start == nil {
		return 0
	}
	return start.GetLine()
}

// position 返回 file:line 形式的位置串。
func position(v *ssaapi.Value, programName string) string {
	f, l := fileOf(v, programName), lineOf(v)
	if f == "" {
		return ""
	}
	if i := strings.LastIndex(f, "/"); i >= 0 {
		f = f[i+1:]
	}
	return fmt.Sprintf("%s:%d", f, l)
}

func compact(s string, n int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\t", " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func uniqueSorted(in []string) []string {
	seen := map[string]struct{}{}
	out := make([]string, 0, len(in))
	for _, s := range in {
		if _, ok := seen[s]; ok {
			continue
		}
		seen[s] = struct{}{}
		out = append(out, s)
	}
	sort.Strings(out)
	return out
}
