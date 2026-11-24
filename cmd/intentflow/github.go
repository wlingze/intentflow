package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
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
			return errors.New("github submit 已移除；提交由浏览器扩展或 GitHub 页面完成")
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
		Note:       fmt.Sprintf("GitHub PR #%d：diff 与评论来自 REST API；本模式只读。", target.number),
		BaseRef:    pull.Base.SHA,
		HeadRef:    pull.Head.SHA,
	})
	if err != nil {
		return err
	}
	payload.Session.Comments = ghreview.ImportComments(comments)
	payload.Review.Notes = append(payload.Review.Notes, fmt.Sprintf(
		"已导入 %d 条 GitHub review 评论。GitHub 提交不在 CLI 中，留给浏览器扩展或后续界面。",
		len(comments),
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
