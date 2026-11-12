// Package frontend 把构建产物嵌进 Go 二进制。
//
// 生产只发一个可执行文件：前端由 scripts/build.sh 先构建，再由这里
// embed。--dist 仍可覆盖，用于临时调试磁盘上的产物。
package frontend

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var distFS embed.FS

// Dist 返回 dist 根目录。
func Dist() fs.FS {
	sub, err := fs.Sub(distFS, "dist")
	if err != nil {
		return distFS
	}
	return sub
}
