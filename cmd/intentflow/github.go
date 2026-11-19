package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"strings"
	"time"

	"github.com/wlingze/intentflow/frontend"
	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/ghreview"
	"github.com/wlingze/intentflow/internal/prdiff"
	"github.com/wlingze/intentflow/internal/serve"
)

func runGithub(args []string) error {
	if len(args) > 0 {
		switch args[0] {
		case "open":
			return runGithubOpen(args[1:])
		case "submit":
			return runGithubSubmit(args[1:])
		}
	}
	return runGithubOpen(args)
}

func runGithubOpen(args []string) error {
	fs := flag.NewFlagSet("intentflow github", flag.ContinueOnError)
	var repo string
	var number int
	var api string
	fs.StringVar(&repo, "repo", "", "GitHub 仓库，owner/name")
	fs.IntVar(&number, "pr", 0, "PR 编号")
	fs.StringVar(&api, "api", "", "GitHub API 地址；默认取 GITHUB_API_URL")
	noComments := fs.Bool("no-comments", false, "不导入已有的 GitHub review 评论")
	host := fs.String("host", "0.0.0.0", "HTTP 监听地址")
	port := fs.Int("port", 0, "HTTP 端口；0 自动分配")
	dist := fs.String("dist", "", "覆盖内嵌前端")
	noOpen := fs.Bool("no-open", false, "不自动打开浏览器")
	if err := fs.Parse(args); err != nil {
		return err
	}
	target, err := parseGithubTarget(repo, number)
	if err != nil {
		return err
	}
	client := ghreview.NewClient(api, "")
	if client.Token == "" {
		fmt.Fprintln(os.Stderr, "· 没有 GITHUB_TOKEN / GH_TOKEN：匿名读取，容易触发 GitHub 限流")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pull, err := client.Pull(ctx, target.owner, target.repo, target.number)
	if err != nil {
		return err
	}
	diff, err := client.Diff(ctx, target.owner, target.repo, target.number)
	if err != nil {
		return err
	}
	comments := []ghreview.ReviewComment{}
	if !*noComments {
		comments, err = client.Comments(ctx, target.owner, target.repo, target.number)
		if err != nil {
			return err
		}
	}
	payload, revisions, err := prdiff.Build(diff, prdiff.Params{
		Repository: "github.com/" + target.owner + "/" + target.repo,
		Branch:     fmt.Sprintf("pull/%d", target.number),
		Before:     shortSHA(pull.Base.SHA),
		After:      shortSHA(pull.Head.SHA),
		Title:      pull.Title,
		Mode:       contract.Git,
		Note:       fmt.Sprintf("GitHub PR #%d：diff 与评论来自 REST API；提交用 intentflow github submit。", target.number),
		BaseRef:    pull.Base.SHA,
		HeadRef:    pull.Head.SHA,
	})
	if err != nil {
		return err
	}
	payload.Session.Comments = ghreview.ImportComments(comments)
	payload.Review.Notes = append(payload.Review.Notes, fmt.Sprintf(
		"已导入 %d 条 GitHub review 评论。提交本地新评论：intentflow github submit --repo %s --pr %d --review <json> --event comment",
		len(comments), target.full, target.number,
	))
	fmt.Printf("· PR #%d %s（%s → %s），%d 个改动文件，导入 %d 条评论\n",
		target.number, pull.Title, shortSHA(pull.Base.SHA), shortSHA(pull.Head.SHA), len(payload.Code.Files), len(comments))
	return serve.Listen(serve.Config{
		Host: *host, Port: *port, DistDir: *dist, DistFS: frontend.Dist(),
		Payload:     func() contract.Payload { return payload },
		Revisions:   func() (contract.RevisionList, error) { return revisions, nil },
		OpenBrowser: !*noOpen && isTerminal(os.Stdout),
	})
}

func runGithubSubmit(args []string) error {
	fs := flag.NewFlagSet("intentflow github submit", flag.ContinueOnError)
	var repo, reviewPath, eventValue, body, api string
	var number int
	fs.StringVar(&repo, "repo", "", "GitHub 仓库，owner/name")
	fs.IntVar(&number, "pr", 0, "PR 编号")
	fs.StringVar(&reviewPath, "review", "", "intentflow 导出的 review JSON；- 表示 stdin")
	fs.StringVar(&eventValue, "event", "comment", "comment | approve | request-changes")
	fs.StringVar(&body, "body", "", "review 整体说明；会放在自动生成的整体意见之前")
	fs.StringVar(&api, "api", "", "GitHub API 地址；默认取 GITHUB_API_URL")
	dryRun := fs.Bool("dry-run", false, "只打印将提交的 JSON，不调用 GitHub")
	asJSON := fs.Bool("json", false, "打印 GitHub 返回的原始 JSON")
	if err := fs.Parse(args); err != nil {
		return err
	}
	target, err := parseGithubTarget(repo, number)
	if err != nil {
		return err
	}
	event, err := reviewEvent(eventValue)
	if err != nil {
		return err
	}
	doc := contract.ReviewSession{Comments: []contract.Comment{}}
	if reviewPath != "" {
		doc, err = readReviewDocument(reviewPath)
		if err != nil {
			return err
		}
	} else if strings.TrimSpace(body) == "" {
		return errors.New("缺少评审内容：用 --review <json|->，或至少给 --body")
	}
	if err := validateReviewTarget(doc, target); err != nil {
		return err
	}
	client := ghreview.NewClient(api, "")
	if client.Token == "" {
		return errors.New("缺少 GITHUB_TOKEN 或 GH_TOKEN；提交 review 需要 token")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
	defer cancel()
	pull, err := client.Pull(ctx, target.owner, target.repo, target.number)
	if err != nil {
		return err
	}
	diff, err := client.Diff(ctx, target.owner, target.repo, target.number)
	if err != nil {
		return err
	}
	mapped, err := ghreview.MapReview(doc, diff, body)
	if err != nil {
		return err
	}
	if event == "COMMENT" && len(mapped.Comments) == 0 && strings.TrimSpace(mapped.Body) == "" {
		return errors.New("没有可提交的评论：所有评论都已解决、来自 GitHub，或没有正文")
	}
	request := ghreview.SubmitRequest{CommitID: pull.Head.SHA, Event: event, Body: mapped.Body, Comments: mapped.Comments}
	if *dryRun {
		output := struct {
			Request  ghreview.SubmitRequest    `json:"request"`
			Skipped  []ghreview.SkippedComment `json:"skipped"`
			Imported int                       `json:"imported"`
			Resolved int                       `json:"resolved"`
		}{Request: request, Skipped: mapped.Skipped, Imported: mapped.Imported, Resolved: mapped.Resolved}
		raw, _ := json.MarshalIndent(output, "", "  ")
		fmt.Println(string(raw))
		return nil
	}
	result, err := client.SubmitReview(ctx, target.owner, target.repo, target.number, request)
	if err != nil {
		return err
	}
	if *asJSON {
		raw, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(raw))
		return nil
	}
	fmt.Println("GitHub review 已提交")
	fmt.Printf("  id: %d\n  state: %s\n  url: %s\n", result.ID, result.State, result.HTMLURL)
	fmt.Printf("  行级评论: %d\n", len(mapped.Comments))
	if len(mapped.Skipped) > 0 {
		fmt.Printf("  未映射到当前 diff 的评论: %d（已写入 review body）\n", len(mapped.Skipped))
	}
	return nil
}

type githubTarget struct {
	owner, repo string
	number      int
	full        string
}

func parseGithubTarget(repo string, number int) (githubTarget, error) {
	owner, name, err := ghreview.ValidateRepo(repo)
	if err != nil {
		return githubTarget{}, err
	}
	if err := ghreview.ValidateNumber(number); err != nil {
		return githubTarget{}, err
	}
	return githubTarget{owner: owner, repo: name, number: number, full: owner + "/" + name}, nil
}

func validateReviewTarget(doc contract.ReviewSession, target githubTarget) error {
	repository := strings.TrimSuffix(strings.TrimPrefix(doc.Context.Repository, "https://"), "/")
	repository = strings.TrimPrefix(repository, "github.com/")
	if repository != "" && !strings.EqualFold(repository, target.full) {
		return fmt.Errorf("review JSON 属于 %s，与 --repo %s 不匹配", doc.Context.Repository, target.full)
	}
	if doc.Context.Branch != "" && doc.Context.Branch != fmt.Sprintf("pull/%d", target.number) {
		return fmt.Errorf("review JSON 属于 %s，与 --pr %d 不匹配", doc.Context.Branch, target.number)
	}
	return nil
}

func reviewEvent(value string) (string, error) {
	normalized := strings.ReplaceAll(strings.ToLower(strings.TrimSpace(value)), "_", "-")
	normalized = strings.ReplaceAll(normalized, " ", "-")
	switch normalized {
	case "", "comment":
		return "COMMENT", nil
	case "approve":
		return "APPROVE", nil
	case "request-changes":
		return "REQUEST_CHANGES", nil
	default:
		return "", fmt.Errorf("未知 event %q；用 comment、approve 或 request-changes", value)
	}
}

const maxReviewBytes = 8 << 20

func readReviewDocument(path string) (contract.ReviewSession, error) {
	var raw []byte
	var err error
	if path == "-" {
		raw, err = io.ReadAll(io.LimitReader(os.Stdin, maxReviewBytes+1))
	} else {
		info, statErr := os.Stat(path)
		if statErr != nil {
			return contract.ReviewSession{}, statErr
		}
		if info.Size() > maxReviewBytes {
			return contract.ReviewSession{}, fmt.Errorf("review JSON 超过 %d 字节", maxReviewBytes)
		}
		raw, err = os.ReadFile(path)
	}
	if err != nil {
		return contract.ReviewSession{}, err
	}
	if len(raw) > maxReviewBytes {
		return contract.ReviewSession{}, fmt.Errorf("review JSON 超过 %d 字节", maxReviewBytes)
	}
	var doc contract.ReviewSession
	if err := json.Unmarshal(raw, &doc); err != nil {
		return contract.ReviewSession{}, fmt.Errorf("解析 review JSON 失败：%w", err)
	}
	if doc.Version != 0 && doc.Version != 1 {
		return contract.ReviewSession{}, fmt.Errorf("不支持的 review 版本 %d", doc.Version)
	}
	if doc.Comments == nil {
		doc.Comments = []contract.Comment{}
	}
	return doc, nil
}
