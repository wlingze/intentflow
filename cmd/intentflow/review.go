package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/wlingze/intentflow/frontend"
	"github.com/wlingze/intentflow/internal/contract"
	"github.com/wlingze/intentflow/internal/model"
	"github.com/wlingze/intentflow/internal/patchdiff"
	"github.com/wlingze/intentflow/internal/prdiff"
	"github.com/wlingze/intentflow/internal/reviewctx"
	"github.com/wlingze/intentflow/internal/reviewflow"
	"github.com/wlingze/intentflow/internal/serve"
)

// pageCloseGrace is a variable so tests can shorten the page-close wait.
var pageCloseGrace = 5 * time.Second

// reviewCommand is separate from runReview so tests can capture stdout/stderr
// without replacing the process globals.
func runReview(args []string) error {
	return reviewCommand(context.Background(), args, os.Stdout, os.Stderr)
}

func reviewCommand(parent context.Context, args []string, stdout, stderr io.Writer) error {
	jsonRequested := jsonFlagPresent(args)
	var opt options
	fs := flag.NewFlagSet("intentflow review", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	opt.register(fs)
	diffPath := fs.String("diff", "", "审阅 unified diff 文件；- 表示 stdin")
	prRef := fs.String("pr", "", "GitHub PR：owner/repo#N 或 PR URL")
	wait := fs.Bool("wait", true, "等待提交；review 总是等待")
	jsonOut := fs.Bool("json", false, "stdout 只输出结果 JSON")
	readyPath := fs.String("ready-file", "", "监听成功后写入 ready JSON")
	timeout := fs.Duration("timeout", 30*time.Minute, "总等待上限；0 不超时")
	host := fs.String("host", "127.0.0.1", "HTTP 监听地址")
	port := fs.Int("port", 0, "HTTP 端口；0 自动分配")
	dist := fs.String("dist", "", "覆盖内嵌前端，仅调试用")
	noOpen := fs.Bool("no-open", false, "不自动打开浏览器")
	if err := fs.Parse(args); err != nil {
		if errors.Is(err, flag.ErrHelp) {
			reviewUsage(stderr)
			return nil
		}
		return emitReview(reviewflow.ErrorResult(reviewflow.ReasonUsage, err.Error(), nil), jsonRequested, stdout, stderr)
	}
	jsonMode := *jsonOut
	fail := func(reason string, err error) error {
		return emitReview(reviewflow.ErrorResult(reason, err.Error(), nil), jsonMode, stdout, stderr)
	}
	switch {
	case fs.NArg() > 0:
		return fail(reviewflow.ReasonUsage, fmt.Errorf("多余参数：%s", strings.Join(fs.Args(), " ")))
	case !*wait:
		return fail(reviewflow.ReasonUsage, errors.New("review 总是等待提交；只读页面请用 intentflow serve"))
	case *timeout < 0:
		return fail(reviewflow.ReasonUsage, errors.New("--timeout 不能为负"))
	case opt.mode != "" && opt.mode != "diff":
		return fail(reviewflow.ReasonUsage, errors.New("仅支持 --mode diff"))
	case *diffPath != "" && *prRef != "":
		return fail(reviewflow.ReasonUsage, errors.New("--diff 与 --pr 不能同时使用"))
	}
	if *diffPath != "" {
		if err := rejectGitFlags(opt); err != nil {
			return fail(reviewflow.ReasonUsage, err)
		}
	}
	if *prRef != "" {
		if err := rejectGitFlags(opt); err != nil {
			return fail(reviewflow.ReasonUsage, err)
		}
	}

	logOut := stdout
	if jsonMode {
		logOut = stderr
	}
	opt.log = logOut

	p, cleanup, reason, err := buildReviewSource(parent, opt, *diffPath, *prRef)
	if err != nil {
		return emitReview(reviewflow.ErrorResult(reason, err.Error(), nil), jsonMode, stdout, stderr)
	}
	if cleanup != nil {
		defer cleanup()
	}

	waiter := reviewflow.NewWaiter(reviewflow.Options{Grace: pageCloseGrace})
	stop := make(chan struct{})
	var stopOnce sync.Once
	stopServer := func() { stopOnce.Do(func() { close(stop) }) }
	type readyInfo struct {
		urls []string
		port int
	}
	readyCh := make(chan readyInfo, 1)
	serveErr := make(chan error, 1)
	go func() {
		serveErr <- serve.Listen(serve.Config{
			Host: *host, Port: *port, DistDir: *dist, DistFS: frontend.Dist(),
			Payload:     func() contract.Payload { return p },
			Submission:  waiter,
			Ready:       func(urls []string, port int) { readyCh <- readyInfo{urls: urls, port: port} },
			Stop:        stop,
			Out:         logOut,
			Log:         logOut,
			OpenBrowser: !*noOpen && isTerminal(os.Stdout),
		})
	}()

	select {
	case ready := <-readyCh:
		if *readyPath != "" {
			err := reviewflow.WriteReady(*readyPath, reviewflow.Ready{
				SchemaVersion: reviewflow.SchemaVersion,
				URL:           ready.urls[0],
				Port:          ready.port,
				PID:           os.Getpid(),
				SessionID:     p.Session.Context.SessionId,
				ComparisonID:  p.Session.Context.ComparisonId,
			})
			if err != nil {
				stopServer()
				<-serveErr
				return emitReview(reviewflow.ErrorResult(reviewflow.ReasonInternal, err.Error(), reviewflow.RevisionFromPayload(p)), jsonMode, stdout, stderr)
			}
		}
	case err := <-serveErr:
		if err == nil {
			err = errors.New("服务在就绪前退出")
		}
		return emitReview(reviewflow.ErrorResult(reviewflow.ReasonListen, err.Error(), reviewflow.RevisionFromPayload(p)), jsonMode, stdout, stderr)
	}

	waitCtx, stopSignals := signal.NotifyContext(parent, os.Interrupt, syscall.SIGTERM)
	defer stopSignals()
	if *timeout > 0 {
		var cancel context.CancelFunc
		waitCtx, cancel = context.WithTimeout(waitCtx, *timeout)
		defer cancel()
	}
	outcome := waiter.Wait(waitCtx, func() reviewflow.Outcome {
		if errors.Is(waitCtx.Err(), context.DeadlineExceeded) {
			return reviewflow.Outcome{Status: reviewflow.StatusTimeout, Reason: reviewflow.ReasonTimeout, Message: "等待审阅超时，未收到提交"}
		}
		return reviewflow.Outcome{Status: reviewflow.StatusCancelled, Reason: reviewflow.ReasonInterrupted, Message: "收到中断信号，审阅未提交"}
	})
	// The submission POST wakes this process before its handler has flushed
	// the 200 response. Give the HTTP stack a moment before Shutdown closes
	// the listener, otherwise a browser/curl can see an empty reply.
	time.Sleep(200 * time.Millisecond)
	stopServer()
	serveFailure := <-serveErr
	if serveFailure != nil && outcome.Status != reviewflow.StatusSubmitted {
		return emitReview(reviewflow.ErrorResult(reviewflow.ReasonListen, serveFailure.Error(), reviewflow.RevisionFromPayload(p)), jsonMode, stdout, stderr)
	}

	revision := reviewflow.RevisionFromPayload(p)
	switch outcome.Status {
	case reviewflow.StatusSubmitted:
		return emitReview(reviewflow.SubmittedResult(outcome, revision), jsonMode, stdout, stderr)
	case reviewflow.StatusCancelled:
		return emitReview(reviewflow.CancelledResult(outcome, revision), jsonMode, stdout, stderr)
	default:
		return emitReview(reviewflow.TimeoutResult(revision), jsonMode, stdout, stderr)
	}
}

func buildReviewSource(ctx context.Context, opt options, diffPath, prRef string) (contract.Payload, func(), string, error) {
	switch {
	case diffPath != "":
		raw, err := readPatch(diffPath)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonPatch, err
		}
		name := displayPatch(diffPath)
		if diffPath != "-" {
			if abs, absErr := filepath.Abs(diffPath); absErr == nil {
				name = abs
			}
		}
		code, meta, err := patchdiff.Parse(raw)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonPatch, err
		}
		if len(code.Files) == 0 {
			return contract.Payload{}, nil, reviewflow.ReasonPatch, errors.New("补丁里没有可审阅的文本改动")
		}
		p := patchPayload(code, reviewflow.Revision{
			ID: "patch", Mode: string(contract.Patch), Repository: name, Branch: "补丁",
			Head:      meta.Commit,
			BaseLabel: "补丁前", HeadLabel: patchSideLabel(meta.Commit, "补丁后"),
		}, "补丁文件："+name)
		return p, nil, "", nil
	case prRef != "":
		ref, err := prdiff.ParseRef(prRef)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonPR, err
		}
		fetchCtx, cancel := context.WithTimeout(ctx, 90*time.Second)
		defer cancel()
		raw, meta, err := (prdiff.Fetcher{}).Fetch(fetchCtx, ref)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonPR, err
		}
		code, _, err := patchdiff.Parse(raw)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonPR, err
		}
		if len(code.Files) == 0 {
			return contract.Payload{}, nil, reviewflow.ReasonPR, errors.New("PR 没有可审阅的文本改动")
		}
		baseSHA, headSHA := meta.BaseSHA, meta.HeadSHA
		baseLabel := refLabel(meta.BaseRef, baseSHA, "base")
		headLabel := refLabel(meta.HeadRef, headSHA, "head")
		note := "GitHub PR " + ref.Repository() + "#" + fmt.Sprint(ref.Number)
		if meta.Title != "" {
			note += "：" + meta.Title
		}
		p := patchPayload(code, reviewflow.Revision{
			ID: ref.ID(), Mode: string(contract.Git), Repository: ref.Repository(), Branch: meta.HeadRef,
			Base: baseSHA, Head: headSHA, BaseLabel: baseLabel, HeadLabel: headLabel,
		}, note)
		p.Review.Comparison.Repo = ptr(meta.Ref.Repository())
		p.Review.Comparison.BaseRef = ptr(meta.BaseRef)
		p.Review.Comparison.HeadRef = ptr(meta.HeadRef)
		p.Review.BaseLabel = baseLabel
		return p, nil, "", nil
	default:
		a, err := newApp(opt)
		if err != nil {
			return contract.Payload{}, nil, reviewflow.ReasonGit, err
		}
		return a.payload(), a.close, "", nil
	}
}

func patchPayload(code contract.CodeBundle, revision reviewflow.Revision, note string) contract.Payload {
	code.Root = revision.BaseLabel + " → " + revision.HeadLabel
	comparison := model.Comparison{
		Mode:        contract.ComparisonMode(revision.Mode),
		BeforeLabel: revision.BaseLabel,
		AfterLabel:  revision.HeadLabel,
		Commits:     []contract.Commit{},
		Selected:    []string{},
		Note:        note,
	}
	ctx := reviewctx.NewContext(revision.Repository, revision.Branch, revision.Base, revision.Head, revision.ID, "", code)
	notes := []string{}
	if len(code.Skipped) > 0 {
		notes = append(notes, fmt.Sprintf("跳过 %d 个文件（二进制或超出体积上限）", len(code.Skipped)))
	}
	return contract.Payload{Code: code, Session: reviewctx.Empty(ctx), Review: model.Review{
		Before: comparison.BeforeLabel, After: comparison.AfterLabel, Comparison: comparison,
		Notes: notes, Signals: []model.Signal{}, Findings: []contract.Finding{},
		Scan:       contract.ScanState{Mode: contract.ScanModeDiff, Status: contract.ScanStatusSkipped},
		BaseLabel:  revision.BaseLabel,
		BaseBehind: 0, BaseUpstream: "", NeedsRebase: false,
	}}
}

func rejectGitFlags(opt options) error {
	switch {
	case opt.before != "" || opt.after != "":
		return errors.New("使用 patch/PR 时不能同时用 --before/--after")
	case opt.base != "":
		return errors.New("使用 patch/PR 时不能同时用 --base")
	case opt.head != "" && opt.head != "HEAD":
		return errors.New("使用 patch/PR 时不能同时用 --head")
	case opt.rebase:
		return errors.New("使用 patch/PR 时不能同时用 --rebase")
	}
	return nil
}

func patchSideLabel(sha, fallback string) string {
	if sha == "" {
		return fallback
	}
	return shortSHA(sha)
}

func refLabel(ref, sha, fallback string) string {
	switch {
	case ref != "" && sha != "":
		return ref + " · " + shortSHA(sha)
	case sha != "":
		return shortSHA(sha)
	case ref != "":
		return ref
	default:
		return fallback
	}
}

// jsonFlagPresent lets parse failures still produce a machine JSON envelope.
func jsonFlagPresent(args []string) bool {
	for _, arg := range args {
		switch {
		case arg == "--json" || arg == "-json":
			return true
		case strings.HasPrefix(arg, "--json="):
			return strings.TrimPrefix(arg, "--json=") != "false" && strings.TrimPrefix(arg, "--json=") != "0"
		case strings.HasPrefix(arg, "-json="):
			return strings.TrimPrefix(arg, "-json=") != "false" && strings.TrimPrefix(arg, "-json=") != "0"
		}
	}
	return false
}

func emitReview(result reviewflow.Result, jsonMode bool, stdout, stderr io.Writer) error {
	if jsonMode {
		if err := result.WriteJSON(stdout); err != nil {
			fmt.Fprintln(stderr, "intentflow:", err)
		}
	} else {
		printHumanReview(result, stdout)
	}
	if result.Status == reviewflow.StatusError {
		fmt.Fprintln(stderr, "intentflow:", result.Message)
	}
	if code := result.ExitCode(); code != 0 {
		return &exitStatus{code: code}
	}
	return nil
}

func printHumanReview(result reviewflow.Result, out io.Writer) {
	switch result.Status {
	case reviewflow.StatusSubmitted:
		verdict := ""
		if result.Verdict != nil {
			verdict = string(*result.Verdict)
		}
		fmt.Fprintf(out, "· 审阅已提交：%s，%d 条意见\n", verdict, len(result.Comments))
		if result.Summary != nil && *result.Summary != "" {
			fmt.Fprintf(out, "  总结：%s\n", *result.Summary)
		}
	case reviewflow.StatusCancelled, reviewflow.StatusTimeout:
		message := result.Message
		if message == "" {
			message = "审阅未提交"
		}
		fmt.Fprintf(out, "· %s\n", message)
	}
}

func reviewUsage(w io.Writer) {
	fmt.Fprint(w, `intentflow review — 给 agent 的阻塞式审阅

  intentflow review --wait --json [--diff <patch>|--pr <owner/repo#N>]
  intentflow review --wait --json --base HEAD --head WORKTREE \
    --ready-file /tmp/intentflow-ready.json --timeout 30m

  --wait           显式等待；review 总是等待
  --json           stdout 只输出一份结果 JSON；日志和 URL 去 stderr
  --diff           unified diff 文件；- 表示 stdin
  --pr             GitHub PR：owner/repo#N 或 PR URL
  --ready-file     监听成功后原子写入 URL/端口/session
  --timeout        总等待上限，默认 30m；0 表示不超时
  --host           默认 127.0.0.1，只接受本机页面
  --port           默认 0，由系统分配
  --no-open        不自动打开浏览器

  退出码：0 已提交；1 错误；2 取消或页面关闭；3 超时；130 中断
`)
}
