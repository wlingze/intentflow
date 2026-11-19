// Package patch parses unified diffs into before/after text.
//
// A patch does not carry the whole file: it carries hunks with a few context
// lines. The reconstructed text keeps every hunk at its original line number
// and fills the rest with empty lines. The workbench collapses unchanged
// intervals, so the visible hunks and their line numbers stay correct; an
// expanded gap shows empty placeholder lines instead of the missing source.
//
// GitHub's .patch endpoint returns one diff per commit. Parse merges those
// diffs per path: the first hunk supplies the old side, later hunks patch the
// running new side. A file added and then edited in the same PR therefore
// remains one added file in the final view.
package patch

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Status mirrors the code status carried by the payload contract.
type Status string

const (
	Added     Status = "added"
	Removed   Status = "removed"
	Modified  Status = "modified"
	Renamed   Status = "renamed"
	Unchanged Status = "unchanged"
)

// Line is one body line in a hunk. Kind is ' ', '-' or '+'.
type Line struct {
	Kind byte
	Text string
}

// Hunk is one unified diff hunk. Starts are 1-based, as written in the patch.
// OldStart or NewStart is 0 for a wholly added or deleted file.
type Hunk struct {
	OldStart int
	OldLines int
	NewStart int
	NewLines int
	Section  string
	Lines    []Line
}

// File is one file change after merging a whole patch (or a commit series).
type File struct {
	Path    string
	OldPath string
	Status  Status
	Binary  bool
	Hunks   []Hunk
	Before  string
	After   string
}

// Patch is a parsed patch. Subjects holds the Subject: lines of a mailbox
// style .patch, in order; they are useful as labels but never required.
type Patch struct {
	Files    []File
	Subjects []string
}

// ErrEmpty reports a patch that contains no diff.
var ErrEmpty = errors.New("补丁里没有 diff")

// Parse accepts unified diffs with or without diff --git headers. Preamble
// from git format-patch is ignored.
func Parse(data []byte) (*Patch, error) {
	text := strings.ReplaceAll(string(data), "\r\n", "\n")
	if strings.TrimSpace(text) == "" {
		return nil, ErrEmpty
	}
	p := &parser{raw: []File{}}
	lines := strings.Split(text, "\n")
	if len(lines) > 0 && lines[len(lines)-1] == "" {
		lines = lines[:len(lines)-1]
	}
	if err := p.run(lines); err != nil {
		return nil, err
	}
	if len(p.raw) == 0 {
		return nil, ErrEmpty
	}
	files, err := merge(p.raw)
	if err != nil {
		return nil, err
	}
	return &Patch{Files: files, Subjects: p.subjects}, nil
}

type fileBuilder struct {
	oldPath, newPath string
	oldNull, newNull bool
	newFile          bool
	deletedFile      bool
	renamed          bool
	binary           bool
	gitHeader        bool
	hunks            []Hunk
}

type parser struct {
	raw      []File
	current  *fileBuilder
	hunk     *Hunk
	oldLeft  int
	newLeft  int
	subjects []string
}

func (p *parser) run(lines []string) error {
	for index := 0; index < len(lines); index++ {
		line := lines[index]
		if p.hunk != nil && (p.oldLeft > 0 || p.newLeft > 0) {
			if err := p.hunkLine(line); err != nil {
				return fmt.Errorf("第 %d 行: %w", index+1, err)
			}
			continue
		}
		// A commit message may contain a line like "--- note". Only accept
		// "--- <path>" before a diff when "+++ <path>" follows.
		if p.current == nil && strings.HasPrefix(line, "--- ") {
			next := ""
			if index+1 < len(lines) {
				next = lines[index+1]
			}
			if !strings.HasPrefix(next, "+++ ") {
				continue
			}
		}
		if err := p.headerLine(line); err != nil {
			return fmt.Errorf("第 %d 行: %w", index+1, err)
		}
	}
	if p.hunk != nil {
		return errors.New("补丁在 hunk 中间结束")
	}
	if err := p.finishFile(); err != nil {
		return err
	}
	return nil
}

func (p *parser) hunkLine(line string) error {
	if line == `\ No newline at end of file` {
		return nil
	}
	kind := byte(' ')
	text := ""
	if line != "" {
		kind = line[0]
		text = line[1:]
	}
	switch kind {
	case ' ':
		if p.oldLeft == 0 || p.newLeft == 0 {
			return errors.New("hunk 含有超出声明行数的上下文行")
		}
		p.hunk.Lines = append(p.hunk.Lines, Line{Kind: ' ', Text: text})
		p.oldLeft--
		p.newLeft--
	case '-':
		if p.oldLeft == 0 {
			return errors.New("hunk 含有超出声明行数的删除行")
		}
		p.hunk.Lines = append(p.hunk.Lines, Line{Kind: '-', Text: text})
		p.oldLeft--
	case '+':
		if p.newLeft == 0 {
			return errors.New("hunk 含有超出声明行数的添加行")
		}
		p.hunk.Lines = append(p.hunk.Lines, Line{Kind: '+', Text: text})
		p.newLeft--
	default:
		return fmt.Errorf("hunk 中出现无法识别的行 %q", line)
	}
	if p.oldLeft == 0 && p.newLeft == 0 {
		p.hunk = nil
	}
	return nil
}

func (p *parser) headerLine(line string) error {
	trimmed := strings.TrimSpace(line)
	switch {
	case strings.HasPrefix(trimmed, "Subject:"):
		subject := strings.TrimSpace(strings.TrimPrefix(trimmed, "Subject:"))
		// git format-patch writes "[PATCH 1/4] title"; keep only the title.
		if index := strings.Index(subject, "]"); strings.HasPrefix(subject, "[PATCH") && index >= 0 {
			subject = strings.TrimSpace(subject[index+1:])
		}
		if subject != "" {
			p.subjects = append(p.subjects, subject)
		}
	case strings.HasPrefix(line, "diff --git "):
		if err := p.finishFile(); err != nil {
			return err
		}
		oldPath, newPath, ok := splitGitHeader(strings.TrimPrefix(line, "diff --git "))
		if !ok {
			return fmt.Errorf("无法解析 diff --git 路径: %s", line)
		}
		p.current = &fileBuilder{oldPath: oldPath, newPath: newPath, gitHeader: true}
	case strings.HasPrefix(line, "--- "):
		if p.current == nil || (!p.current.gitHeader && (p.current.oldPath != "" || p.current.newPath != "" || len(p.current.hunks) > 0)) {
			if err := p.finishFile(); err != nil {
				return err
			}
			p.current = &fileBuilder{}
		}
		p.current.oldPath, p.current.oldNull = headerPath(strings.TrimPrefix(line, "--- "))
	case strings.HasPrefix(line, "+++ "):
		if p.current == nil {
			p.current = &fileBuilder{}
		}
		p.current.newPath, p.current.newNull = headerPath(strings.TrimPrefix(line, "+++ "))
	case strings.HasPrefix(line, "@@ "):
		if p.current == nil {
			return errors.New("hunk 前面没有文件头")
		}
		hunk, err := parseHunkHeader(line)
		if err != nil {
			return err
		}
		p.current.hunks = append(p.current.hunks, hunk)
		p.hunk = &p.current.hunks[len(p.current.hunks)-1]
		p.oldLeft, p.newLeft = hunk.OldLines, hunk.NewLines
		if hunk.OldLines == 0 && hunk.NewLines == 0 {
			p.hunk = nil
		}
	case strings.HasPrefix(line, "new file mode "), line == "new file mode":
		p.ensureCurrent().newFile = true
	case strings.HasPrefix(line, "deleted file mode "), line == "deleted file mode":
		p.ensureCurrent().deletedFile = true
	case strings.HasPrefix(line, "rename from "):
		p.ensureCurrent().renamed = true
		p.current.oldPath = strings.TrimSpace(strings.TrimPrefix(line, "rename from "))
	case strings.HasPrefix(line, "rename to "):
		p.ensureCurrent().renamed = true
		p.current.newPath = strings.TrimSpace(strings.TrimPrefix(line, "rename to "))
	case strings.HasPrefix(line, "Binary files "), strings.HasPrefix(line, "GIT binary patch"):
		p.ensureCurrent().binary = true
	case strings.HasPrefix(line, "index "),
		strings.HasPrefix(line, "old mode "),
		strings.HasPrefix(line, "new mode "),
		strings.HasPrefix(line, "similarity index "),
		strings.HasPrefix(line, "dissimilarity index "),
		strings.HasPrefix(line, "From "),
		strings.HasPrefix(line, "From:"),
		strings.HasPrefix(line, "Date:"),
		strings.HasPrefix(line, "MIME-Version:"),
		strings.HasPrefix(line, "Content-Type:"),
		strings.HasPrefix(line, "Content-Transfer-Encoding:"),
		line == "---":
		return nil
	}
	return nil
}

func (p *parser) ensureCurrent() *fileBuilder {
	if p.current == nil {
		p.current = &fileBuilder{}
	}
	return p.current
}

func (p *parser) finishFile() error {
	if p.current == nil {
		return nil
	}
	builder := p.current
	p.current = nil
	p.hunk = nil
	p.oldLeft, p.newLeft = 0, 0
	file, ok, err := builder.file()
	if err != nil {
		return err
	}
	if ok {
		p.raw = append(p.raw, file)
	}
	return nil
}

func (b *fileBuilder) file() (File, bool, error) {
	status := Modified
	switch {
	case b.deletedFile || b.newNull || (b.newPath == "" && b.oldPath != ""):
		status = Removed
	case b.newFile || b.oldNull || (b.oldPath == "" && b.newPath != ""):
		status = Added
	case b.renamed || (b.oldPath != "" && b.newPath != "" && b.oldPath != b.newPath):
		status = Renamed
	}
	path := b.newPath
	if path == "" {
		path = b.oldPath
	}
	if path == "" || isNullPath(path) {
		return File{}, false, nil
	}
	file := File{Path: path, Status: status, Binary: b.binary, Hunks: b.hunks}
	if status == Renamed && b.oldPath != "" && b.oldPath != path {
		file.OldPath = b.oldPath
	}
	if !b.binary {
		before, after, err := reconstruct(b.hunks)
		if err != nil {
			return file, true, err
		}
		file.Before, file.After = before, after
	}
	if status == Added {
		file.Before = ""
	}
	if status == Removed {
		file.After = ""
	}
	return file, true, nil
}

// reconstruct lays each hunk at its absolute line number. Missing unchanged
// lines become empty placeholders so later hunks keep their real line numbers.
func reconstruct(hunks []Hunk) (before, after string, err error) {
	oldLines := []string{}
	newLines := []string{}
	for _, hunk := range hunks {
		if err := validateHunk(hunk); err != nil {
			return "", "", err
		}
		if hunk.OldStart > 0 {
			for len(oldLines) < hunk.OldStart-1 {
				oldLines = append(oldLines, "")
			}
		}
		if hunk.NewStart > 0 {
			for len(newLines) < hunk.NewStart-1 {
				newLines = append(newLines, "")
			}
		}
		for _, line := range hunk.Lines {
			switch line.Kind {
			case ' ':
				oldLines = append(oldLines, line.Text)
				newLines = append(newLines, line.Text)
			case '-':
				oldLines = append(oldLines, line.Text)
			case '+':
				newLines = append(newLines, line.Text)
			}
		}
	}
	return strings.Join(oldLines, "\n"), strings.Join(newLines, "\n"), nil
}

func validateHunk(hunk Hunk) error {
	oldCount, newCount := 0, 0
	for _, line := range hunk.Lines {
		switch line.Kind {
		case ' ':
			oldCount++
			newCount++
		case '-':
			oldCount++
		case '+':
			newCount++
		default:
			return fmt.Errorf("hunk 含未知行类型 %q", line.Kind)
		}
	}
	if oldCount != hunk.OldLines || newCount != hunk.NewLines {
		return fmt.Errorf("hunk @@ -%d,%d +%d,%d @@ 声明行数与内容不一致", hunk.OldStart, hunk.OldLines, hunk.NewStart, hunk.NewLines)
	}
	return nil
}

func parseHunkHeader(line string) (Hunk, error) {
	rest := strings.TrimPrefix(line, "@@ ")
	end := strings.Index(rest, " @@")
	if end < 0 {
		return Hunk{}, fmt.Errorf("无法解析 hunk 头: %s", line)
	}
	header := rest[:end]
	section := strings.TrimSpace(rest[end+3:])
	fields := strings.Fields(header)
	if len(fields) != 2 {
		return Hunk{}, fmt.Errorf("无法解析 hunk 头: %s", line)
	}
	oldStart, oldLines, ok := parseRange(fields[0], '-')
	if !ok {
		return Hunk{}, fmt.Errorf("无法解析旧文件范围: %s", fields[0])
	}
	newStart, newLines, ok := parseRange(fields[1], '+')
	if !ok {
		return Hunk{}, fmt.Errorf("无法解析新文件范围: %s", fields[1])
	}
	return Hunk{OldStart: oldStart, OldLines: oldLines, NewStart: newStart, NewLines: newLines, Section: section}, nil
}

func parseRange(field string, sign byte) (int, int, bool) {
	if len(field) < 2 || field[0] != sign {
		return 0, 0, false
	}
	body := field[1:]
	count := 1
	if index := strings.IndexByte(body, ','); index >= 0 {
		value, err := strconv.Atoi(body[index+1:])
		if err != nil || value < 0 {
			return 0, 0, false
		}
		count = value
		body = body[:index]
	}
	start, err := strconv.Atoi(body)
	if err != nil || start < 0 {
		return 0, 0, false
	}
	return start, count, true
}

func splitGitHeader(rest string) (string, string, bool) {
	first, rest, ok := takeToken(rest)
	if !ok {
		return "", "", false
	}
	second, _, ok := takeToken(rest)
	if !ok {
		return "", "", false
	}
	return stripPrefix(first), stripPrefix(second), true
}

func takeToken(s string) (string, string, bool) {
	s = strings.TrimLeft(s, " ")
	if s == "" {
		return "", "", false
	}
	if s[0] == '"' {
		escaped := false
		for index := 1; index < len(s); index++ {
			if escaped {
				escaped = false
				continue
			}
			switch s[index] {
			case '\\':
				escaped = true
			case '"':
				decoded, err := strconv.Unquote(s[:index+1])
				if err != nil {
					return "", "", false
				}
				return decoded, s[index+1:], true
			}
		}
		return "", "", false
	}
	index := strings.IndexByte(s, ' ')
	if index < 0 {
		return s, "", true
	}
	return s[:index], s[index+1:], true
}

func headerPath(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if strings.HasPrefix(raw, `"`) {
		if decoded, _, ok := takeToken(raw); ok {
			raw = decoded
		}
	} else if index := strings.IndexByte(raw, '\t'); index >= 0 {
		raw = raw[:index]
	}
	if isNullPath(raw) {
		return "", true
	}
	return stripPrefix(raw), false
}

func stripPrefix(path string) string {
	if isNullPath(path) {
		return ""
	}
	if strings.HasPrefix(path, "a/") || strings.HasPrefix(path, "b/") {
		return path[2:]
	}
	return path
}

func isNullPath(path string) bool {
	return path == "/dev/null" || path == "dev/null"
}

// merge combines per-commit diffs. Later diffs are applied to the running new
// side, so a PR that adds a file and edits it later stays one added file.
func merge(raw []File) ([]File, error) {
	byPath := map[string]*File{}
	for _, file := range raw {
		key := file.Path
		var state *File
		if file.Status != Added {
			state = byPath[file.OldPath]
		}
		if state == nil {
			state = byPath[key]
		}
		if state == nil {
			copy := file
			byPath[key] = &copy
			continue
		}
		// A file deleted and re-added in the same series starts over.
		if file.Status == Added && state.Status == Removed {
			copy := file
			state = &copy
			byPath[key] = state
			continue
		}
		next, err := Apply(state.After, file.Hunks)
		if err != nil {
			return nil, fmt.Errorf("%s: %w", file.Path, err)
		}
		state.After = next
		if file.Status == Renamed && state.Status != Added && state.Status != Removed {
			state.OldPath = file.OldPath
			state.Status = Renamed
		}
		if file.Status == Removed {
			state.Status = Removed
			state.After = ""
		}
		if state.Path != file.Path {
			delete(byPath, state.Path)
			state.Path = file.Path
			byPath[state.Path] = state
		}
	}
	files := make([]File, 0, len(byPath))
	for _, file := range byPath {
		if file.Status == Added {
			file.Before = ""
		}
		if file.Status == Removed {
			file.After = ""
		}
		files = append(files, *file)
	}
	sort.Slice(files, func(i, j int) bool { return files[i].Path < files[j].Path })
	return files, nil
}

// Apply replaces the old ranges of base with the new side of each hunk.
// base may be a partial reconstruction: missing lines are padded with empty
// placeholders so hunk line numbers keep their absolute positions.
func Apply(base string, hunks []Hunk) (string, error) {
	lines := splitLines(base)
	offset := 0
	for _, hunk := range hunks {
		if err := validateHunk(hunk); err != nil {
			return "", err
		}
		start := hunk.OldStart - 1 + offset
		if hunk.OldStart == 0 {
			start = offset
		}
		if start < 0 {
			start = 0
		}
		for len(lines) < start {
			lines = append(lines, "")
		}
		end := start + hunk.OldLines
		for len(lines) < end {
			lines = append(lines, "")
		}
		block := make([]string, 0, hunk.NewLines)
		for _, line := range hunk.Lines {
			if line.Kind == ' ' || line.Kind == '+' {
				block = append(block, line.Text)
			}
		}
		next := make([]string, 0, len(lines)-(end-start)+len(block))
		next = append(next, lines[:start]...)
		next = append(next, block...)
		next = append(next, lines[end:]...)
		lines = next
		offset += hunk.NewLines - hunk.OldLines
	}
	return strings.Join(lines, "\n"), nil
}

func splitLines(text string) []string {
	if text == "" {
		return []string{}
	}
	return strings.Split(text, "\n")
}
