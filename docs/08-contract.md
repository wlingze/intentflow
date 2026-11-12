# 数据契约

`schema/openapi.yaml` 是唯一事实来源。Go 和 TypeScript 类型都由它生成，不手写第二套。

## 1. 生成

```bash
make schema
```

- Go：`internal/contract/types.gen.go`（oapi-codegen）
- TypeScript：`frontend/src/api/schema.gen.ts`（openapi-typescript）

不要手改生成物。

## 2. Payload

`GET /api/payload` 返回一次比较的完整快照。

```text
Payload
├── review : Review
│   ├── before / after
│   ├── comparison : Comparison
│   └── notes : string[]
├── code : CodeBundle
│   ├── root
│   ├── files : CodeFile[]        # 只含改动文件
│   ├── truncated : bool
│   └── skipped : string[]
└── session : ReviewSession       # 当前范围的评审草稿
```

`Review` 仍保留早期语义分析的占位字段（`scan`、`findings`、`ai` 等）。当前版本固定为
`scan.status = skipped`，`findings = []`，前端不读取。

### CodeFile

```text
path / old_path? / status / language / before / after
```

`status` 为 `added | removed | modified | unchanged | renamed`。`renamed` 时
`old_path` 是改名前路径，`before` 与 `after` 分别是旧、新内容。
重命名优先取 `git diff -M`；目录比较与未跟踪文件按内容完全一致配对。
文本文件上限 2MB，
整次 payload 正文上限 24MB；预算按文件体积从小到大分配，避免大文件挤掉小文件。
超限文件保留路径和状态，正文为空，`code.truncated` 为 true。

### Comparison

```text
mode : folder | git
beforeLabel / afterLabel
repo? / subdir? / baseRef? / headRef?
commits : Commit[]
selected : string[]
note
```

目录比较只有 folder；Git 比较带仓库、子目录和 ref。

## 3. Revision

`GET /api/revisions` 返回顶部下拉框的选项。

```text
RevisionList
├── base / head / current
├── dirty : bool
└── revisions : Revision[]
    ├── id          # range | worktree | commit:<sha>
    ├── kind
    ├── label / sha / short / subject / author / date
    └── files : int
```

`GET /api/payload?revision=<id>` 切换范围。切换前若当前评审有未保存修改，前端先保存。

## 4. ReviewSession

一个“仓库 + 分支 + 子目录”对应一个 session。`session_id` 是该组合的稳定摘要；
`comparison_id` 额外包含 base/head/revision 和 diff 内容摘要。

```text
ReviewSession
├── version : 1
├── context : ReviewContext
│   ├── session_id / comparison_id
│   ├── repository / branch / subdir
│   ├── base / head / revision
│   └── diff_digest
├── comments : Comment[]
├── viewed : string[]             # <file>#<file digest>
├── reviewed_hunks : string[]     # <file>@<row>#<hunk digest>
└── updated_at : string
```

`Comment` 包含 `id/text/title/source/signalId/createdAt/quote/resolved`。
`quote` 是 `file/side/start/end/snippet`，可以省略：没有 `quote` 的条目是不绑定行号的意见。
图片以 Markdown 图片写进 `text`，内容内联为 data URL。

## 5. 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/api/payload` | 当前比较快照；`?revision=` 切换 |
| GET | `/api/revisions` | 比较范围列表 |

服务端只读。评审状态的保存、恢复和草稿列表都在浏览器里完成，
没有对应的写接口。

## 6. 必填策略

`ReviewSession` 和 `ReviewContext` 的字段均为必填，空数组表示“没有”。
`Comment.quote` 可选，因为评论可以不绑定行号；`resolved` 缺省为 false。

## 7. 兼容

已删除的 `/api/scan`、`/api/commits` 不再注册，返回 404。旧 `--mode scan|review`
明确报错。当前阶段没有扫描、SSA、AI 或数据库依赖。

`Review` 里的 `scan/findings/ai/symbols/behavior` 字段保留，供第二阶段接回事实层。
现在固定为 `skipped` 和空数组，前端不读取。

## 8. 导出文件

- `--out/review.json`：`intentflow diff` 写出的评审 JSON，字段与浏览器里的文档一致。
- 手动导出的 Markdown 把图片内联为 data URL，单个文件即可分享。
