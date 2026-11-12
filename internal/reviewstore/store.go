// Package reviewstore stores local PR reviews as versioned JSON files.
package reviewstore

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/yaklang/intentflow/internal/contract"
)

var ErrMismatch = errors.New("评审记录与当前仓库、分支或比较范围不匹配")

var (
	assetNamePattern = regexp.MustCompile(`^[a-f0-9]{64}\.(?:png|jpe?g|gif|webp)$`)
	assetContentType = map[string]string{
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp",
	}
)

type Store struct {
	Dir string
	mu  sync.Mutex
}

func New(dir string) (*Store, error) {
	if dir == "" {
		dir = ".intentflow"
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return nil, err
	}
	return &Store{Dir: abs}, nil
}

func digest(v any) string {
	raw, _ := json.Marshal(v)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}

// A branch is one local PR. Comparisons inside it retain separate line anchors.
func NewContext(repository, branch, base, head, revision, subdir string, code contract.CodeBundle) contract.ReviewContext {
	ctx := contract.ReviewContext{
		Repository: repository, Branch: branch, Base: base, Head: head,
		Revision: revision, Subdir: subdir, DiffDigest: digest(code.Files),
		SessionId: digest([]string{repository, branch, subdir})[:24],
	}
	ctx.ComparisonId = digest(ctx)[:24]
	return ctx
}

func Empty(ctx contract.ReviewContext) contract.ReviewSession {
	return contract.ReviewSession{
		Version: 1, Context: ctx, Comments: []contract.Comment{}, Viewed: []string{}, ReviewedHunks: []string{},
	}
}

func quoteInRange(quote *contract.Quote, files map[string]contract.CodeFile) bool {
	if quote == nil {
		return true
	}
	file, ok := files[quote.File]
	if !ok || quote.Start < 1 || quote.End < quote.Start {
		return false
	}
	var source string
	switch quote.Side {
	case contract.Before:
		source = file.Before
	case contract.After:
		source = file.After
	default:
		return false
	}
	return source != "" && int(quote.End) <= len(strings.Split(source, "\n"))
}

func (s *Store) Path(ctx contract.ReviewContext) string {
	// Hash again rather than trusting imported ids as filesystem paths.
	return filepath.Join(s.Dir, "sessions", digest(ctx.SessionId)[:24], digest(ctx.ComparisonId)[:24]+".json")
}

func Validate(doc contract.ReviewSession, expected contract.ReviewContext, files []contract.CodeFile) error {
	if doc.Version != 1 {
		return fmt.Errorf("不支持的评审 JSON 版本 %d", doc.Version)
	}
	if doc.Context != expected {
		return ErrMismatch
	}
	if doc.Comments == nil || doc.Viewed == nil {
		return errors.New("comments 和 viewed 必须是数组")
	}
	paths := make(map[string]contract.CodeFile, len(files))
	for _, file := range files {
		paths[file.Path] = file
	}
	seen := map[string]bool{}
	for _, comment := range doc.Comments {
		if comment.Id == "" || seen[comment.Id] || strings.TrimSpace(comment.Text) == "" {
			return errors.New("评论需要唯一 id 和非空正文")
		}
		seen[comment.Id] = true
		for _, image := range comment.Images {
			if !assetNamePattern.MatchString(image) {
				return fmt.Errorf("评论图片名无效: %s", image)
			}
		}
		if !quoteInRange(comment.Quote, paths) {
			return fmt.Errorf("评论位置不在当前 diff: %s", comment.Quote.File)
		}
	}
	for _, entry := range doc.Viewed {
		path, _, _ := strings.Cut(entry, "#")
		if _, ok := paths[path]; !ok {
			return fmt.Errorf("已查看文件不属于当前 diff: %s", entry)
		}
	}
	for _, key := range doc.ReviewedHunks {
		body, _, _ := strings.Cut(key, "#")
		path, _, ok := strings.Cut(body, "@")
		if !ok {
			return fmt.Errorf("已查看位置格式应为 <file>@<row>#<digest>: %s", key)
		}
		if _, ok := paths[path]; !ok {
			return fmt.Errorf("已查看位置不属于当前 diff: %s", key)
		}
	}
	return nil
}

func (s *Store) Load(ctx contract.ReviewContext, files []contract.CodeFile) (contract.ReviewSession, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	raw, err := os.ReadFile(s.Path(ctx))
	if errors.Is(err, os.ErrNotExist) {
		return Empty(ctx), nil
	}
	if err != nil {
		return contract.ReviewSession{}, err
	}
	var doc contract.ReviewSession
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, fmt.Errorf("评审 JSON 无法读取（原文件已保留）: %w", err)
	}
	if err := Validate(doc, ctx, files); err != nil {
		return doc, err
	}
	for index := range doc.Comments {
		if doc.Comments[index].Images == nil {
			doc.Comments[index].Images = []string{}
		}
	}
	if doc.ReviewedHunks == nil {
		doc.ReviewedHunks = []string{}
	}
	return doc, nil
}

func (s *Store) Save(doc contract.ReviewSession, expected contract.ReviewContext, files []contract.CodeFile) (contract.ReviewSession, error) {
	if err := Validate(doc, expected, files); err != nil {
		return doc, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if doc.Comments == nil {
		doc.Comments = []contract.Comment{}
	}
	if doc.Viewed == nil {
		doc.Viewed = []string{}
	}
	if doc.ReviewedHunks == nil {
		doc.ReviewedHunks = []string{}
	}
	for index := range doc.Comments {
		if doc.Comments[index].Images == nil {
			doc.Comments[index].Images = []string{}
		}
	}
	doc.UpdatedAt = time.Now().UTC().Format(time.RFC3339Nano)
	raw, err := json.MarshalIndent(doc, "", "  ")
	if err != nil {
		return doc, err
	}
	target := s.Path(expected)
	dir := filepath.Dir(target)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return doc, err
	}
	tmp, err := os.CreateTemp(dir, ".review-*.json")
	if err != nil {
		return doc, err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(append(raw, '\n')); err != nil {
		tmp.Close()
		return doc, err
	}
	if err := tmp.Close(); err != nil {
		return doc, err
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		return doc, err
	}
	return doc, nil
}

func (s *Store) sessionDir(ctx contract.ReviewContext) string {
	return filepath.Join(s.Dir, "sessions", digest(ctx.SessionId)[:24])
}

// ListDrafts returns every saved comparison draft for the branch session.
func (s *Store) ListDrafts(ctx contract.ReviewContext) ([]contract.ReviewDraft, error) {
	dir := s.sessionDir(ctx)
	entries, err := os.ReadDir(dir)
	if errors.Is(err, os.ErrNotExist) {
		return []contract.ReviewDraft{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := []contract.ReviewDraft{}
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			continue
		}
		var doc contract.ReviewSession
		if json.Unmarshal(raw, &doc) != nil || doc.Context.SessionId != ctx.SessionId || len(doc.Comments) == 0 {
			continue
		}
		out = append(out, contract.ReviewDraft{
			ComparisonId: doc.Context.ComparisonId, Revision: doc.Context.Revision,
			Base: doc.Context.Base, Head: doc.Context.Head, UpdatedAt: doc.UpdatedAt,
			Comments: len(doc.Comments),
		})
	}
	sort.Slice(out, func(left, right int) bool { return out[left].UpdatedAt > out[right].UpdatedAt })
	return out, nil
}

// RestoreDraft copies another comparison's draft into the current comparison.
// With relax, comments whose line anchors no longer exist become general comments.
func (s *Store) RestoreDraft(ctx contract.ReviewContext, files []contract.CodeFile, comparisonID string, relax bool) (contract.ReviewSession, int, error) {
	path := filepath.Join(s.sessionDir(ctx), digest(comparisonID)[:24]+".json")
	raw, err := os.ReadFile(path)
	if err != nil {
		return contract.ReviewSession{}, 0, fmt.Errorf("找不到草稿 %s: %w", comparisonID, err)
	}
	var doc contract.ReviewSession
	if err := json.Unmarshal(raw, &doc); err != nil {
		return doc, 0, fmt.Errorf("草稿无法读取: %w", err)
	}
	if doc.Context.SessionId != ctx.SessionId {
		return doc, 0, ErrMismatch
	}
	doc.Context = ctx
	doc.UpdatedAt = ""
	doc.Comments = append([]contract.Comment{}, doc.Comments...)
	doc.Viewed = append([]string{}, doc.Viewed...)
	for index := range doc.Comments {
		if doc.Comments[index].Images == nil {
			doc.Comments[index].Images = []string{}
		}
	}
	paths := make(map[string]contract.CodeFile, len(files))
	for _, file := range files {
		paths[file.Path] = file
	}
	adjusted := 0
	if relax {
		for index := range doc.Comments {
			if !quoteInRange(doc.Comments[index].Quote, paths) {
				doc.Comments[index].Quote = nil
				adjusted++
			}
		}
		kept := doc.Viewed[:0]
		for _, entry := range doc.Viewed {
			path, _, _ := strings.Cut(entry, "#")
			if _, ok := paths[path]; ok {
				kept = append(kept, entry)
			}
		}
		doc.Viewed = kept
	}
	saved, err := s.Save(doc, ctx, files)
	return saved, adjusted, err
}

// SaveAsset stores raw image bytes under <review-dir>/assets and returns a
// content-addressed file name. The JSON review only keeps that name.
func (s *Store) SaveAsset(data []byte, ext string) (string, error) {
	if _, ok := assetContentType[ext]; !ok {
		return "", errors.New("只支持 png、jpg、gif、webp 图片")
	}
	if len(data) == 0 {
		return "", errors.New("图片内容为空")
	}
	sum := sha256.Sum256(data)
	name := hex.EncodeToString(sum[:]) + ext
	dir := filepath.Join(s.Dir, "assets")
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", err
	}
	target := filepath.Join(dir, name)
	if _, err := os.Stat(target); err == nil {
		return name, nil
	}
	tmp, err := os.CreateTemp(dir, ".asset-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(tmp.Name())
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return "", err
	}
	if err := tmp.Close(); err != nil {
		return "", err
	}
	if err := os.Chmod(tmp.Name(), 0o600); err != nil {
		return "", err
	}
	if err := os.Rename(tmp.Name(), target); err != nil {
		return "", err
	}
	return name, nil
}

// ReadAsset returns the bytes and content type of a stored review image.
func (s *Store) ReadAsset(name string) ([]byte, string, error) {
	if !assetNamePattern.MatchString(name) {
		return nil, "", errors.New("图片名无效")
	}
	ext := filepath.Ext(name)
	kind, ok := assetContentType[ext]
	if !ok {
		return nil, "", errors.New("不支持的图片格式")
	}
	data, err := os.ReadFile(filepath.Join(s.Dir, "assets", name))
	if err != nil {
		return nil, "", err
	}
	return data, kind, nil
}
