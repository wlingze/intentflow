package serve

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ErrPRNotFound means neither the pr-dir nor GitHub has this pull request.
var ErrPRNotFound = errors.New("PR 不存在")

const defaultPRMaxBytes = 32 << 20

var (
	prOwnerPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	prFilePattern  = regexp.MustCompile(`^(\d+)\.(patch|diff)$`)
)

// PRRef identifies one pull request.
type PRRef struct {
	Owner  string
	Repo   string
	Number int
}

func (r PRRef) key() string {
	return fmt.Sprintf("%s/%s/%d", r.Owner, r.Repo, r.Number)
}

// Valid reports whether the path components are safe to join to a directory
// and to put into a GitHub URL.
func (r PRRef) Valid() bool {
	if !prOwnerPattern.MatchString(r.Owner) || !prOwnerPattern.MatchString(r.Repo) {
		return false
	}
	if r.Owner == "." || r.Owner == ".." || r.Repo == "." || r.Repo == ".." {
		return false
	}
	return r.Number > 0 && r.Number <= 1_000_000_000
}

// PRSummary is one row on the index page.
type PRSummary struct {
	PRRef
	Title string
	Path  string
	Size  int64
}

// LoadedPatch is patch bytes plus the file they came from. Remote is true
// when the bytes were fetched from GitHub and cached.
type LoadedPatch struct {
	Data   []byte
	Path   string
	Remote bool
}

// PRSourceConfig describes the local PR directory and the optional GitHub
// fallback. Public repositories need no token.
type PRSourceConfig struct {
	Dir        string
	GitHub     bool
	GitHubBase string
	Token      string
	HTTPClient *http.Client
	MaxBytes   int64
}

// PRSource resolves /pr/<owner>/<repo>/<number> to a patch file.
type PRSource struct {
	dir        string
	github     bool
	githubBase string
	token      string
	client     *http.Client
	maxBytes   int64
	locks      sync.Map
}

// NewPRSource validates the directory. It creates the directory so fetched
// patches can be cached next to hand-written ones.
func NewPRSource(cfg PRSourceConfig) (*PRSource, error) {
	if strings.TrimSpace(cfg.Dir) == "" {
		return nil, errors.New("--pr-dir 不能为空")
	}
	abs, err := filepath.Abs(cfg.Dir)
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(abs, 0o755); err != nil {
		return nil, fmt.Errorf("创建 PR 目录失败: %w", err)
	}
	if cfg.GitHubBase == "" {
		cfg.GitHubBase = "https://github.com"
	}
	if cfg.HTTPClient == nil {
		cfg.HTTPClient = &http.Client{Timeout: 30 * time.Second}
	}
	if cfg.MaxBytes <= 0 {
		cfg.MaxBytes = defaultPRMaxBytes
	}
	return &PRSource{
		dir: abs, github: cfg.GitHub, githubBase: strings.TrimRight(cfg.GitHubBase, "/"),
		token: cfg.Token, client: cfg.HTTPClient, maxBytes: cfg.MaxBytes,
	}, nil
}

// Dir returns the resolved local directory.
func (s *PRSource) Dir() string { return s.dir }

// ServeGitHub reports whether missing local patches fall back to GitHub.
func (s *PRSource) ServeGitHub() bool { return s.github }

// List scans <dir>/<owner>/<repo>/<number>.patch or .diff.
func (s *PRSource) List() ([]PRSummary, error) {
	owners, err := os.ReadDir(s.dir)
	if err != nil {
		return nil, err
	}
	items := []PRSummary{}
	for _, ownerEntry := range owners {
		if !ownerEntry.IsDir() || strings.HasPrefix(ownerEntry.Name(), ".") {
			continue
		}
		owner := ownerEntry.Name()
		repos, err := os.ReadDir(filepath.Join(s.dir, owner))
		if err != nil {
			continue
		}
		for _, repoEntry := range repos {
			if !repoEntry.IsDir() || strings.HasPrefix(repoEntry.Name(), ".") {
				continue
			}
			repo := repoEntry.Name()
			repoDir := filepath.Join(s.dir, owner, repo)
			files, err := os.ReadDir(repoDir)
			if err != nil {
				continue
			}
			seen := map[int]bool{}
			for _, file := range files {
				if file.IsDir() {
					continue
				}
				match := prFilePattern.FindStringSubmatch(file.Name())
				if match == nil {
					continue
				}
				number, err := strconv.Atoi(match[1])
				if err != nil || number <= 0 || seen[number] {
					continue
				}
				ref := PRRef{Owner: owner, Repo: repo, Number: number}
				if !ref.Valid() {
					continue
				}
				info, err := file.Info()
				if err != nil {
					continue
				}
				if match[2] == "diff" {
					if _, err := os.Stat(filepath.Join(repoDir, fmt.Sprintf("%d.patch", number))); err == nil {
						continue
					}
				}
				seen[number] = true
				items = append(items, PRSummary{PRRef: ref, Title: s.title(ref), Path: filepath.Join(repoDir, file.Name()), Size: info.Size()})
			}
		}
	}
	sort.Slice(items, func(i, j int) bool {
		if items[i].Owner != items[j].Owner {
			return items[i].Owner < items[j].Owner
		}
		if items[i].Repo != items[j].Repo {
			return items[i].Repo < items[j].Repo
		}
		return items[i].Number < items[j].Number
	})
	return items, nil
}

type prMeta struct {
	Title string `json:"title"`
}

func (s *PRSource) title(ref PRRef) string {
	path := filepath.Join(s.dir, ref.Owner, ref.Repo, fmt.Sprintf("%d.json", ref.Number))
	raw, err := os.ReadFile(path)
	if err != nil || len(raw) > 64<<10 {
		return ""
	}
	var meta prMeta
	if err := json.Unmarshal(raw, &meta); err != nil {
		return ""
	}
	return strings.TrimSpace(meta.Title)
}

// Load reads a local patch, or fetches and caches pull/<number>.diff from
// GitHub when the local file does not exist.
func (s *PRSource) Load(ctx context.Context, ref PRRef) (LoadedPatch, error) {
	if !ref.Valid() {
		return LoadedPatch{}, ErrPRNotFound
	}
	if path, ok := s.local(ref); ok {
		data, err := s.read(path)
		if err != nil {
			return LoadedPatch{}, err
		}
		return LoadedPatch{Data: data, Path: path}, nil
	}
	if !s.github {
		return LoadedPatch{}, ErrPRNotFound
	}
	lockValue, _ := s.locks.LoadOrStore(ref.key(), &sync.Mutex{})
	lock := lockValue.(*sync.Mutex)
	lock.Lock()
	defer lock.Unlock()
	// Another request may have written the cache while this one waited.
	if path, ok := s.local(ref); ok {
		data, err := s.read(path)
		if err != nil {
			return LoadedPatch{}, err
		}
		return LoadedPatch{Data: data, Path: path, Remote: true}, nil
	}
	data, err := s.fetch(ctx, ref)
	if err != nil {
		return LoadedPatch{}, err
	}
	target := filepath.Join(s.dir, ref.Owner, ref.Repo, fmt.Sprintf("%d.diff", ref.Number))
	if err := writeAtomic(target, data); err != nil {
		// A read-only cache still serves the fetched bytes.
		return LoadedPatch{Data: data, Path: "", Remote: true}, nil
	}
	return LoadedPatch{Data: data, Path: target, Remote: true}, nil
}

func (s *PRSource) local(ref PRRef) (string, bool) {
	base := filepath.Join(s.dir, ref.Owner, ref.Repo)
	for _, ext := range []string{"patch", "diff"} {
		path := filepath.Join(base, fmt.Sprintf("%d.%s", ref.Number, ext))
		if info, err := os.Stat(path); err == nil && info.Mode().IsRegular() {
			return path, true
		}
	}
	return "", false
}

func (s *PRSource) read(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > s.maxBytes {
		return nil, fmt.Errorf("补丁超过 %d 字节", s.maxBytes)
	}
	return os.ReadFile(path)
}

func (s *PRSource) fetch(ctx context.Context, ref PRRef) ([]byte, error) {
	target := fmt.Sprintf("%s/%s/%s/pull/%d.diff", s.githubBase, url.PathEscape(ref.Owner), url.PathEscape(ref.Repo), ref.Number)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("User-Agent", "intentflow")
	request.Header.Set("Accept", "text/plain")
	token := s.token
	if token == "" {
		token = os.Getenv("GITHUB_TOKEN")
	}
	if token == "" {
		token = os.Getenv("GH_TOKEN")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := s.client.Do(request)
	if err != nil {
		return nil, fmt.Errorf("抓取 GitHub PR 失败: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode == http.StatusNotFound {
		return nil, ErrPRNotFound
	}
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("GitHub 返回 HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, s.maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > s.maxBytes {
		return nil, fmt.Errorf("补丁超过 %d 字节", s.maxBytes)
	}
	if len(data) == 0 {
		return nil, errors.New("GitHub 返回空补丁")
	}
	return data, nil
}

func writeAtomic(target string, data []byte) error {
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(target), ".intentflow-*")
	if err != nil {
		return err
	}
	name := temp.Name()
	defer os.Remove(name)
	if _, err := temp.Write(data); err != nil {
		temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(name, 0o644); err != nil {
		return err
	}
	return os.Rename(name, target)
}
