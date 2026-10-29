package scan

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ProjectFacts 与 LogicFacts 已移到 ir.go：它们现在直接读 SSA 索引，
// 不再解析 Go 语法树。这个文件只保留路径与文本工具。

// EnsureRoot 校验目录存在，返回绝对路径。
func EnsureRoot(p string) (string, error) {
	abs, err := filepath.Abs(p)
	if err != nil {
		return "", err
	}
	st, err := os.Stat(abs)
	if err != nil {
		return "", fmt.Errorf("目标目录不可读: %w", err)
	}
	if !st.IsDir() {
		return "", fmt.Errorf("目标不是目录: %s", abs)
	}
	return abs, nil
}

func compact(s string, n int) string {
	s = strings.ReplaceAll(strings.ReplaceAll(s, "\n", " "), "\t", " ")
	if len(s) > n {
		return s[:n] + "…"
	}
	return s
}

func normalize(s string) string {
	return strings.Join(strings.Fields(s), " ")
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
