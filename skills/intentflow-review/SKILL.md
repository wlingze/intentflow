---
name: intentflow-review
description: Run a blocking human review for an agent. Start `intentflow review --wait --json`, give the URL to the user, then parse the submitted JSON and edit code from the line comments. Use when the user asks an agent to review a branch, a patch or a GitHub PR and wants a verdict plus line-level comments instead of a summary the agent invented.
---

# intentflow review（agent 审阅循环）

`intentflow review` 一次只做一件事：打开页面、等人提交、输出一份 JSON。
stdout 只有 JSON；URL 和日志在 stderr 与 `--ready-file`。

已经验证过的流程是 **后台启动 → 把 URL 给用户 → 结束本轮 → 用户提交后
再读结果**。不要在同一轮里阻塞等待，否则用户看不到 URL。

## 1. 检查命令

```bash
command -v intentflow
command -v jq
```

`intentflow` 没有输出就按 <https://github.com/wlingze/intentflow/releases/latest> 安装。
不要为了这个 skill 从源码构建。`jq` 没有就装一个；本文的解析示例都用它。

## 2. 启动（复制整段）

```bash
run_dir="${INTENTFLOW_RUN_DIR:-$(mktemp -d)}"
mkdir -p "$run_dir"
run_dir=$(cd "$run_dir" && pwd)
detach=""
command -v setsid >/dev/null 2>&1 && detach="setsid"

$detach nohup bash -c '
  intentflow review --wait --json \
    --base HEAD --head WORKTREE \
    --ready-file "$1/ready.json" \
    --timeout 45m --no-open \
    >"$1/result.json" 2>"$1/stderr.log"
  echo $? >"$1/exit-code"
' _ "$run_dir" >/dev/null 2>&1 &

echo "$run_dir" >"$run_dir/path.txt"
for _ in $(seq 1 300); do
  [ -s "$run_dir/ready.json" ] && break
  if [ -s "$run_dir/exit-code" ]; then
    cat "$run_dir/stderr.log" >&2
    cat "$run_dir/result.json" >&2
    exit 1
  fi
  sleep 0.2
done
url=$(jq -r .url "$run_dir/ready.json")
printf 'RUN_DIR=%s\nOPEN=%s\n' "$run_dir" "$url"
```

范围按需要替换：

```bash
--base HEAD --head WORKTREE     # agent 自己的未提交改动（推荐）
--base main --head HEAD         # 分支相对 main
--diff change.patch             # 一个 unified diff
--pr owner/repo#123             # GitHub PR（优先 gh，失败走公开 .diff）

`--head WORKTREE` 总是和 HEAD 比，不使用自定义 `--base`；要看分支提交
用 `--head HEAD`。
```

`--diff` / `--pr` 不能和 `--base`、`--head`、`--before`、`--after`、
`--rebase` 同用。

**启动后立刻在回复里给出 `OPEN=` 的 URL，并结束本轮。** 告诉用户：
看完 diff、写评论、选结论，然后点「提交并关闭」。不要在这期间改代码，
也不要猜评论。把 `RUN_DIR` 记在上下文里，下一轮要用。

如果 harness 会在工具调用结束后回收后台进程，示例里的 `setsid` 是关键；
没有 `setsid` 时先确认 `nohup` 起的进程还能存活。否则这个跨轮次模式
不成立，退回普通工作台 + Markdown 导出。

## 3. 等用户提交

用户说「提交了」后，读结果：

```bash
run_dir=<上一轮的 RUN_DIR>
for _ in $(seq 1 1800); do
  [ -s "$run_dir/exit-code" ] && break
  sleep 2
done
cat "$run_dir/result.json" | jq .
exit_code=$(cat "$run_dir/exit-code")
```

不要用 `wait`：后台进程可能不是当前 shell 的子进程。用 `exit-code`
或 `result.json` 判断结束。

## 4. 先看状态，再决定动作

```bash
r="$run_dir/result.json"
status=$(jq -r .status "$r")
verdict=$(jq -r '.verdict // ""' "$r")
```

| status | 退出码 | 你该做什么 |
| --- | --- | --- |
| `submitted` | 0 | 按 `verdict` 和 `comments` 行动 |
| `cancelled` / `user` | 2 | 用户取消；停下来问用户 |
| `cancelled` / `page-closed` | 2 | 页面关了；确认是否重开 |
| `cancelled` / `interrupted` | 130 | CLI 被中断；不要假装有结果 |
| `timeout` | 3 | 超时；问用户是否重开 |
| `error` | 1 | 读 stderr；不要编造评论 |

`verdict` 只有三个值：

- `approve`：不改代码，报告已通过。
- `request-changes`：按未解决评论修改。
- `comment`：可以只回复，也可按评论修改；以 `comments` 为准。

## 5. 解析评论（jq）

```bash
jq -r '.comments[]
  | select(.resolved == false)
  | "\(.file // "GENERAL"):\(.line // 0)-\(.end_line // 0) [\(.side // "-")] \(.body)"' "$r"
```

只要文件列表：

```bash
jq -r '.comments[] | select(.file != null) | .file' "$r" | sort -u
```

只要整体意见：

```bash
jq -r '.comments[] | select(.file == null) | .body' "$r"
```

判断是否通过：

```bash
jq -e '.status == "submitted" and .verdict == "approve"' "$r"
```

字段是固定的，空值写 `null`，`comments` 永远是数组：

```json
{
  "schema_version": 1,
  "status": "submitted",
  "verdict": "request-changes",
  "summary": "把 SQL 拼接改成参数化查询。",
  "comments": [{
    "id": "c-1",
    "body": "改成参数化查询。",
    "file": "store.go",
    "line": 7,
    "end_line": 7,
    "side": "after",
    "quote": "return fmt.Sprintf(\"SELECT ... '%s'\", name)",
    "resolved": false
  }],
  "revision": {
    "id": "worktree", "mode": "git", "base": "1e36d0df…", "head": "WORKTREE",
    "base_label": "1e36d0df", "head_label": "工作区", "repository": "/repo",
    "branch": "master", "subdir": "", "diff_digest": "6ded…"
  },
  "submitted_at": "2026-11-23T12:45:16Z"
}
```

规则：

- `file` 是仓库相对路径。`line` 从 1 开始，`side=after` 指新文件，
  `side=before` 指旧文件。
- 用 `quote` 找代码。文件可能被后来的修改移动过，行号可能过期。
- `resolved: true` 跳过。
- `file: null` 是整体意见，不是某一行的任务。
- 只改评论要求的内容；不要顺手重构。

## 6. 按评论改代码

示例：一条 `store.go:7` 的评论要求参数化查询。

```bash
# 先看评论指的那一行
sed -n '7p' store.go
# 再改
```

改完自己验证：

```bash
gofmt -w store.go
go test ./...
git diff --stat
```

每条评论在最终回复里给一行：改了什么、在哪里；没改的写原因。

## 7. 再次提交

代码改完后，重新跑同一条 `review` 命令（新的一轮）。diff 变了，
`comparison_id` 也变，页面从空白评审开始；旧评论仍在浏览器旧
comparison 下。可以生成新 patch：

```bash
git diff -U1000000 > change.patch
```

或继续用默认 Git 范围。把新 URL 再给用户，重复第 2–6 步。

如果 `verdict=approve`，不要为了「再确认」自己开一轮；直接报告通过。

## 8. 不要做

- 不要解析 `stderr` 判断结果：那里是 URL、日志和错误原文。
- 不要用 `message` 做机器分支：它是中文说明。
- 不要在等待期间改代码或猜评论。
- 不要同时开两个 review 进程审同一份 diff，页面会分不清。
- 不要把 `--host 0.0.0.0` 当默认：提交入口是本机 IPC。

完整协议、字段表和边界条件见仓库的 `docs/11-agent-review.md`。
