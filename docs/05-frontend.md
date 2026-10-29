# 前端设计：intentflow review workbench

## 目标

把 intentflow 从「一次性静态报告」改成「可操作的 review 工作台」。

它要回答三件事，并且让人能在同一屏里完成：

1. **这次改动在语义上做了什么？** —— 中间的分支图。
2. **证据在哪？** —— 左侧目录树 + 代码抽屉（diff / 搜索）。
3. **我要怎么处理？** —— 右侧 SyntaxFlow 分诊 + Review 评论 + 底部输入框。

非目标：

- 不做通用 IDE。
- 不在前端做代码分析。分析仍由 Go 层（SSA + SyntaxFlow + go/ast）负责。
- 不做多人协作后端。评论存在浏览器里，导出给 agent / 人。

## 架构

```text
┌──────────────────────────────┐
│ Go: intentflow serve         │
│                              │
│  scan/diff  ──▶  Review      │
│  read files ──▶  CodeBundle  │
│         │                    │
│         ▼                    │
│  GET /api/payload            │
│  POST /api/review            │
│  static frontend/dist        │
└──────────────┬───────────────┘
               │ JSON
┌──────────────▼───────────────┐
│ React + TypeScript + Vite    │
│                              │
│  reducer state               │
│  ├─ review facts             │
│  ├─ comments / dismissed     │
│  ├─ graph selection          │
│  ├─ code drawer              │
│  └─ composer                 │
└──────────────────────────────┘
```

### 为什么前后端分开

- Go 只做分析，输出稳定 JSON；前端只做交互与呈现。
- 前端可以独立 `pnpm dev`，Vite 代理 `/api` 到 Go。
- 不需要把 HTML 塞进 Go 字符串，也不需要每次改 UI 都重编 277 MB 的二进制。
- 前端产物是 `frontend/dist`，Go 用 `http.FileServer` 直接托管，不做 embed。

### 数据契约

`GET /api/payload`：

```json
{
  "review": {
    "before": "examples/demo-go/before",
    "after": "examples/demo-go/after",
    "intent": { "added": [], "removed": [] },
    "logic": { "added": [], "removed": [] },
    "project": { "added": [], "removed": [] },
    "signals": [],
    "notes": []
  },
  "code": {
    "root": "examples/demo-go",
    "files": [
      {
        "path": "main.go",
        "status": "modified",
        "language": "go",
        "before": "...",
        "after": "..."
      }
    ],
    "truncated": false
  }
}
```

约束：

- `Fact.identity` 在两侧稳定；前端不重新计算 diff。
- `Fact.file` / `Fact.line` 是代码跳转的唯一依据。
- `Signal.evidence` 指向 `Fact.identity`，用于把告警挂到代码范围。
- `CodeFile.before/after` 是原始文本，前端只做展示与行级 diff。

`POST /api/review`：

```json
{ "markdown": "# Review ...", "data": { "comments": [], "dismissed": [] } }
```

服务端写到输出目录的 `review.md`，方便 agent 直接读。

## 页面结构

```text
┌──────────────────────────────────────────────────────────────┐
│ top bar: brand · stats · theme · 提交 Review ▾              │
├────────────┬─────────────────────────────────┬───────────────┤
│ 文件树     │ 意图流图                        │ SyntaxFlow    │
│ + 项目结构 │                                 │ / Review      │
│            │ 选中节点/边 → inspector         │               │
│            │                                 │ 评论卡片      │
├────────────┴─────────────────────────────────┴───────────────┤
│ composer: 引用 chip + 输入框 + 添加评论                      │
└──────────────────────────────────────────────────────────────┘
```

代码抽屉从右侧滑出，覆盖 Review 栏和部分图，但不遮住 composer：

```text
┌────────────┬──────────────────────────────┬───────────────┐
│ 文件树     │ 图                           │ ┌───────────┐ │
│            │                              │ │ 代码抽屉  │ │
│            │                              │ │ Diff/搜索 │ │
├────────────┴──────────────────────────────┴─┴───────────┴─┤
│ composer                                                    │
└─────────────────────────────────────────────────────────────┘
```

## 交互规格

### 左侧：文件与项目结构

- 目录树来自 `code.files`，按目录分组。
- 文件状态：`M` 修改、`A` 新增、`D` 删除。
- 每个文件显示 `+adds / −dels`。
- 「只看变更」默认开启；关闭后显示未变文件。
- 点击文件 → 打开代码抽屉的 Diff。
- 项目结构列出 `review.project` 的 import / func 增删；点击跳到 `file:line`。

### 中间：分支图

图不是「每条链一行」，而是一棵从入口分叉的树：

```text
                 HTTP 输入
                     │
                handleSearch
                ╱           ╲
          findUser        loadTemplate
             │                 │
        SQL 执行          文件读写
       direct / format      concat · env
```

布局：

- 第 0 列：来源（上方）与入口函数。
- 第 1..n 列：处理函数，按调用深度。
- 最后一列：副作用。
- 分支各占一行；入口行取分支行的中点，形成树形。
- 泳道：入口 / 处理 / 副作用。

节点：

- 圆角卡片，左侧类型标记 `IN` / `ƒ` / `OUT`。
- 标题 + 副标题（来源、形态、函数签名）。
- 右上角 delta 标记 `+` / `−` / `~`。
- 删除节点虚线边框。

边：

- 未变：灰线。
- 新增：绿线，带流动点。
- 移除：红虚线。
- 修改：琥珀色。
- 标签写「到达形态」：`direct` / `format` / `concat`。
- 非主来源显示在边上：`concat · env`。

交互：

- 悬停：高亮相邻边，显示 tooltip。
- 点击节点/边：inspector 显示证据；同时打开代码抽屉到对应 `file:line`。
- Inspector 两个按钮：**查看代码**、**添加评论**。
- 添加评论把 `file:line + snippet` 放进 composer 的引用 chip。

### 右侧：分诊与 Review

两个 tab：

**SyntaxFlow 结果**

- 每条信号：severity、标题、detail、文件范围、可信度。
- 两个动作：
  - `认为没事` → 标记 dismissed；进入「已忽略」折叠区，可撤销。
  - `保留到 Review` → 生成一条 review 评论，切到 Review tab。
- 已保留的信号显示 `已保留`，避免重复操作。

**Review 信息**

- 每条评论：来源（信号/手动）、时间、文件范围、引用代码、正文。
- `修改`：正文变 textarea，保存/取消。
- `删除`：立即删除。
- 点击文件范围 → 打开代码抽屉。

### 底部：composer

- 引用 chip：`file:12-14 · after` + 代码片段，可移除。
- 输入框：Enter 提交，Shift+Enter 换行。
- `添加评论`：写入 Review，清空 composer，切到 Review tab。
- 提示：选中代码或点击图节点可加引用。

### 代码抽屉

**Diff**

- 默认分栏：左 before，右 after。
- 每行：行号 + 高亮代码；新增绿底、删除红底。
- 统一视图可切换。
- 目标行高亮并滚动到视野。
- 语法高亮：Go 关键字、字符串、注释、数字。

**搜索**

- 输入即搜，范围是 before + after 所有文件。
- 结果按文件分组：路径、side、行号、上下文、命中高亮。
- 点击结果 → 回到 Diff 并跳到该行。

**选中加评论**

- 在代码上选中文本，浮出 `添加评论`（Cursor 的 Add to Chat 形态）。
- 点击后把 `file:start-end + 选中文本` 放进 composer。
- 抽屉保持打开；composer 始终可写。

### 提交 Review

右上角 `提交 Review ▾`：

1. **提交给 Agent**：生成 markdown，`POST /api/review` 写入 `review.md`，同时复制到剪贴板。
2. **复制 Markdown**：只复制。
3. **保存 .md 文件**：浏览器下载。

Markdown 结构：

```markdown
# Review: before → after

## Review 意见

### 1. main.go:14
> 引用代码
评论正文

## 已忽略的 SyntaxFlow 告警
- ...
```

## 状态与持久化

Reducer 状态：

```ts
{
  payload, loading, error,
  rightTab: 'signals' | 'review',
  selected: { kind, id } | null,
  comments: Comment[],
  dismissed: string[],
  kept: string[],
  composer: { quote, text },
  drawer: { open, files, active, mode, layout, line, side, search },
  onlyChanged: boolean
}
```

持久化：

- key：`intentflow.review:<before>-><after>`
- value：`{ comments, dismissed, kept }`
- localStorage 失败时静默降级（隐私模式）。

## 组件地图

```text
App
├─ TopBar
│  ├─ ThemeSwitch
│  └─ SubmitMenu
├─ FileTree
│  └─ ProjectFacts
├─ GraphView
│  ├─ GraphCanvas (SVG)
│  └─ GraphInspector
├─ ReviewPanel
│  ├─ TabBar
│  ├─ SignalList
│  └─ ReviewList
├─ Composer
├─ CodeDrawer
│  ├─ FileTabs
│  ├─ DiffView
│  └─ SearchView
└─ Toast
```

纯函数库：

```text
lib/diff.ts        LCS 行 diff
lib/graph.ts       事实 → 分支图模型 + 布局
lib/highlight.ts   Go 语法高亮
lib/search.ts      跨文件搜索
lib/markdown.ts    review / agent prompt
lib/format.ts      状态、时间、路径
```

有测试的纯函数：diff、graph、markdown、search。

## 视觉方向

参考 Archify 的「signal-flow」：

- 深色底：近黑的蓝灰，细网格，面板分层。
- 大面积留白，卡片圆角 10–12px。
- 主色：teal / green（新增）、red（移除）、amber（变化）。
- 标题用无衬线，代码和标签用等宽。
- 泳道用低对比底色 + 虚线边框。
- 动效只用于边上的流动点；尊重 `prefers-reduced-motion`。

浅色主题用暖纸色，不直接反色；保持同一套语义色。

## 构建与运行

```bash
# 前端
cd frontend
pnpm install
pnpm dev          # Vite :5173，/api 代理到 :8123

# 后端
go build -o bin/intentflow ./cmd/intentflow
./bin/intentflow serve \
  --before examples/demo-go/before \
  --after  examples/demo-go/after \
  --port 8123 \
  --frontend frontend/dist
```

生产：`pnpm build` 后由 Go 托管 `frontend/dist`。
开发：Go 提供 API，Vite 提供热更新。

## 下一步

1. 把 `review.logic` 的调用边补全，图可以覆盖更深的跨函数链。
2. 评论导出增加 JSON schema，方便 agent 逐条回复。
3. 代码抽屉接 LSP / 语法树，做真正的跳转与符号搜索。
4. 多文件 diff 的虚拟滚动；大仓库只加载变更文件。
