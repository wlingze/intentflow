package scan

import (
	"fmt"
	"sort"
	"strings"

	"github.com/yaklang/intentflow/internal/model"
)

// externalSources 是「来自程序外部、可被攻击者或用户控制」的来源类别。
var externalSources = map[string]struct{}{
	"http_input":     {},
	"env":            {},
	"cli_args":       {},
	"function_param": {},
}

// riskyImports 是出现即值得 review 的包。
var riskyImports = map[string]string{
	"os/exec":       "启用进程执行能力",
	"database/sql":  "直接引入数据库访问",
	"unsafe":        "绕过类型安全",
	"crypto/md5":    "使用弱哈希算法",
	"crypto/des":    "使用弱加密算法",
	"text/template": "未转义模板，注意注入",
	"io/ioutil":     "已废弃包",
}

// riskyCallees 是出现即值得 review 的被调函数。
var riskyCallees = map[string]string{
	"Command":        "构造外部命令",
	"CommandContext": "构造外部命令",
	"Query":          "执行 SQL",
	"QueryRow":       "执行 SQL",
	"Exec":           "执行 SQL",
	"Raw":            "执行原始 SQL",
	"ReadFile":       "读取文件",
	"WriteFile":      "写入文件",
	"OpenFile":       "打开文件",
	"Unmarshal":      "反序列化外部数据",
	"Parse":          "解析外部数据",
}

// Signals 从三层 diff 派生 review 关注点。
//
// 关键：每一条 Signal 都必须挂 evidence（Fact.Identity）。
// 没有 evidence 的 signal 不生成 —— 这是「不许编」的强制点。
func Signals(r *model.Review) []model.Signal {
	var out []model.Signal

	// ---- 意图层：新增外部输入 → 副作用的链路 ----
	for _, f := range r.Intent.Added {
		if !hasExternalSource(f.Source) {
			continue
		}
		sev := "warn"
		switch {
		case f.Source == "http_input" && isSensitiveSink(f) && (f.Shape == "format" || f.Shape == "concat"):
			sev = "high"
		case f.Source == "cli_args" || f.Source == "env":
			sev = "warn"
		}
		title := fmt.Sprintf("新增链路：%s", f.Title)
		detail := fmt.Sprintf("来源 %s 经 %s 到达副作用点。位置 %s:%d。",
			f.Source, f.Shape, shortFile(f.File), f.Line)
		if f.Shape == "format" || f.Shape == "concat" {
			detail += "数据参与了字符串构造，确认已参数化或校验。"
		}
		out = append(out, model.Signal{
			ID:         model.Identity("sig", f.Identity, "intent-added"),
			Severity:   sev,
			Title:      title,
			Detail:     detail,
			Evidence:   []string{f.Identity},
			Confidence: model.Derived,
		})
	}

	// ---- 意图层：删除了外部输入链路 ----
	for _, f := range r.Intent.Removed {
		if !hasExternalSource(f.Source) {
			continue
		}
		out = append(out, model.Signal{
			ID:         model.Identity("sig", f.Identity, "intent-removed"),
			Severity:   "info",
			Title:      fmt.Sprintf("移除链路：%s", f.Title),
			Detail:     "确认这是有意收敛，而不是漏改。",
			Evidence:   []string{f.Identity},
			Confidence: model.Derived,
		})
	}

	// ---- 逻辑层：新增危险调用边 ----
	for _, f := range r.Logic.Added {
		callee := lastSegment(f.Title)
		reason, risky := riskyCallees[callee]
		if !risky {
			continue
		}
		out = append(out, model.Signal{
			ID:         model.Identity("sig", f.Identity, "logic-added"),
			Severity:   "warn",
			Title:      fmt.Sprintf("新增调用：%s", f.Title),
			Detail:     reason + "。确认入参已参数化或校验。",
			Evidence:   []string{f.Identity},
			Confidence: model.Extracted,
		})
	}

	// ---- 项目层：新增敏感依赖 ----
	for _, f := range r.Project.Added {
		if f.Kind != "import" {
			continue
		}
		pkg := strings.TrimPrefix(f.Title, "import ")
		reason, risky := riskyImports[pkg]
		if !risky {
			continue
		}
		out = append(out, model.Signal{
			ID:         model.Identity("sig", f.Identity, "import-added"),
			Severity:   "warn",
			Title:      fmt.Sprintf("新增依赖：%s", pkg),
			Detail:     reason + "。确认这是本 PR 引入的必要依赖。",
			Evidence:   []string{f.Identity},
			Confidence: model.Extracted,
		})
	}

	sort.Slice(out, func(i, j int) bool {
		ri, rj := sevRank(out[i].Severity), sevRank(out[j].Severity)
		if ri != rj {
			return ri < rj
		}
		return out[i].Title < out[j].Title
	})
	return out
}

func sevRank(s string) int {
	switch s {
	case "high":
		return 0
	case "warn":
		return 1
	default:
		return 2
	}
}

func hasExternalSource(s string) bool {
	for _, part := range strings.Split(s, ",") {
		if _, ok := externalSources[strings.TrimSpace(part)]; ok {
			return true
		}
	}
	return false
}

func isSensitiveSink(f model.Fact) bool {
	switch f.Category {
	case "sql", "exec":
		return true
	}
	return false
}

func shortFile(p string) string {
	if p == "" {
		return "?"
	}
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}

func lastSegment(s string) string {
	if i := strings.LastIndex(s, " → "); i >= 0 {
		return s[i+len(" → "):]
	}
	return s
}
