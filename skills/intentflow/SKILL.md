---
name: intentflow
description: Review a local Git diff with intentflow and act on the human's line comments. Use when the user asks to review changes, a branch, a commit range or uncommitted work, or wants line-level notes instead of a summary.
---

# intentflow

A local diff workbench. The human reads the diff and writes comments in the
browser; you get one Markdown block back. Nothing is sent anywhere: the review
lives in their browser.

For an agent-driven blocking review, use the sibling skill
[`intentflow-review`](../intentflow-review/SKILL.md) instead: it runs
`intentflow review --wait --json`, hands the URL to the user, and returns a
stable JSON document with a verdict and line comments.

## When to use

- "review my changes", "review this branch", "check the diff before I commit"
- the user wants notes on specific lines, not a summary you invent

Do not use it to summarise code the user did not ask to review.

## 0. Install it if it is missing

```bash
command -v intentflow
```

Nothing printed means it is missing. Use the platform installer; it reads the
latest release, checks the SHA-256, installs to the default directory and runs
the installed binary with `--version`. Do not build from source unless the user
asks: `make build` needs Go and Node, the release asset does not.

macOS / Linux (default `/usr/local/bin/intentflow`, needs `sudo` only for that
directory; set `INTENTFLOW_INSTALL_DIR="$HOME/.local/bin"` for a user install):

```bash
installer=$(curl -fsSL https://wlingze.github.io/intentflow/install.sh) &&
  sh -c "$installer"
```

Windows, in PowerShell 5.1 or 7 (default
`%LOCALAPPDATA%\intentflow\bin\intentflow.exe`, no admin rights, adds the
directory to the user `Path`):

```powershell
& ([scriptblock]::Create((curl.exe -fsSL https://wlingze.github.io/intentflow/install.ps1 | Out-String)))
```

Both read `HTTPS_PROXY` / `HTTP_PROXY`.

## 1. Start it

Run inside the repository under review:

```bash
intentflow --no-open
```

It prints the workbench URL and keeps serving until you stop it. Give that
URL to the user; do not open a browser yourself and do not start a second
process.

Ranges:

| want | flag |
| --- | --- |
| branch against main | `--base main` |
| uncommitted and untracked files | `--head WORKTREE` |
| one commit | `--base <sha>~1 --head <sha>` |
| two directories, no Git | `--before ./a --after ./b` |

With no `--base`, it picks the nearest `git merge-base HEAD <ref>` among
main / master / origin/main / origin/master. The branch does not need to be a
descendant of main. If none exist it tries `origin/HEAD` and the branch
upstream, then asks for `--base`. Add `--rebase` only when the user asks to
move the branch; conflicts are aborted automatically and the merge-base range
still starts.

## 2. Wait for the review

The review is written in the browser. Ask the user to open the Submit menu and
either paste the Markdown block or save it (`intentflow-review-<time>.md`) and
give you the path.

Never invent comments and never review the code while waiting. Until they paste
a review you have nothing to act on.

## 3. Act on the review

The paste looks like this:

```
# Review: examples/demo-go/before → examples/demo-go/after

仓库：demo-go
分支：-
比较：目录比较 · <base12> → <head12>

## Review 意见

### 1. internal/store/store.go:15 · 改动后

> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%s%'", name)

用户输入直接拼进了 SQL。改成参数化查询。

### 2. 整体意见

这次改动把参数化查询换成字符串拼接，建议整体退回。
```

Rules:

- Each `###` block is one task. The heading carries the path, the line or range,
  and the side (`改动前` = before, `改动后` = after).
- The quoted `>` lines are the code the comment refers to. Use them, not the
  current file, to find the location: the file may have moved since the export.
- `（已解决）` in a heading means the user resolved it. Skip it.
- `## 重点位置` lists flagged positions; `## 运行说明` is context, not a task.

Answer with one short report per entry: what you changed and where, or why you
did not.

## Non-interactive

```bash
intentflow diff --before ./a --after ./b --out ./review-out
```

writes `review.json` under that directory. It holds the comparison payload
(files, hunks, facts); `comments` is empty, because comments are typed in the
browser. Use it to inspect a comparison, not as a shortcut around step 2.

## What not to claim

The tool shows a text diff and a review store. It does not run an analysis pass:
no SSA facts, no behaviour graph, no LLM summary. Do not describe it as doing
those, and do not tell the user their code was scanned.