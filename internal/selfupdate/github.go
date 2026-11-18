package selfupdate

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// HTTPClient 是 *http.Client 里本包用到的部分，测试可以替换。
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Releases 抽象 releases API。tag 为空表示查最新发布。
type Releases interface {
	Release(ctx context.Context, tag string) (Release, error)
}

// Asset 是 release 里的一个可下载文件。
type Asset struct {
	Name string `json:"name"`
	URL  string `json:"browser_download_url"`
}

// Release 只保留本命令需要的字段。
type Release struct {
	Tag    string  `json:"tag_name"`
	Assets []Asset `json:"assets"`
}

// Asset 按名字找资产。
func (r Release) Asset(name string) (Asset, bool) {
	for _, a := range r.Assets {
		if a.Name == name {
			return a, true
		}
	}
	return Asset{}, false
}

// GitHub 通过 REST API 读取 release。
// Token 只发给 API；资产下载走公开地址，不带凭据。
type GitHub struct {
	HTTP      HTTPClient
	API       string // 默认 https://api.github.com
	Repo      string // owner/name
	Token     string
	UserAgent string
}

// Release 实现 Releases。
func (g *GitHub) Release(ctx context.Context, tag string) (Release, error) {
	if err := validateRepo(g.Repo); err != nil {
		return Release{}, err
	}
	base := strings.TrimRight(g.API, "/")
	if base == "" {
		base = "https://api.github.com"
	}
	endpoint := base + "/repos/" + g.Repo + "/releases/latest"
	if tag != "" {
		endpoint = base + "/repos/" + g.Repo + "/releases/tags/" + url.PathEscape(tag)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return Release{}, fmt.Errorf("构造 releases 请求失败：%w", err)
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	req.Header.Set("User-Agent", g.userAgent())
	if g.Token != "" {
		req.Header.Set("Authorization", "Bearer "+g.Token)
	}

	resp, err := g.httpClient().Do(req)
	if err != nil {
		return Release{}, fmt.Errorf("请求 GitHub API 失败：%w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Release{}, apiError(resp, g.Repo, tag)
	}
	body, err := io.ReadAll(io.LimitReader(resp.Body, maxAPIBytes+1))
	if err != nil {
		return Release{}, fmt.Errorf("读取 GitHub API 响应失败：%w", err)
	}
	if len(body) > maxAPIBytes {
		return Release{}, fmt.Errorf("GitHub API 响应超过 %d MiB", maxAPIBytes>>20)
	}
	var rel Release
	if err := json.Unmarshal(body, &rel); err != nil {
		return Release{}, fmt.Errorf("解析 GitHub API 响应失败：%w", err)
	}
	if rel.Tag == "" {
		return Release{}, fmt.Errorf("GitHub API 没有返回 tag_name")
	}
	return rel, nil
}

func (g *GitHub) httpClient() HTTPClient {
	if g.HTTP != nil {
		return g.HTTP
	}
	return defaultHTTPClient()
}

func (g *GitHub) userAgent() string {
	if g.UserAgent != "" {
		return g.UserAgent
	}
	return "intentflow"
}

// apiError 把状态码翻译成可执行的提示，避免把整段 JSON 抛给用户。
func apiError(resp *http.Response, repo, tag string) error {
	switch resp.StatusCode {
	case http.StatusNotFound:
		if tag != "" {
			return fmt.Errorf("仓库 %s 没有 release %s", repo, tag)
		}
		return fmt.Errorf("仓库 %s 还没有任何 release", repo)
	case http.StatusUnauthorized:
		return fmt.Errorf("GitHub 拒绝了凭据：检查 GITHUB_TOKEN 是否有效")
	case http.StatusForbidden, http.StatusTooManyRequests:
		if resp.Header.Get("X-RateLimit-Remaining") == "0" || resp.StatusCode == http.StatusTooManyRequests {
			return fmt.Errorf("GitHub API 限流；设置 GITHUB_TOKEN 可提高限额（HTTP %d）", resp.StatusCode)
		}
		return fmt.Errorf("GitHub API 拒绝请求（HTTP %d）", resp.StatusCode)
	default:
		return fmt.Errorf("GitHub API 返回 HTTP %d", resp.StatusCode)
	}
}

// defaultHTTPClient 走环境变量里的 HTTPS 代理，并给大资产留足时间。
// http.ProxyFromEnvironment 会读取 HTTPS_PROXY / HTTP_PROXY / NO_PROXY。
func defaultHTTPClient() HTTPClient {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.Proxy = http.ProxyFromEnvironment
	return &http.Client{Timeout: 15 * time.Minute, Transport: transport}
}

// validateRepo 只接受 owner/name，防止把任意字符串拼进 API 路径。
func validateRepo(repo string) error {
	parts := strings.Split(repo, "/")
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return fmt.Errorf("仓库 %q 需要 owner/name 形式", repo)
	}
	for _, part := range parts {
		for _, r := range part {
			if r == '-' || r == '_' || r == '.' || unicode.IsLetter(r) || unicode.IsDigit(r) {
				continue
			}
			return fmt.Errorf("仓库 %q 含有不支持的字符 %q", repo, r)
		}
	}
	return nil
}
