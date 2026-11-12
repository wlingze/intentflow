#!/usr/bin/env bash
# 构建单个可执行文件：前端产物 embed 进 Go 二进制。
set -euo pipefail

cd "$(dirname "$0")/.."

if ! command -v pnpm >/dev/null 2>&1; then
  echo "需要 pnpm：https://pnpm.io/installation" >&2
  exit 1
fi

if [ ! -d frontend/node_modules ]; then
  (cd frontend && pnpm install)
fi

echo "· 构建前端"
(cd frontend && pnpm build)
touch frontend/dist/.gitkeep

echo "· 构建二进制"
mkdir -p bin
# 开发构建带上 git 信息，`intentflow version` 能看出是哪个提交构建的。
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/wlingze/intentflow/internal/version.Version=${VERSION} \
    -X github.com/wlingze/intentflow/internal/version.Commit=${COMMIT} \
    -X github.com/wlingze/intentflow/internal/version.Date=${DATE}" \
  -o bin/intentflow ./cmd/intentflow

BIN="$(pwd)/bin/intentflow"
echo "→ $BIN"
echo "  大小 $(du -h "$BIN" | cut -f1)，前端已 embed"

# 构建不修改 PATH 中的文件，也不替换用户的软链接。
if existing="$(command -v intentflow 2>/dev/null)"; then
  if [ "$(readlink -f "$existing")" != "$(readlink -f "$BIN")" ]; then
    echo
    echo "注意：PATH 入口 $existing 未指向本次产物。"
    echo "      本次构建没有修改它，请运行 $BIN。"
    echo "      如需关联入口：ln -sfn \"$BIN\" \"$HOME/.local/bin/intentflow\""
  fi
fi
