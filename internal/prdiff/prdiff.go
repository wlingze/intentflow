// Package prdiff fetches the unified diff of a GitHub pull request.
//
// It prefers the authenticated `gh` CLI (private repositories work) and falls
// back to the public .diff endpoint. The caller parses the returned patch with
// internal/patchdiff; this package only resolves the reference and metadata.
package prdiff

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
	"time"
)

// DefaultBaseURL is the web host used for the unauthenticated fallback.
const DefaultBaseURL = "https://github.com"

// maxPatch caps a downloaded patch. PR diffs are text, not artifacts.
const maxPatch = 64 << 20

var (
	numericRef = regexp.MustCompile(`^([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)#([0-9]+)$`)
	urlRef     = regexp.MustCompile(`^https?://github\.com/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)/pull/([0-9]+)/?$`)
)

// Ref identifies one pull request.
type Ref struct {
	Owner  string
	Repo   string
	Number int
}

func (r Ref) Repository() string { return r.Owner + "/" + r.Repo }
func (r Ref) ID() string         { return "pr:" + r.Repository() + "#" + strconv.Itoa(r.Number) }

// ParseRef accepts owner/repo#N and a full GitHub pull request URL.
func ParseRef(raw string) (Ref, error) {
	raw = strings.TrimSpace(raw)
	var ownerRepo string
	var number string
	if match := numericRef.FindStringSubmatch(raw); match != nil {
		ownerRepo, number = match[1], match[2]
	} else if match := urlRef.FindStringSubmatch(raw); match != nil {
		ownerRepo, number = match[1], match[2]
	} else {
		return Ref{}, fmt.Errorf("--pr 需要 owner/repo#N 或 GitHub PR URL，收到 %q", raw)
	}
	parts := strings.SplitN(ownerRepo, "/", 2)
	value, err := strconv.Atoi(number)
	if err != nil || value < 1 {
		return Ref{}, fmt.Errorf("PR 编号无效：%q", number)
	}
	return Ref{Owner: parts[0], Repo: parts[1], Number: value}, nil
}

// Meta is best-effort PR information. Empty fields are unknown, not errors.
type Meta struct {
	Ref      Ref
	Title    string
	URL      string
	State    string
	BaseRef  string
	HeadRef  string
	BaseSHA  string
	HeadSHA  string
	Provider string
}

// Fetcher allows tests to replace the network and the gh binary.
type Fetcher struct {
	BaseURL string
	RunGh   func(ctx context.Context, args ...string) ([]byte, error)
	Get     func(ctx context.Context, url string) ([]byte, error)
}

func (f Fetcher) runGh(ctx context.Context, args ...string) ([]byte, error) {
	if f.RunGh != nil {
		return f.RunGh(ctx, args...)
	}
	cmd := exec.CommandContext(ctx, "gh", args...)
	out, err := cmd.Output()
	if err != nil {
		var exit *exec.ExitError
		if errors.As(err, &exit) && len(exit.Stderr) > 0 {
			return nil, fmt.Errorf("%w: %s", err, strings.TrimSpace(string(exit.Stderr)))
		}
		return nil, err
	}
	return out, nil
}

func (f Fetcher) get(ctx context.Context, url string) ([]byte, error) {
	if f.Get != nil {
		return f.Get(ctx, url)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "text/plain")
	request.Header.Set("User-Agent", "intentflow")
	client := &http.Client{Timeout: 60 * time.Second}
	response, err := client.Do(request)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(response.Body, 2048))
		return nil, fmt.Errorf("HTTP %d %s", response.StatusCode, strings.TrimSpace(string(body)))
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxPatch+1))
	if err != nil {
		return nil, err
	}
	if len(raw) > maxPatch {
		return nil, fmt.Errorf("PR patch 超过 %d 字节", maxPatch)
	}
	if len(bytes.TrimSpace(raw)) > 0 && bytes.TrimSpace(raw)[0] == '<' {
		return nil, fmt.Errorf("返回的是 HTML，可能是私有库或登录页；先 gh auth login")
	}
	return raw, nil
}

// Fetch returns the patch and whatever metadata could be read. A missing gh
// is not an error: the public .diff endpoint is tried next.
func (f Fetcher) Fetch(ctx context.Context, ref Ref) ([]byte, Meta, error) {
	meta := Meta{Ref: ref}
	var ghErr error
	if gh, err := f.runGh(ctx, "pr", "diff", strconv.Itoa(ref.Number), "--repo", ref.Repository()); err == nil {
		if len(gh) > maxPatch {
			return nil, meta, fmt.Errorf("PR patch 超过 %d 字节", maxPatch)
		}
		meta.Provider = "gh"
		if info, err := f.runGh(ctx, "pr", "view", strconv.Itoa(ref.Number), "--repo", ref.Repository(),
			"--json", "number,title,url,state,baseRefName,headRefName,baseRefOid,headRefOid"); err == nil {
			mergeView(&meta, info)
		}
		return gh, meta, nil
	} else {
		ghErr = err
	}
	base := f.BaseURL
	if base == "" {
		base = DefaultBaseURL
	}
	url := fmt.Sprintf("%s/%s/pull/%d.diff", strings.TrimRight(base, "/"), ref.Repository(), ref.Number)
	patch, err := f.get(ctx, url)
	if err != nil {
		if ghErr != nil {
			return nil, meta, fmt.Errorf("拉取 PR patch 失败：gh: %v；HTTP: %w", ghErr, err)
		}
		return nil, meta, fmt.Errorf("拉取 PR patch 失败：%w", err)
	}
	meta.Provider = "http"
	return patch, meta, nil
}

func mergeView(meta *Meta, raw []byte) {
	var view struct {
		Number      int    `json:"number"`
		Title       string `json:"title"`
		URL         string `json:"url"`
		State       string `json:"state"`
		BaseRefName string `json:"baseRefName"`
		HeadRefName string `json:"headRefName"`
		BaseRefOid  string `json:"baseRefOid"`
		HeadRefOid  string `json:"headRefOid"`
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		return
	}
	meta.Title, meta.URL, meta.State = view.Title, view.URL, view.State
	meta.BaseRef, meta.HeadRef = view.BaseRefName, view.HeadRefName
	meta.BaseSHA, meta.HeadSHA = view.BaseRefOid, view.HeadRefOid
}
