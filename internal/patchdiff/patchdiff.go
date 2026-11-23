// Package patchdiff reads a unified diff without touching the filesystem.
//
// The workbench needs full before/after text to compute line numbers. A patch
// only carries hunk context, so missing unchanged lines become empty padding:
// the changed lines keep their real 1-based positions and the UI collapses the
// unchanged gaps. `--diff` cannot recover text the patch never contained.
package patchdiff

import (
	"fmt"
	"path"
	"regexp"
	"strconv"
	"strings"

	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/payload"
)

// Meta describes facts taken from the patch headers.
//
// index lines contain blob hashes, not commit SHAs, so they are never exposed
// as revision base/head. A format-patch "From <sha>" header is a commit.
type Meta struct {
	Commit  string
	Skipped []string
}

// maxLine bounds a hunk header. A typo like +999999999 must fail, not allocate.
const maxLine = 1_000_000

var hunkHeader = regexp.MustCompile(`^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@`)

type hunk struct {
	oldStart, oldCount int
	newStart, newCount int
}

type fileBuilder struct {
	gitOld, gitNew      string
	headerOld, headerN  string
	hasOldHeader        bool
	hasNewHeader        bool
	newFile, deleted    bool
	renameOld, renameN  string
	binary              bool
	indexOld, indexNew  string
	before, after       map[int]string
	maxBefore, maxAfter int
	hunks               int
}

// Parse returns a code bundle plus the revision facts found in the headers.
func Parse(raw []byte) (contract.CodeBundle, Meta, error) {
	lines := splitLines(string(raw))
	var files []contract.CodeFile
	meta := Meta{}
	var current *fileBuilder
	finish := func() error {
		if current == nil {
			return nil
		}
		file, skipped, err := current.finish()
		if err != nil {
			return err
		}
		if skipped != "" {
			meta.Skipped = append(meta.Skipped, skipped)
		}
		if file != nil {
			files = append(files, *file)
		}
		current = nil
		return nil
	}
	for index := 0; index < len(lines); index++ {
		line := lines[index]
		if strings.HasPrefix(line, "diff --git ") {
			if err := finish(); err != nil {
				return contract.CodeBundle{}, Meta{}, err
			}
			current = newFileBuilder()
			current.gitOld, current.gitNew = parseDiffGit(strings.TrimPrefix(line, "diff --git "))
			continue
		}
		if current == nil {
			if meta.Commit == "" && strings.HasPrefix(line, "From ") {
				meta.Commit = formatPatchCommit(strings.TrimPrefix(line, "From "))
			}
			if !strings.HasPrefix(line, "--- ") {
				continue
			}
			current = newFileBuilder()
		}
		switch {
		case strings.HasPrefix(line, "--- "):
			current.headerOld = headerPath(strings.TrimPrefix(line, "--- "))
			current.hasOldHeader = true
		case strings.HasPrefix(line, "+++ "):
			current.headerN = headerPath(strings.TrimPrefix(line, "+++ "))
			current.hasNewHeader = true
		case strings.HasPrefix(line, "new file mode "):
			current.newFile = true
		case strings.HasPrefix(line, "deleted file mode "):
			current.deleted = true
		case strings.HasPrefix(line, "rename from "):
			current.renameOld = unquotePath(strings.TrimPrefix(line, "rename from "))
		case strings.HasPrefix(line, "rename to "):
			current.renameN = unquotePath(strings.TrimPrefix(line, "rename to "))
		case strings.HasPrefix(line, "copy from "):
			current.renameOld = unquotePath(strings.TrimPrefix(line, "copy from "))
		case strings.HasPrefix(line, "copy to "):
			current.renameN = unquotePath(strings.TrimPrefix(line, "copy to "))
		case strings.HasPrefix(line, "@@"):
			header, err := parseHunkHeader(line)
			if err != nil {
				return contract.CodeBundle{}, Meta{}, fmt.Errorf("补丁第 %d 行：%w", index+1, err)
			}
			next, err := current.consumeHunk(lines, index+1, header)
			if err != nil {
				return contract.CodeBundle{}, Meta{}, fmt.Errorf("补丁第 %d 行：%w", index+1, err)
			}
			index = next - 1
		case strings.HasPrefix(line, "GIT binary patch"), strings.HasPrefix(line, "Binary files "):
			current.binary = true
		}
	}
	if err := finish(); err != nil {
		return contract.CodeBundle{}, Meta{}, err
	}
	code := payload.Fit("patch", files)
	code.Skipped = appendUnique(code.Skipped, meta.Skipped...)
	return code, meta, nil
}

func newFileBuilder() *fileBuilder {
	return &fileBuilder{before: map[int]string{}, after: map[int]string{}}
}

func (f *fileBuilder) finish() (*contract.CodeFile, string, error) {
	oldPath, newPath := f.paths()
	if f.binary {
		return nil, firstNonEmpty(newPath, oldPath), nil
	}
	status := contract.CodeStatusModified
	switch {
	case f.newFile || (f.hasOldHeader && oldPath == ""):
		status = contract.CodeStatusAdded
	case f.deleted || (f.hasNewHeader && newPath == ""):
		status = contract.CodeStatusRemoved
	case f.renameN != "":
		status = contract.CodeStatusRenamed
	case f.hunks == 0:
		return nil, "", nil
	}
	if newPath == "" && oldPath == "" {
		return nil, "", nil
	}
	if newPath == "" {
		newPath = oldPath
	}
	file := contract.CodeFile{Path: newPath, Status: status}
	if status == contract.CodeStatusRenamed {
		file.OldPath = &oldPath
	}
	if status != contract.CodeStatusAdded {
		file.Before = render(f.before, f.maxBefore)
	}
	if status != contract.CodeStatusRemoved {
		file.After = render(f.after, f.maxAfter)
	}
	return &file, "", nil
}

func (f *fileBuilder) paths() (string, string) {
	oldPath, newPath := f.headerOld, f.headerN
	if f.renameN != "" {
		newPath = f.renameN
	}
	if f.renameOld != "" {
		oldPath = f.renameOld
	}
	prefixed := strings.HasPrefix(f.gitOld, "a/") && strings.HasPrefix(f.gitNew, "b/")
	if prefixed || (f.gitOld == "" && strings.HasPrefix(oldPath, "a/") && strings.HasPrefix(newPath, "b/")) {
		oldPath = strings.TrimPrefix(oldPath, "a/")
		newPath = strings.TrimPrefix(newPath, "b/")
	}
	if oldPath == "" && f.gitOld != "" {
		oldPath = f.gitOld
		if prefixed {
			oldPath = strings.TrimPrefix(oldPath, "a/")
		}
	}
	if newPath == "" && f.gitNew != "" {
		newPath = f.gitNew
		if prefixed {
			newPath = strings.TrimPrefix(newPath, "b/")
		}
	}
	if f.hasOldHeader && oldPath == "" {
		newPath = strings.TrimPrefix(newPath, "b/")
	}
	if f.hasNewHeader && newPath == "" {
		oldPath = strings.TrimPrefix(oldPath, "a/")
	}
	return cleanPatchPath(oldPath), cleanPatchPath(newPath)
}

func (f *fileBuilder) consumeHunk(lines []string, start int, h hunk) (int, error) {
	// Keep the real line numbers even when the hunk has no context line at
	// its start: everything before oldStart/newStart is unchanged padding.
	if h.oldStart > 1 && f.maxBefore < h.oldStart-1 {
		f.maxBefore = h.oldStart - 1
	}
	if h.newStart > 1 && f.maxAfter < h.newStart-1 {
		f.maxAfter = h.newStart - 1
	}
	oldNo, newNo := h.oldStart, h.newStart
	oldRead, newRead := 0, 0
	index := start
	for index < len(lines) && (oldRead < h.oldCount || newRead < h.newCount) {
		line := lines[index]
		if strings.HasPrefix(line, `\`) {
			index++
			continue
		}
		prefix, content := byte(' '), ""
		if line != "" {
			prefix = line[0]
			content = line[1:]
		}
		switch prefix {
		case ' ':
			if oldNo < 1 || newNo < 1 || oldNo > maxLine || newNo > maxLine {
				return index, fmt.Errorf("行号超出范围")
			}
			f.before[oldNo], f.after[newNo] = content, content
			oldNo++
			newNo++
			oldRead++
			newRead++
		case '-':
			if oldNo < 1 || oldNo > maxLine {
				return index, fmt.Errorf("行号超出范围")
			}
			f.before[oldNo] = content
			oldNo++
			oldRead++
		case '+':
			if newNo < 1 || newNo > maxLine {
				return index, fmt.Errorf("行号超出范围")
			}
			f.after[newNo] = content
			newNo++
			newRead++
		default:
			return index, fmt.Errorf("hunk 内出现无法识别的行 %q", line)
		}
		if oldNo-1 > f.maxBefore {
			f.maxBefore = oldNo - 1
		}
		if newNo-1 > f.maxAfter {
			f.maxAfter = newNo - 1
		}
		index++
	}
	if oldRead != h.oldCount || newRead != h.newCount {
		return index, fmt.Errorf("hunk 行数不符：声明 -%d,+%d，读到 -%d,+%d", h.oldCount, h.newCount, oldRead, newRead)
	}
	f.hunks++
	return index, nil
}

func parseHunkHeader(line string) (hunk, error) {
	match := hunkHeader.FindStringSubmatch(line)
	if match == nil {
		return hunk{}, fmt.Errorf("无法解析 hunk 头 %q", line)
	}
	number := func(text string, fallback int) (int, error) {
		if text == "" {
			return fallback, nil
		}
		value, err := strconv.Atoi(text)
		if err != nil || value > maxLine {
			return 0, fmt.Errorf("hunk 行号 %q 无效", text)
		}
		return value, nil
	}
	oldStart, err := number(match[1], 0)
	if err != nil {
		return hunk{}, err
	}
	newStart, err := number(match[3], 0)
	if err != nil {
		return hunk{}, err
	}
	oldCount, err := number(match[2], 1)
	if err != nil {
		return hunk{}, err
	}
	newCount, err := number(match[4], 1)
	if err != nil {
		return hunk{}, err
	}
	return hunk{oldStart: oldStart, oldCount: oldCount, newStart: newStart, newCount: newCount}, nil
}

func render(lines map[int]string, max int) string {
	if max <= 0 {
		return ""
	}
	out := make([]string, max)
	for index := 1; index <= max; index++ {
		out[index-1] = lines[index]
	}
	return strings.Join(out, "\n")
}

func parseDiffGit(rest string) (string, string) {
	first, rest := nextPathToken(rest)
	second, _ := nextPathToken(rest)
	return first, second
}

func nextPathToken(text string) (string, string) {
	text = strings.TrimLeft(text, " ")
	if strings.HasPrefix(text, `"`) {
		end := 1
		for end < len(text) {
			if text[end] == '\\' {
				end += 2
				continue
			}
			if text[end] == '"' {
				end++
				break
			}
			end++
		}
		return unquotePath(text[:end]), strings.TrimLeft(text[end:], " ")
	}
	if index := strings.IndexByte(text, ' '); index >= 0 {
		return text[:index], strings.TrimLeft(text[index:], " ")
	}
	return text, ""
}

func headerPath(rest string) string {
	value := unquotePath(rest)
	if value == "/dev/null" {
		return ""
	}
	return value
}

func unquotePath(rest string) string {
	rest = strings.TrimSpace(rest)
	if rest == "" {
		return ""
	}
	if rest[0] == '"' {
		end := 1
		for end < len(rest) {
			if rest[end] == '\\' {
				end += 2
				continue
			}
			if rest[end] == '"' {
				end++
				break
			}
			end++
		}
		if value, err := strconv.Unquote(rest[:end]); err == nil {
			return value
		}
		return strings.Trim(rest[:end], `"`)
	}
	if index := strings.IndexByte(rest, '\t'); index >= 0 {
		rest = rest[:index]
	}
	return strings.TrimSpace(rest)
}

func cleanPatchPath(value string) string {
	if value == "" || value == "/dev/null" {
		return ""
	}
	value = strings.ReplaceAll(value, "\\", "/")
	value = path.Clean(value)
	value = strings.TrimPrefix(value, "./")
	if value == "." {
		return ""
	}
	return value
}

func splitLines(raw string) []string {
	raw = strings.ReplaceAll(raw, "\r\n", "\n")
	lines := strings.Split(raw, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	return lines
}

func formatPatchCommit(rest string) string {
	if index := strings.IndexByte(rest, ' '); index >= 0 {
		rest = rest[:index]
	}
	if validSHA(rest) {
		return rest
	}
	return ""
}

func validSHA(value string) bool {
	if len(value) < 4 || len(value) > 64 {
		return false
	}
	nonZero := false
	for _, char := range value {
		switch {
		case char >= '0' && char <= '9':
		case char >= 'a' && char <= 'f':
		case char >= 'A' && char <= 'F':
		default:
			return false
		}
		if char != '0' {
			nonZero = true
		}
	}
	return nonZero
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func appendUnique(base []string, extra ...string) []string {
	seen := map[string]bool{}
	for _, value := range base {
		seen[value] = true
	}
	for _, value := range extra {
		if value != "" && !seen[value] {
			seen[value] = true
			base = append(base, value)
		}
	}
	return base
}
