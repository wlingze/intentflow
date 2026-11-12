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

	"github.com/wlingze/intentflow/internal/contract"
)

// 单文件与整包上限。超过上限的文件只保留状态，不带正文，
// 避免一次 review 把几十 MB 的 vendor 目录塞进浏览器。
const (
	MaxFileBytes  = 2 * 1024 * 1024
	MaxTotalBytes = 24 * 1024 * 1024
)

// Build 读取 before/after 两个目录，返回按路径排序的合并源码包。
// renames 是 Git 给出的旧路径 → 新路径；没有 Git 信息时（目录比较、
// 未跟踪文件）仍按内容完全一致配对，把「删除 + 新增」合成一张卡片。
func Build(beforeRoot, afterRoot, label string, renames map[string]string) (contract.CodeBundle, error) {
	before, err := readTree(beforeRoot)
	if err != nil {
		return contract.CodeBundle{}, err
	}
	after, err := readTree(afterRoot)
	if err != nil {
		return contract.CodeBundle{}, err
	}

	merged := mergeEntries(before, after, renames)
	entries := make([]deltaEntry, 0, len(merged))
	for _, entry := range merged {
		// 工作台只读改动文件；未变文件不进入 payload。
		if entry.oldPath == "" && entry.hasBefore && entry.hasAfter && entry.before == entry.after {
			continue
		}
		entries = append(entries, entry)
	}
	sizes := make([]int, len(entries))
	for i := range entries {
		sizes[i] = len(entries[i].before) + len(entries[i].after)
	}
	keep := allocate(sizes, MaxTotalBytes)

	bundle := contract.CodeBundle{Root: label, Files: make([]contract.CodeFile, 0, len(entries)), Skipped: []string{}}
	for i, e := range entries {
		status := statusOf(e.before, e.hasBefore, e.after, e.hasAfter)
		if e.oldPath != "" {
			status = contract.CodeStatusRenamed
		}
		file := contract.CodeFile{
			Path:     e.path,
			Status:   status,
			Language: languageOf(e.path),
		}
		if e.oldPath != "" {
			old := e.oldPath
			file.OldPath = &old
		}
		if !keep[i] {
			bundle.Truncated = true
			bundle.Skipped = append(bundle.Skipped, e.path)
		} else {
			if e.hasBefore {
				file.Before = e.before
			}
			if e.hasAfter {
				file.After = e.after
			}
		}
		bundle.Files = append(bundle.Files, file)
	}
	return bundle, nil
}

type deltaEntry struct {
	path                string
	oldPath             string
	before, after       string
	hasBefore, hasAfter bool
}

// mergeEntries 先合并 Git 重命名，再按内容完全一致兜底配对，
// 剩下的路径按普通新增/删除/修改输出。结果按新路径排序。
func mergeEntries(before, after map[string]string, renames map[string]string) []deltaEntry {
	usedBefore := map[string]bool{}
	usedAfter := map[string]bool{}
	entries := make([]deltaEntry, 0, len(before)+len(after))

	// 1. Git 明确给出的重命名对。
	oldPaths := make([]string, 0, len(renames))
	for old := range renames {
		oldPaths = append(oldPaths, old)
	}
	sort.Strings(oldPaths)
	for _, old := range oldPaths {
		newPath := renames[old]
		b, bOK := before[old]
		a, aOK := after[newPath]
		if !bOK || !aOK || usedBefore[old] || usedAfter[newPath] {
			continue
		}
		entries = append(entries, deltaEntry{path: newPath, oldPath: old, before: b, after: a, hasBefore: true, hasAfter: true})
		usedBefore[old] = true
		usedAfter[newPath] = true
	}

	// 2. 内容完全一致时自己配对，覆盖目录比较与未跟踪文件。
	added := make([]string, 0)
	for path := range after {
		if _, ok := before[path]; !ok && !usedAfter[path] {
			added = append(added, path)
		}
	}
	sort.Strings(added)
	byContent := make(map[string][]string, len(added))
	for _, path := range added {
		byContent[after[path]] = append(byContent[after[path]], path)
	}
	removed := make([]string, 0)
	for path := range before {
		if _, ok := after[path]; !ok && !usedBefore[path] {
			removed = append(removed, path)
		}
	}
	sort.Strings(removed)
	for _, old := range removed {
		content := before[old]
		if content == "" {
			continue
		}
		list := byContent[content]
		if len(list) == 0 {
			continue
		}
		newPath := list[0]
		byContent[content] = list[1:]
		entries = append(entries, deltaEntry{path: newPath, oldPath: old, before: content, after: after[newPath], hasBefore: true, hasAfter: true})
		usedBefore[old] = true
		usedAfter[newPath] = true
	}

	// 3. 其余路径按普通增删改输出。
	paths := make([]string, 0, len(before)+len(after))
	for path := range before {
		paths = append(paths, path)
	}
	for path := range after {
		if _, ok := before[path]; !ok {
			paths = append(paths, path)
		}
	}
	sort.Strings(paths)
	for _, path := range paths {
		if usedBefore[path] || usedAfter[path] {
			continue
		}
		b, bOK := before[path]
		a, aOK := after[path]
		entries = append(entries, deltaEntry{path: path, before: b, after: a, hasBefore: bOK, hasAfter: aOK})
	}

	sort.Slice(entries, func(i, j int) bool { return entries[i].path < entries[j].path })
	return entries
}

// allocate 按体积从小到大分配正文预算。目录顺序下，大文件在前会吃掉
// 预算，让后面所有小文件都变成空卡片。
func allocate(sizes []int, max int) []bool {
	order := make([]int, len(sizes))
	for i := range sizes {
		order[i] = i
	}
	sort.SliceStable(order, func(left, right int) bool {
		return sizes[order[left]] < sizes[order[right]]
	})
	keep := make([]bool, len(sizes))
	total := 0
	for _, i := range order {
		if total+sizes[i] > max {
			continue
		}
		keep[i] = true
		total += sizes[i]
	}
	return keep
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
