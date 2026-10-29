# 同一个 demo 的四种回答

## 结论先行

同一个改动，四个工具的答案不在同一层：

| 工具 | 这次回答的问题 | 这次抓到的关键事实 |
|---|---|---|
| intentflow | 数据流在语义上怎么变了 | `http_input → SQL` 的到达形态从 `direct` 变成 `format` |
| PR Lens | 把这次改动讲给人看 | 架构上的 changed / new / removed；一条数据流时序 |
| Archify | 两份架构快照差在哪 | 3 个组件新增、1 个变化；4 条连接新增、1 条移除 |
| graphify | 整个仓库里有什么、怎么连 | 概念图与调用边；不回答「这次 PR 的形态变化」 |

一句话：**intentflow 算事实，PR Lens 讲故事，Archify 比快照，graphify 建地图。**

## Demo

`examples/demo-go` 的改动：

```go
// before
db.QueryRow("SELECT id FROM users WHERE name = ?", name)

// after
query := fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%%%s%%'", name)
rows, err := db.Query(query)

base := os.Getenv("APP_HOME")
os.ReadFile(base + "/templates/search.html")
```

关键不是「QueryRow 换成了 Query」。关键是：

- SQL 的到达形态从**参数化直传**变成**格式化拼接**；
- 新增一条 `env → 文件读写` 的链路。

## 四个工具的输出

### intentflow

```text
意图层 ±2/1   逻辑层 ±7/2   项目层 ±4/0   关注点 5
```

意图层：

| 方向 | 事实 | 来源 | 形态 | 可信度 |
|---|---|---|---|---|
| ADDED | `handleSearch → findUser → SQL` | `http_input` | `format` | DERIVED |
| ADDED | `loadTemplate → 文件读写` | `env` | `concat` | DERIVED |
| REMOVED | `handleSearch → findUser → SQL` | `http_input` | `direct` | DERIVED |

身份键是 `函数 | 副作用类别 | 来源类别 | 到达形态`。少了最后的 `shape`，这次 diff 会报 ±0/0。

输出：`review.json`（三层事实 + 行为图）+ 交互工作台（`intentflow serve`）。

### PR Lens

输入是手写的 graph document：`examples/demo-go/pr-lens/graph.json`。
3 条泳道、7 个节点、7 条边、1 条 flow。渲染出 4 个自包含 SVG：

```text
out/pr-lens/
├── architecture-light.svg
├── architecture-dark.svg
├── data-flow-light.svg
└── data-flow-dark.svg
```

图上能直接看到 `findUser` 标 `CHANGED`、`loadTemplate` 标 `NEW`、`QueryRow(?, name)` 是红色虚线、`Query(fmt.Sprintf LIKE)` 是绿色实线。

注意：PR Lens 的 `render` 不调用模型。它只负责把文档画成图；文档可以由 `analyze` 用 LLM 生成，也可以手写。这次为了可复现，手写。

### Archify

输入是两份 architecture JSON：

```text
examples/demo-go/archify/demo.base.architecture.json
examples/demo-go/archify/demo.head.architecture.json
```

`archify compare architecture` 输出交互式 HTML：

```text
components:  +3  ~1  -0
connections: +4  ~0  -1
checks: 28/28
```

页面上可以在 `Before / Delta / After` 之间切换，点组件看字段级变化。它比较的是稳定 id 下的语义字段、证据字段、几何字段；不是文本 diff。

### graphify

graphify 是这四条路里最“重”的一条，但不是 diff 工具。

它的管线：

```text
detect → extract → build → cluster → analyze → report → export
```

- 代码用 tree-sitter AST 抽取，确定性、本地、不调用 LLM；
- 文档、PDF、图片、视频走语义抽取；
- 结果是 NetworkX 图，边标 `EXTRACTED` / `INFERRED` / `AMBIGUOUS`；
- 导出 `graph.html`（力导向可交互图）、`graph.json`、`GRAPH_REPORT.md`，以及 Obsidian / GraphML / Cypher / SVG。

它明确不是向量索引：没有 embedding，没有 vector store，靠图遍历。

它和这次 demo 的关系：

- 能找到 `handleSearch`、`findUser`、`db.Query` 这些节点和调用边；
- 但它的边是 `calls` / `imports` / `uses`，不编码「参数化还是拼接」；
- 它有一次性的 `graph_diff(G_old, G_new)`，但身份靠节点 id；改文件名或重命名会产生大量误报（前一轮实验已记录）。

所以 graphify 适合回答「这个仓库里有什么」，不适合回答「这次改动的语义形态变了吗」。

## 方法差异

### intentflow：先算事实

- L3/L2：SSA 索引文件、函数、调用边与分支。
- L1：yaklang SSA 编译，SyntaxFlow 查询 sink，`GetTopDefs()` 回溯来源。
- 规则派生 `shape`（`direct` / `format` / `concat` / …），写进身份键。
- 每条事实标可信度；意图层不允许标 `EXTRACTED`。

优点：可复现，能抓到「参数化 → 拼接」这种文本 diff 看不见的变化。
边界：只支持 Go；yaklang Go 前端缺标准库签名，类型级精度受限。

### PR Lens：把文档画到极致

- graph document 是严格 schema，未知字段直接拒绝。
- 布局是确定性的：深度、lane 顺序、文本测量表、坐标取整。
- 输出自包含 SVG，动画用 SMIL，能直接放进 GitHub 评论。
- `atlas` 提供每个节点/边的坐标，供 walkthrough 高亮。

优点：review 体验最好，明暗双版，逐步讲解。
边界：它不分析代码；图的内容取决于文档作者（人或 LLM）。

### Archify：快照对快照

- 输入是 JSON-IR，组件/连接/边界都有稳定 id。
- `compare` 先规范化，再按字段分组比较：拓扑、语义、证据、几何、范围。
- 输出不是一张静态图，而是一个可切换 Before / Delta / After 的页面。

优点：架构级 delta 很清楚，适合方案评审和重构前后对比。
边界：需要两份高质量快照；语义由作者定义。

### graphify：全仓库知识图谱

- 代码层 tree-sitter，确定性；非代码层语义抽取。
- 图是持久的，可以反复查询、找路径、找社区。
- 置信度标签和 intentflow 的思路一致：区分「读出来的」和「推出来的」。

优点：项目级导航、跨文件关系、比 grep 更结构化的检索。
边界：不是改动级 diff；不编码数据流形态；重命名敏感。

## 组合方式

这次实验最明确的结论：**它们不是替代关系，是流水线关系。**

```text
intentflow 算出事实
        │
        ├──▶ graph document ──▶ PR Lens     （给人看的架构 / 数据流）
        │
        └──▶ base/head JSON ──▶ Archify     （给评审看的架构 delta）
```

intentflow 负责「事实从哪来」；PR Lens / Archify 负责「事实怎么被看见」。
本轮已经把意图链投影成行为图（触发/判定/变换/效果），并在工作台里与代码、评论联动；
PR Lens 的 graph document 仍可作为另一种导出格式。

## 复现

```bash
./examples/demo-go/generate.sh
```

依赖：

- Go 1.22+
- `$PR_LENS_DIR`，默认 `~/Developer/project/pr-lens`，需要先 `pnpm install && pnpm build`
- `$ARCHIFY_DIR`，默认 `~/Developer/project/archify/archify`

对比页：

```bash
python3 -m http.server 8123 --bind 0.0.0.0 \
  --directory examples/demo-go
```

打开 `http://192.168.5.6:8123/`。
