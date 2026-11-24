# Agent 命令行审阅模式：协议与设计

配套 skill：[`skills/intentflow-review/SKILL.md`](../skills/intentflow-review/SKILL.md)。
本文是协议；skill 是 agent 的可复制步骤。

`intentflow review` 把工作台变成一个**阻塞式审阅请求**：

1. agent 启动命令，同时拿到页面 URL。
2. 人打开页面看 diff、写评论、选结论，点「提交并关闭」。
3. 命令结束，stdout 只输出一份 JSON。agent 按 JSON 改代码。

这个模式只服务 agent 调用。普通工作台 `intentflow` / `intentflow serve`
保持不变：页面里的评审仍存 localStorage，服务端不落盘。

`review` 的 stdout 只输出结果：加 `--json` 是一份 JSON，不加是 Markdown。
URL、进度和错误都去 stderr 或 ready 文件。

## 1. 命令

```bash
intentflow review --wait --json [--diff <patch>|--pr <owner/repo#N>] [flags]
```

| flag | 默认值 | 说明 |
| --- | --- | --- |
| `--wait` | 开 | 显式等待；`review` 总是等待，`--wait=false` 报错 |
| `--json` | 关 | stdout 只输出一份结果 JSON；人类日志全部去 stderr |
| `--diff <path>` | - | 审阅一个 unified diff；`-` 表示 stdin |
| `--pr <ref>` | - | 拉取 GitHub PR 的 patch；支持 `owner/repo#N` 和 PR URL |
| `--ready-file <path>` | - | 监听成功后原子写入 `ready` JSON，供 agent 取 URL |
| `--timeout <dur>` | `30m` | 总等待上限；`0` 表示不超时 |
| `--host` | `127.0.0.1` | 默认只监听本机；`0.0.0.0` 会暴露到局域网 |
| `--port` | `0` | 0 由内核分配 |
| `--no-open` | 关 | 不尝试打开浏览器 |
| `--base` / `--head` | 自动 | 不指定 `--diff` / `--pr` 时按 Git 范围比较 |
| `--before` / `--after` | - | 按目录比较，仍可进入审阅模式 |

`--diff` / `--pr` 与 Git 范围参数不能同时使用：

- `--diff` 不能和 `--base`、`--head`、`--before`、`--after`、`--rebase` 同用。
- `--pr` 不能和 `--diff`、`--base`、`--head`、`--before`、`--after`、
  `--rebase` 同用。

### ready 文件

监听成功后写一次，权限 `0600`，先写临时文件再 rename：

```json
{
  "schema_version": 1,
  "url": "http://127.0.0.1:43121",
  "port": 43121,
  "pid": 74213,
  "session_id": "3f2a…",
  "comparison_id": "9c81…"
}
```

agent 的后台流程是：

```bash
intentflow review --wait --json ... --ready-file "$run/ready.json" \
  >"$run/result.json" 2>"$run/stderr.log" &
pid=$!
# 轮询 ready.json，拿到 URL，交给用户
# 同一 shell 里可以 wait "$pid"；跨工具调用时轮询 result.json 或 exit-code
wait "$pid"
jq . "$run/result.json"
```

ready 之前 stdout 必须是空的。两种模式下 URL、日志和错误都只写 ready 文件或 stderr。

## 2. 结果 JSON（schema_version = 1）

stdout 只有这一份文档。字段固定，**所有键始终存在**；缺失值写 `null`，
`comments` 始终是数组。只输出未解决评论，且不带 `id`、`quote`、`resolved`：
这些字段只服务页面和人类 Markdown。机器可校验的 schema：
[`schema/review-result.schema.json`](../schema/review-result.schema.json)。

```json
{
  "schema_version": 1,
  "status": "submitted",
  "reason": null,
  "verdict": "request-changes",
  "summary": "把 SQL 拼接改成参数化查询。",
  "comments": [
    {
      "file": "internal/store/store.go",
      "line": 15,
      "end_line": 15,
      "side": "after",
      "body": "用户输入直接拼进了 SQL，改成参数化查询。"
    },
    {
      "file": null,
      "line": null,
      "end_line": null,
      "side": null,
      "body": "整体建议退回这版。"
    }
  ],
  "revision": {
    "id": "range",
    "base": "a1b2c3d4e5f6…",
    "head": "9f8e7d6c5b4a…"
  }
}
```

### 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `schema_version` | int | 固定 `1`。字段变化时递增 |
| `status` | string | `submitted` / `cancelled` / `timeout` / `error` |
| `reason` | string\|null | 见状态表；`submitted` 为 `null` |
| `verdict` | string\|null | `approve` / `request-changes` / `comment` |
| `summary` | string\|null | 页面里的总结，可为空串 |
| `comments` | array | 未解决评论；已解决的不输出 |
| `revision` | object\|null | 本次比较身份；早期错误可能为 `null` |

`comments[]`：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `file` | string\|null | 仓库相对路径；整体意见为 `null` |
| `line` | int\|null | 1 起行号 |
| `end_line` | int\|null | 区间末行；单行为 `line` |
| `side` | string\|null | `before` / `after` |
| `body` | string | 评论正文，非空 |

`revision`：

| 字段 | 说明 |
| --- | --- |
| `id` | `range` / `worktree` / `commit:<sha>` / `patch` / `pr:<owner/repo#N>` |
| `base` / `head` | commit SHA；PR 来自 `gh pr view`，format-patch 取 `From`；未知为空串 |

结果不包含仓库路径、分支、标签、session、comparison 或 diff 摘要。
要定位代码，用 `file` 和 `line`；要确认范围，用 `revision.id/base/head`。

### 非 JSON 输出

不加 `--json` 时，提交成功打印完整 Markdown，而不是一行状态：

```markdown
# Review: a1b2c3d4 → 工作区

仓库：/home/me/repo
分支：feature/store
比较：range · a1b2c3d4e5f6 → 9f8e7d6c5b4a

## 结论

**request-changes**（要求修改）

把 SQL 拼接改成参数化查询。

## Review 意见

### 1. internal/store/store.go:15 · 改动后

> query = fmt.Sprintf("SELECT ... '%s'", name)

用户输入直接拼进了 SQL，改成参数化查询。

### 2. 整体意见

整体建议退回这版。
```

已解决评论不出现在 Markdown；`quote` 只在这里出现。取消、超时和错误
仍打印一行人类说明；错误原文同时在 stderr。

### 状态与退出码

| status | reason | 退出码 | 含义 |
| --- | --- | --- | --- |
| `submitted` | `null` | `0` | 用户提交；解析 `verdict/comments` |
| `cancelled` | `user` | `2` | 用户点「取消审阅」 |
| `cancelled` | `page-closed` | `2` | 页面全部关闭，超过宽限期 |
| `cancelled` | `interrupted` | `130` | CLI 收到 SIGINT / SIGTERM |
| `timeout` | `timeout` | `3` | 超过 `--timeout` |
| `error` | `usage` / `git` / `patch` / `pr` / `listen` / `internal` | `1` | 启动或运行失败 |

`--json` 错误也写同一份 envelope，然后以对应退出码结束；错误原文同时在
stderr。非 `--json` 模式只写人类文本，退出码相同。

### 不可违反的约束

- `--json` 下 stdout 只有一个 JSON 文档，前后没有横幅、进度行或 URL。
- URL、日志、`gh`/HTTP 错误都走 stderr 或 ready 文件。
- 字段名不随状态变化；不要按 Markdown 文案判断分支。
- `comments` 顺序与页面一致；已解决评论不出现，`quote` 不在 JSON 里。

## 3. 页面提交协议

页面只在 `review` 模式显示提交入口：右上角「提交 Review」菜单里有结论、总结、「取消审阅」和「提交并关闭」。普通工作台不显示，也不注册接口。

`POST /api/submission`：

```json
{
  "action": "submit",
  "comparison_id": "9c81…",
  "verdict": "request-changes",
  "summary": "把 SQL 拼接改成参数化查询。",
  "comments": [
    {
      "id": "c-3f9a",
      "body": "用户输入直接拼进了 SQL，改成参数化查询。",
      "file": "internal/store/store.go",
      "line": 15,
      "end_line": 15,
      "side": "after",
      "quote": "query = fmt.Sprintf(...)",
      "resolved": false
    }
  ]
}
```

请求里的 `id`、`quote`、`resolved` 只用于页面和人类 Markdown；结果 JSON
不输出这三项。取消：

```json
{ "action": "cancel", "comparison_id": "9c81…" }
```

成功响应：

```json
{ "status": "submitted" }
```

页面收到成功响应后尝试 `window.close()`。浏览器通常只允许脚本关闭自己
打开的标签页，所以这个调用可能被拒绝；被拒绝时页面切换成「审阅已提交」，
提示用户可以关闭页面。提交和解锁以 POST 成功为准，不依赖页面是否真的关闭。

校验规则：

- `comparison_id` 必须等于当前 payload 的 `session.context.comparison_id`，
  否则 `409`。页面切换过范围时必须刷新。
- `verdict` 必须是三个值之一。
- 评论正文去空白后必须非空；`body` 最长 64 KiB，评论最多 1000 条。
- 有 `file` 时 `line` 必须 ≥ 1，`end_line` 必须 ≥ `line`；无 `file` 时三者
  必须同时为空。
- 同一进程只接受一次提交或取消；第二次返回 `409`。

### 页面关闭检测

页面用 `EventSource` 连接 `GET /api/events`。服务端统计在线页面：

- 第一个页面连上后才开始跟踪在线数。
- 连接全部断开后等 5 秒；期间重连（刷新）就取消定时器。
- 5 秒后仍无连接、且没有提交，则以 `reason=page-closed` 结束。

这解决「用户直接关标签页，CLI 永远不退出」的问题。浏览器休眠导致的
长连接断开也会触发；5 秒宽限只覆盖刷新。

## 4. diff 输入

### Git 范围（默认）

与普通工作台相同：`--base` 自动取 merge-base，`--head WORKTREE` 含未提交
改动。`revision.id` 是 `range` / `worktree` / `commit:<sha>`。

`--head WORKTREE` 总是和 HEAD 比，不使用自定义 `--base`；要审「分支相对
main」的提交，用 `--head HEAD`。review 模式不提供范围切换，一次只审一个
范围。

### `--diff <patch>`

支持 `git diff`、`git format-patch`、GitHub `.diff` 一类 unified diff：

- 多个文件、多 hunk、新增、删除、重命名、带引号路径。
- `index a..b` 是** blob 哈希**，不是 commit；不写入 `revision.base/head`。
- `git format-patch` 首行 `From <commit>` 写入 `revision.head`；`base` 未知，
  留空串。
- 二进制补丁跳过，并在 `review.notes` 与 `code.skipped` 里记录。

patch 不一定包含完整文件。页面用 hunk 行号定位：缺失的未改区域用空行补齐，
行号与真实文件一致；页面本来就会折叠未改行。局限是展开这些空行时没有
原始内容。需要完整上下文时，先 `git diff -U1000000 > change.patch`。

### `--pr <owner/repo#N>`

1. 优先 `gh pr diff N --repo owner/repo`；私有库需要先 `gh auth login`。
2. `gh` 不可用或失败时，GET `https://github.com/owner/repo/pull/N.diff`。
3. `gh pr view --json ...` 可取到 base/head ref 与 commit SHA 时写入
   `revision`；取不到时 SHA 留空串，只用 ref 作标签。不要拿 patch 的
   `index` 冒充 commit。

PR patch 同样只含 hunk 上下文，行号规则与 `--diff` 相同。

## 5. agent 循环

```text
agent                          CLI                         human
  |  review --wait --json         |                            |
  |----------------------------->|                            |
  |  ready.json {url}            |                            |
  |<-----------------------------|  http://127.0.0.1:43121      |
  |  tell user the URL           |--------------------------->|
  |                              |<---- EventSource ----------|
  |                              |<---- POST /api/submission --|
  |  result.json {status...}     |                            |
  |<-----------------------------|                            |
  |  edit files per comments     |                            |
  |  run review again            |                            |
```

再次提交就是重新跑同一条命令。完整可复制示例（启动、ready、jq、按评论
改文件、再次提交）见 skill。新一轮 diff 变化后 `comparison_id` 变化，
页面从空白评审开始；旧评论仍留在浏览器 localStorage 的旧 comparison 下。
如果 diff 没变，页面会读回上一轮评论，agent 需要提醒用户先清理已解决项。

## 6. 验证

```bash
make check
make build
NODE_PATH=<playwright> node scripts/e2e/review.mjs ./bin/intentflow
```

`make e2e-review` 是同一件事的 make 目标。它启动真实浏览器，打开右上角
「提交 Review」菜单，检查「提交并关闭」按钮、POST、CLI JSON 和退出码。

## 7. 不做什么

- 不把评审写进仓库，不写数据库。
- 不执行被审阅代码。
- 不自动改代码：agent 收到 JSON 后自己决定。
- `--json` 的 stdout 不混 Markdown；非 JSON 模式的 stdout 是 Markdown。
- 不把 `--host 0.0.0.0` 当默认值：提交通道是本机 IPC，不是网络服务。
