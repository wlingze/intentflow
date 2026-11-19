// Package ghreview reads pull requests and writes reviews through the GitHub
// REST API. Tokens come from the environment and are never written to disk.
package ghreview

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const (
	defaultAPIBase  = "https://api.github.com"
	defaultMaxBytes = 32 << 20
)

var (
	ghOwnerPattern = regexp.MustCompile(`^[A-Za-z0-9._-]+$`)
	reviewEvents   = map[string]bool{"COMMENT": true, "APPROVE": true, "REQUEST_CHANGES": true}
)

// HTTPClient is the part of *http.Client this package uses.
type HTTPClient interface {
	Do(*http.Request) (*http.Response, error)
}

// Client talks to the GitHub REST API.
type Client struct {
	APIBase   string
	Token     string
	UserAgent string
	HTTP      HTTPClient
	MaxBytes  int64
}

// NewClient builds a client. apiBase and token are usually empty.
// GITHUB_API_URL and GITHUB_TOKEN/GH_TOKEN are read from the environment.
func NewClient(apiBase, token string) *Client {
	if apiBase == "" {
		apiBase = os.Getenv("GITHUB_API_URL")
	}
	if apiBase == "" {
		apiBase = defaultAPIBase
	}
	if token == "" {
		token = TokenFromEnv()
	}
	return &Client{APIBase: strings.TrimRight(apiBase, "/"), Token: token, UserAgent: "intentflow", MaxBytes: defaultMaxBytes}
}

// TokenFromEnv returns GITHUB_TOKEN, then GH_TOKEN. The value is not logged.
func TokenFromEnv() string {
	if token := os.Getenv("GITHUB_TOKEN"); token != "" {
		return token
	}
	return os.Getenv("GH_TOKEN")
}

// Pull is the subset of a pull request this tool needs.
type Pull struct {
	Number       int    `json:"number"`
	Title        string `json:"title"`
	State        string `json:"state"`
	HTMLURL      string `json:"html_url"`
	Draft        bool   `json:"draft"`
	ChangedFiles int    `json:"changed_files"`
	User         struct {
		Login string `json:"login"`
	} `json:"user"`
	Base struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"base"`
	Head struct {
		Ref string `json:"ref"`
		SHA string `json:"sha"`
	} `json:"head"`
}

// ReviewComment is one existing line-level review comment.
type ReviewComment struct {
	ID                int64     `json:"id"`
	Path              string    `json:"path"`
	Body              string    `json:"body"`
	Side              string    `json:"side"`
	Line              *int      `json:"line"`
	StartLine         *int      `json:"start_line"`
	OriginalLine      *int      `json:"original_line"`
	OriginalStartLine *int      `json:"original_start_line"`
	OriginalSide      string    `json:"original_side"`
	CommitID          string    `json:"commit_id"`
	CreatedAt         time.Time `json:"created_at"`
	HTMLURL           string    `json:"html_url"`
	SubjectType       string    `json:"subject_type"`
	InReplyToID       *int64    `json:"in_reply_to_id"`
	User              struct {
		Login string `json:"login"`
	} `json:"user"`
}

// SubmitComment is one inline comment in a review.
type SubmitComment struct {
	Path      string `json:"path"`
	Body      string `json:"body"`
	Line      int    `json:"line,omitempty"`
	Side      string `json:"side,omitempty"`
	StartLine int    `json:"start_line,omitempty"`
	StartSide string `json:"start_side,omitempty"`
}

// SubmitRequest is the body of POST /pulls/{number}/reviews.
type SubmitRequest struct {
	CommitID string          `json:"commit_id,omitempty"`
	Body     string          `json:"body,omitempty"`
	Event    string          `json:"event"`
	Comments []SubmitComment `json:"comments,omitempty"`
}

// ReviewResult is the subset of a submitted review returned by GitHub.
type ReviewResult struct {
	ID          int64  `json:"id"`
	HTMLURL     string `json:"html_url"`
	State       string `json:"state"`
	Body        string `json:"body"`
	SubmittedAt string `json:"submitted_at"`
	User        struct {
		Login string `json:"login"`
	} `json:"user"`
}

// APIError is a non-2xx GitHub response. It keeps the status, message and
// rate-limit reset time so the CLI can print an actionable error.
type APIError struct {
	Status         int
	Message        string
	Errors         []FieldError
	Details        []string
	RateLimitReset time.Time
	RetryAfter     time.Duration
	URL            string
}

// FieldError is one entry in GitHub's validation errors array.
type FieldError struct {
	Resource string `json:"resource"`
	Field    string `json:"field"`
	Code     string `json:"code"`
	Message  string `json:"message"`
}

func (e *APIError) Error() string {
	switch {
	case e.Status == http.StatusUnauthorized:
		return "GitHub token 无效或已过期（HTTP 401）"
	case e.Status == http.StatusNotFound:
		return "仓库或 PR 不存在，或 token 没有权限（HTTP 404）"
	case (e.Status == http.StatusForbidden || e.Status == http.StatusTooManyRequests) && !e.RateLimitReset.IsZero():
		return fmt.Sprintf("GitHub API 限流（HTTP %d），重置时间 %s", e.Status, e.RateLimitReset.Format(time.RFC3339))
	case e.RetryAfter > 0:
		return fmt.Sprintf("GitHub API 限流（HTTP %d），%s 后重试", e.Status, e.RetryAfter)
	case e.Status == http.StatusUnprocessableEntity:
		detail := e.Message
		extra := ""
		if len(e.Details) > 0 {
			extra = strings.Join(e.Details, "; ")
		} else if len(e.Errors) > 0 {
			parts := []string{}
			for _, item := range e.Errors {
				piece := strings.TrimSpace(strings.Join([]string{item.Field, item.Code, item.Message}, " "))
				if piece != "" {
					parts = append(parts, piece)
				}
			}
			extra = strings.Join(parts, "; ")
		}
		if extra != "" {
			if detail == "" || detail == "Unprocessable Entity" {
				detail = extra
			} else {
				detail += "：" + extra
			}
		}
		return "GitHub 拒绝评审（HTTP 422）：" + detail
	default:
		message := e.Message
		if message == "" {
			message = http.StatusText(e.Status)
		}
		return fmt.Sprintf("GitHub API 返回 HTTP %d：%s", e.Status, message)
	}
}

// Pull reads one pull request.
func (c *Client) Pull(ctx context.Context, owner, repo string, number int) (Pull, error) {
	var pull Pull
	if err := c.doJSON(ctx, http.MethodGet, pullPath(owner, repo, number), nil, &pull); err != nil {
		return Pull{}, err
	}
	return pull, nil
}

// Diff reads the aggregate patch of a pull request. GitHub returns one diff
// for the whole PR, not one per commit.
func (c *Client) Diff(ctx context.Context, owner, repo string, number int) ([]byte, error) {
	return c.doRaw(ctx, http.MethodGet, pullPath(owner, repo, number), "application/vnd.github.v3.diff", nil)
}

// Comments reads line-level review comments. It follows pagination until a
// short page; huge PRs stop at 10 pages (1000 comments) to bound latency.
func (c *Client) Comments(ctx context.Context, owner, repo string, number int) ([]ReviewComment, error) {
	out := []ReviewComment{}
	for page := 1; page <= 10; page++ {
		var batch []ReviewComment
		path := fmt.Sprintf("%s/comments?per_page=100&page=%d", pullPath(owner, repo, number), page)
		if err := c.doJSON(ctx, http.MethodGet, path, nil, &batch); err != nil {
			return nil, err
		}
		out = append(out, batch...)
		if len(batch) < 100 {
			break
		}
	}
	return out, nil
}

// SubmitReview creates a review. Event is COMMENT, APPROVE or REQUEST_CHANGES.
func (c *Client) SubmitReview(ctx context.Context, owner, repo string, number int, req SubmitRequest) (ReviewResult, error) {
	if !reviewEvents[req.Event] {
		return ReviewResult{}, fmt.Errorf("不支持的 review event %q", req.Event)
	}
	if c.Token == "" {
		return ReviewResult{}, errors.New("缺少 GITHUB_TOKEN 或 GH_TOKEN；提交 review 需要 token")
	}
	var result ReviewResult
	path := pullPath(owner, repo, number) + "/reviews"
	if err := c.doJSON(ctx, http.MethodPost, path, req, &result); err != nil {
		return ReviewResult{}, err
	}
	return result, nil
}

func pullPath(owner, repo string, number int) string {
	return fmt.Sprintf("/repos/%s/%s/pulls/%d", url.PathEscape(owner), url.PathEscape(repo), number)
}

// ValidateRepo accepts owner/name with GitHub's allowed characters.
func ValidateRepo(full string) (owner, repo string, err error) {
	parts := strings.Split(full, "/")
	if len(parts) != 2 || !validPart(parts[0]) || !validPart(parts[1]) {
		return "", "", fmt.Errorf("仓库 %q 需要 owner/name 形式", full)
	}
	return parts[0], parts[1], nil
}

func validPart(value string) bool {
	return value != "" && value != "." && value != ".." && ghOwnerPattern.MatchString(value)
}

// ValidateNumber rejects zero and negative PR numbers.
func ValidateNumber(number int) error {
	if number <= 0 || number > 1_000_000_000 {
		return fmt.Errorf("PR 编号必须大于 0")
	}
	return nil
}

func (c *Client) doJSON(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		raw, err := json.Marshal(body)
		if err != nil {
			return err
		}
		reader = bytes.NewReader(raw)
	}
	raw, err := c.doRaw(ctx, method, path, "application/vnd.github+json", reader)
	if err != nil {
		return err
	}
	if out != nil {
		if err := json.Unmarshal(raw, out); err != nil {
			return fmt.Errorf("解析 GitHub API 响应失败：%w", err)
		}
	}
	return nil
}

func (c *Client) doRaw(ctx context.Context, method, path, accept string, body io.Reader) ([]byte, error) {
	base := c.APIBase
	if base == "" {
		base = defaultAPIBase
	}
	request, err := http.NewRequestWithContext(ctx, method, strings.TrimRight(base, "/")+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", accept)
	request.Header.Set("X-GitHub-Api-Version", "2022-11-28")
	request.Header.Set("User-Agent", c.userAgent())
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if c.Token != "" {
		request.Header.Set("Authorization", "Bearer "+c.Token)
	}
	response, err := c.httpClient().Do(request)
	if err != nil {
		return nil, fmt.Errorf("请求 GitHub API 失败：%w", err)
	}
	defer response.Body.Close()
	limit := c.MaxBytes
	if limit <= 0 {
		limit = defaultMaxBytes
	}
	raw, err := io.ReadAll(io.LimitReader(response.Body, limit+1))
	if err != nil {
		return nil, fmt.Errorf("读取 GitHub API 响应失败：%w", err)
	}
	if int64(len(raw)) > limit {
		return nil, fmt.Errorf("GitHub API 响应超过 %d MiB", limit>>20)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return nil, parseAPIError(response, raw, request.URL.String())
	}
	return raw, nil
}

func (c *Client) httpClient() HTTPClient {
	if c.HTTP != nil {
		return c.HTTP
	}
	return &http.Client{Timeout: 60 * time.Second}
}

func (c *Client) userAgent() string {
	if c.UserAgent != "" {
		return c.UserAgent
	}
	return "intentflow"
}

func parseAPIError(response *http.Response, raw []byte, target string) error {
	var body struct {
		Message string          `json:"message"`
		Errors  json.RawMessage `json:"errors"`
	}
	_ = json.Unmarshal(raw, &body)
	apiErr := &APIError{Status: response.StatusCode, Message: body.Message, URL: target}
	if len(body.Errors) > 0 {
		var fields []FieldError
		if err := json.Unmarshal(body.Errors, &fields); err == nil && len(fields) > 0 {
			apiErr.Errors = fields
		} else {
			var details []string
			if err := json.Unmarshal(body.Errors, &details); err == nil {
				apiErr.Details = details
			}
		}
	}
	if reset := response.Header.Get("X-RateLimit-Reset"); reset != "" {
		if epoch, err := strconv.ParseInt(reset, 10, 64); err == nil {
			apiErr.RateLimitReset = time.Unix(epoch, 0)
		}
	}
	if retry := response.Header.Get("Retry-After"); retry != "" {
		if seconds, err := strconv.Atoi(retry); err == nil {
			apiErr.RetryAfter = time.Duration(seconds) * time.Second
		}
	}
	return apiErr
}
