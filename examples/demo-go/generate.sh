#!/usr/bin/env bash
# 重新生成同一个 demo 的三份产物。
#
# 依赖：
#   - Go 1.22+
#   - PR Lens 仓库：$PR_LENS_DIR（默认 ~/Developer/project/pr-lens）
#   - Archify 仓库：$ARCHIFY_DIR（默认 ~/Developer/project/archify/archify）
#
# 这不是 intentflow 的构建脚本，只是 demo 的可复现入口。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DEMO="$ROOT/examples/demo-go"
OUT="$DEMO/out"
PR_LENS_DIR="${PR_LENS_DIR:-$HOME/Developer/project/pr-lens}"
ARCHIFY_DIR="${ARCHIFY_DIR:-$HOME/Developer/project/archify/archify}"

echo "== intentflow =="
cd "$ROOT"
go build -o bin/intentflow ./cmd/intentflow
./bin/intentflow diff --before examples/demo-go/before --after examples/demo-go/after --out examples/demo-go/out
if [ ! -f "$ROOT/frontend/dist/index.html" ]; then
  echo "前端产物不存在；先运行：cd frontend && pnpm install && pnpm build" >&2
fi

echo "== pr-lens =="
if [ -f "$PR_LENS_DIR/packages/cli/dist/bin.js" ]; then
  node "$PR_LENS_DIR/packages/cli/dist/bin.js" render "$DEMO/pr-lens/graph.json" -o "$OUT/pr-lens"
  for pair in architecture-light architecture-dark data-flow-light data-flow-dark; do
    src="$(find "$OUT/pr-lens" -maxdepth 1 -name "$pair-*.svg" | head -n 1)"
    if [ -n "$src" ]; then
      cp "$src" "$OUT/pr-lens/$pair.svg"
    fi
  done
  echo "→ $OUT/pr-lens/{architecture,data-flow}-{light,dark}.svg"
else
  echo "跳过：$PR_LENS_DIR 未构建（pnpm install && pnpm build）" >&2
fi

echo "== archify =="
if [ -f "$ARCHIFY_DIR/bin/archify.mjs" ]; then
  (cd "$ARCHIFY_DIR" && node bin/archify.mjs compare architecture \
    "$DEMO/archify/demo.base.architecture.json" \
    "$DEMO/archify/demo.head.architecture.json" \
    "$OUT/archify/index.html" --repo-root "$ROOT")
  echo "→ $OUT/archify/index.html"
else
  echo "跳过：$ARCHIFY_DIR 不存在" >&2
fi

echo
echo "打开工作台："
echo "  ./bin/intentflow serve --before examples/demo-go/before --after examples/demo-go/after --out examples/demo-go/out"
echo "  http://127.0.0.1:8123/"
echo
echo "打开三工具对比页（另开端口，iframe 指向 8123）："
echo "  python3 -m http.server 8124 --directory examples/demo-go"
echo "  http://127.0.0.1:8124/"
