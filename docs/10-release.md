# 发布

## 版本号

语义化版本，tag 形如 `v0.1.0`。

版本号、提交、构建时间在链接期注入 `internal/version`：

```bash
go build -ldflags "-X github.com/wlingze/intentflow/internal/version.Version=0.1.0 ..."
```

`intentflow version` 打印三者加运行平台。开发构建显示 `git describe` 结果，
带未提交改动时后缀 `-dirty`。

## 产物

每个 tag 产出 6 个压缩包与一份 `checksums.txt`：

| 目标 | 文件 |
| --- | --- |
| `linux/amd64` | `intentflow_<版本>_linux_amd64.tar.gz` |
| `linux/arm64` | `intentflow_<版本>_linux_arm64.tar.gz` |
| `darwin/amd64` | `intentflow_<版本>_darwin_amd64.tar.gz` |
| `darwin/arm64` | `intentflow_<版本>_darwin_arm64.tar.gz` |
| `windows/amd64` | `intentflow_<版本>_windows_amd64.zip` |
| `windows/arm64` | `intentflow_<版本>_windows_arm64.zip` |

每个包只有一个可执行文件；Linux 与 macOS 包另附 `LICENSE` 与 `README.md`。

前端在 CI 里只构建一次，六个平台共用同一份 embed 产物。二进制是纯 Go 静态
链接，`CGO_ENABLED=0`。

## 流程

1. 本地跑 `make check` 与 `make release-check`。
2. 打 tag 并推送：`git tag v0.1.0 && git push origin v0.1.0`。
3. `.github/workflows/release.yml` 依次构建前端、交叉编译、打包、计算 SHA-256。
4. 用 `gh release create` 发布；同名 release 已存在时改为覆盖上传。

需要重跑：

```bash
gh workflow run release.yml -f tag=v0.1.0
```

## 校验

```bash
sha256sum -c checksums.txt --ignore-missing
```

## 兼容性

- Go 1.24 以上构建。产物不依赖 libc，可在 Alpine 等最小镜像运行。
- 运行只依赖系统 `git`。
- 前端已 embed，不需要 `frontend/dist`、Node.js 或 pnpm。
