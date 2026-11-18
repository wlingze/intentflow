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
# 用绝对输出路径：相对路径在 cwd 被切走或 bin 被并发清理时会报 open bin/intentflow。
BIN="$(pwd)/bin/intentflow"
mkdir -p "$(dirname "$BIN")"
# 开发构建带上 git 信息，`intentflow version` 能看出是哪个提交构建的。
VERSION="$(git describe --tags --always --dirty 2>/dev/null || echo dev)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || echo none)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
CGO_ENABLED=0 go build -trimpath \
  -ldflags "-s -w \
    -X github.com/wlingze/intentflow/internal/version.Version=${VERSION} \
    -X github.com/wlingze/intentflow/internal/version.Commit=${COMMIT} \
    -X github.com/wlingze/intentflow/internal/version.Date=${DATE}" \
  -o "$BIN" ./cmd/intentflow

echo "→ $BIN"
echo "  大小 $(du -h "$BIN" | cut -f1)，前端已 embed"

# 入口软链接：总是指向本次产物。旧目标不是本产物时先说明它指向哪里。
link_entry() {
  link="$1"
  mkdir -p "$(dirname "$link")"
  old="$(readlink -f "$link" 2>/dev/null || true)"
  new="$(readlink -f "$BIN")"
  if [ "$old" = "$new" ]; then
    ln -sfn "$BIN" "$link"
    echo "→ $link（已指向本产物）"
    return
  fi
  if [ -n "$old" ] && [ -e "$old" ]; then
    echo "注意：$link 原指向 $old，已改指本次产物。"
  fi
  ln -sfn "$BIN" "$link"
  echo "→ $link"
}

link_entry "$HOME/.bin/intentflow"
link_entry "$HOME/.local/bin/intentflow"

if existing="$(command -v intentflow 2>/dev/null)"; then
  if [ "$(readlink -f "$existing")" != "$(readlink -f "$BIN")" ]; then
    echo
    echo "注意：PATH 入口 $existing 未指向本次产物，本次构建没有修改它。"
  fi
fi
