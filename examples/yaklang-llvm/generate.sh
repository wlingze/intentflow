#!/usr/bin/env bash
set -euo pipefail

WORKTREE="${YAKLANG_WORKTREE:-$HOME/Developer/yaklang-workspace/feature-ssa2llvm-support_ci_and_mustpass_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"
SUBTREE="common/yak/ssa2llvm"

if [ ! -d "$WORKTREE/.git" ] && [ ! -f "$WORKTREE/.git" ]; then
  echo "找不到 yaklang worktree: $WORKTREE" >&2
  echo "设置 YAKLANG_WORKTREE 指向 feature-ssa2llvm-support_ci_and_mustpass_test" >&2
  exit 1
fi

mkdir -p "$HERE/before" "$HERE/after"
git -C "$WORKTREE" archive main "$SUBTREE" | tar -x -C "$HERE/before"
git -C "$WORKTREE" archive HEAD "$SUBTREE" | tar -x -C "$HERE/after"

echo "before: $(find "$HERE/before" -type f | wc -l) files"
echo "after:  $(find "$HERE/after" -type f | wc -l) files"
