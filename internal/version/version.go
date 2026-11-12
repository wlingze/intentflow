// Package version carries the build identity injected at link time.
//
// 默认值是开发构建；官方二进制通过 -ldflags 覆盖为 git tag，
// 所以 `intentflow version` 报出的版本与发布产物一致。
package version

import "runtime"

// 由构建脚本设置：-X github.com/wlingze/intentflow/internal/version.Version=...
var (
	Version = "dev"
	Commit  = "none"
	Date    = "unknown"
)

// String 返回一行可复制的版本信息。
func String() string {
	return Version + " (" + Commit + ", " + Date + ", " + runtime.Version() + " " + runtime.GOOS + "/" + runtime.GOARCH + ")"
}
