package main

import (
	"context"
	"flag"
	"fmt"

	"github.com/wlingze/intentflow/internal/selfupdate"
)

// newUpdater 单独抽出来，测试可以替换成假 releases。
var newUpdater = func() *selfupdate.Updater { return selfupdate.New() }

// exitUpdateAvailable 是 --check 发现新版本时的退出码。
// 0 表示已是最新，1 保留给错误，2 表示有可用更新，方便脚本判断。
const exitUpdateAvailable = 2

func runUpdate(args []string) error {
	fs := flag.NewFlagSet("intentflow update", flag.ContinueOnError)
	check := fs.Bool("check", false, "只检查版本，不下载")
	requested := fs.String("version", "", "安装指定版本，例如 v0.2.0")
	force := fs.Bool("force", false, "同版本也重新安装")
	repo := fs.String("repo", selfupdate.DefaultRepo, "release 所在仓库 owner/name")
	if err := fs.Parse(args); err != nil {
		return err
	}

	u := newUpdater()
	u.Check = *check
	u.Requested = *requested
	u.Force = *force
	if *repo != "" {
		u.Repo = *repo
	}
	res, err := u.Run(context.Background())
	if err != nil {
		return err
	}
	if *check && res.Available {
		return &exitStatus{code: exitUpdateAvailable}
	}
	return nil
}

// exitStatus 让子命令带着自己的退出码返回，main 不再统一改成 1。
type exitStatus struct{ code int }

func (e *exitStatus) Error() string { return fmt.Sprintf("退出码 %d", e.code) }
