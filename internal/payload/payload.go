// Package payload 组装前端工作台需要的 JSON：三层 diff 结果 + 两侧源码。
//
// 分析结果由 scan 层产出，这里只负责把「人要看/要跳转」的代码一起带上。
// 前端不重新计算 diff，也不读磁盘，所有数据都来自同一个 payload。
package payload

import (
	"bytes"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/yaklang/intentflow/internal/contract"
)

// 单文件与整包上限。超过上限的文件只保留状态，不带正文，
// 避免一次 review 把几十 MB 的 vendor 目录塞进浏览器。
const (
	MaxFileBytes  = 512 * 1024
	MaxTotalBytes = 6 * 1024 * 1024
)

// Build 读取 before/after 两个目录，返回按路径排序的合并源码包。
func Build(beforeRoot, afterRoot, label string) (contract.CodeBundle, error) {
	before, err := readTree(beforeRoot)
	if err != nil {
		return contract.CodeBundle{}, err
	}
	after, err := readTree(afterRoot)
	if err != nil {
		return contract.CodeBundle{}, err
	}

	paths := make([]string, 0, len(before)+len(after))
	seen := make(map[string]struct{}, len(before)+len(after))
	for p := range before {
		seen[p] = struct{}{}
		paths = append(paths, p)
	}
	for p := range after {
		if _, ok := seen[p]; ok {
			continue
		}
		paths = append(paths, p)
	}
	sort.Strings(paths)

	bundle := contract.CodeBundle{Root: label, Files: make([]contract.CodeFile, 0, len(paths)), Skipped: []string{}}
	var total int
	for _, p := range paths {
		b, bOK := before[p]
		a, aOK := after[p]

		file := contract.CodeFile{
			Path:     p,
			Status:   statusOf(b, bOK, a, aOK),
			Language: languageOf(p),
		}

		size := len(b) + len(a)
		if total+size > MaxTotalBytes {
			bundle.Truncated = true
			bundle.Skipped = append(bundle.Skipped, p)
			bundle.Files = append(bundle.Files, file)
			continue
		}
		total += size

		if bOK {
			file.Before = b
		}
		if aOK {
			file.After = a
		}
		bundle.Files = append(bundle.Files, file)
	}
	return bundle, nil
}

func statusOf(before string, hasBefore bool, after string, hasAfter bool) contract.CodeStatus {
	switch {
	case !hasBefore && hasAfter:
		return contract.CodeStatusAdded
	case hasBefore && !hasAfter:
		return contract.CodeStatusRemoved
	case before == after:
		return contract.CodeStatusUnchanged
	default:
		return contract.CodeStatusModified
	}
}

// readTree 读取目录下的文本文件。二进制文件与超限文件直接跳过。
func readTree(root string) (map[string]string, error) {
	out := map[string]string{}
	err := filepath.WalkDir(root, func(p string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			if p != root && skipDir(d.Name()) {
				return filepath.SkipDir
			}
			return nil
		}
		info, err := d.Info()
		if err != nil || info.Size() > MaxFileBytes {
			return nil
		}
		raw, err := os.ReadFile(p)
		if err != nil || bytes.IndexByte(raw, 0) >= 0 {
			return nil
		}
		rel, err := filepath.Rel(root, p)
		if err != nil {
			return nil
		}
		out[filepath.ToSlash(rel)] = string(raw)
		return nil
	})
	if err != nil {
		return nil, err
	}
	return out, nil
}

// skipDir 排除构建产物、依赖和版本库目录。
func skipDir(name string) bool {
	if strings.HasPrefix(name, ".") {
		return true
	}
	switch name {
	case "node_modules", "vendor", "dist", "out", "bin", "build", "target",
		"__pycache__", ".next", ".venv", "venv":
		return true
	}
	return false
}

var languages = map[string]string{
	".go":     "go",
	".mod":    "go",
	".sum":    "text",
	".ts":     "typescript",
	".tsx":    "tsx",
	".js":     "javascript",
	".jsx":    "jsx",
	".mjs":    "javascript",
	".cjs":    "javascript",
	".json":   "json",
	".yaml":   "yaml",
	".yml":    "yaml",
	".toml":   "toml",
	".md":     "markdown",
	".css":    "css",
	".scss":   "scss",
	".html":   "html",
	".py":     "python",
	".rs":     "rust",
	".java":   "java",
	".kt":     "kotlin",
	".c":      "c",
	".h":      "c",
	".cc":     "cpp",
	".cpp":    "cpp",
	".hpp":    "cpp",
	".sh":     "shell",
	".sql":    "sql",
	".proto":  "protobuf",
	".txt":    "text",
	".xml":    "xml",
	".docker": "docker",
}

func languageOf(p string) string {
	ext := strings.ToLower(filepath.Ext(p))
	if lang, ok := languages[ext]; ok {
		return lang
	}
	base := strings.ToLower(filepath.Base(p))
	switch base {
	case "dockerfile":
		return "docker"
	case "makefile":
		return "makefile"
	}
	if ext == "" {
		return "text"
	}
	return strings.TrimPrefix(ext, ".")
}
