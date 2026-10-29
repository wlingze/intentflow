# 相关项目盘点

六个项目都在解决同一个问题：**程序员（和 Agent）写的代码，别人看不懂 / 不可控。**

分野在于**谁做分析**。

## 一览

| 项目 | 形态 | 输入 | 谁做分析 | 结构约束 | 输出 | 语义可验证 |
|---|---|---|---|---|---|---|
| ub-mode | Agent Skill | 无 | Agent 自己 | 无（纯提示词） | 代码 | 否 |
| desloppify | Python CLI | 源码 | 外部 linter + 宿主 LLM | 状态机 + 双分计分 | 队列 + 分数 | 部分 |
| pr-lens | TS CLI + GitHub App | Agent 写的 JSON | **LLM** | Zod schema | 动画 SVG | 否 |
| archify | Node CLI | Agent 写的 JSON | **LLM** | JSON Schema + 行号存在性 | 交互 HTML | 否 |
| graphify | Python CLI | 项目全量 | tree-sitter（代码）/ LLM（文档） | 图 schema + 可信度标注 | graph.html / JSON | **代码部分可** |
| **intentflow** | Go CLI + Web | git diff | **SSA + SyntaxFlow + LLM** | 三层模型 + 可信度标注 | review.json + Web | **事实可** |

## 逐个说明

### ub-mode（unclebob）

Robert C. Martin 的编码纪律 Skill。整个仓库只有 `README.md` + `SKILL.md`（3.9 KB）。

三阶段：First Make it Work / Then Make it Right / Follow Practice。

配套三个独立仓库：
- `crapper` — CRAP 分数（复杂度² × (1-覆盖率)³ + 复杂度），支持 Clojure/Java/Go/TS/Rust/Python
- `dryer` — 结构重复检测，Jaccard 相似度，阈值 0.82
- `mutator` — 变异测试，要求 `crapper` 必须 checkout 在 `../crapper`

**有价值的只有两条**，都针对 LLM 的真实失败模式：
- *Subtract Before You Add* — 防「越修越乱」
- *Attack the Premise* — 同一前提的两个修复都失败时，删掉前提而不是再修第三次

**问题**：纯提示词，零验证。SKILL.md 只写「Use the crapper tool」，没写装法跑法。真正有约束力的部分不在这个仓库里。

**对本项目的价值**：`Attack the Premise` 值得抄进 AGENTS.md。其余不留。

### desloppify

26.4 万行 Python，`dependencies = []`。PyPI 包 `desloppify[full]`，OSNL-0.2 协议（非常规开源，商用需自读）。

流程：`scan → score → review → triage → execute → rescan`

**它自己不调用 LLM。** 全仓库无 openai/anthropic SDK 依赖。所谓 review 是：
```
CLI 生成 review packet（prompt + 代码上下文）
  → spawn 外部 agent CLI 子进程（codex / opencode / acli rovodev）
  → agent 写回 JSON
  → desloppify import 回来计分
```
见 `runner_opencode.py` / `runner_rovodev.py` / `review/importing/`。

分析靠：通用检测器（复杂度、耦合、重复、god object、命名、测试覆盖、安全）+ 语言插件（Python: ruff/bandit/import-linter；TS: knip；Java: PMD）+ tree-sitter 通用路径。

**核心资产不是检测能力，是状态机 + 反刷分计分 + 队列。**
- 状态存 `.desloppify/`
- strict / lenient 双分
- wontfix 会拉大两者差距，重审可能降分

**对本项目的价值**：**抄它的状态机。** `next → fix → resolve` 闭环 + 反刷分计分，是 desloppify 唯一真正稀缺的东西。检测器层不值钱。

### pr-lens

TS monorepo（pnpm workspace），MIT，有 GitHub App 和 npm 包。

`SKILL.md` 原话：**"The agent writes one JSON document, and PR Lens draws it."**

架构：
- `packages/schema` — Zod schema（`graph.ts` / `primitives.ts` / `validate.ts`）
- `packages/renderer` — 自研 SVG 渲染器（layout / geometry / theme）
- `packages/cli` — `extract.ts` + `providers/{gemini,openai}.ts`

`extract.ts` 里的关键设计：
```ts
/** One repair round. A model that cannot fix a named path in one go does not fix it in three. */
const MAX_ATTEMPTS = 2;
```
和
```ts
/**
 * The fields the repository already knows the answer to. They are written
 * over whatever the model emitted rather than merged with it: a commit sha,
 * a line count or the lens set that was asked for is a fact, and a fact the
 * model is free to restate is a fact that eventually disagrees with itself.
 */
```

**第二段注释是本项目最重要的参考。** pr-lens 已经意识到「模型不该复述事实」，并强制覆盖。但它只覆盖了 commit sha / 行数这类元数据，**没有覆盖代码语义本身** —— 因为它的分析层是空的。

**对本项目的价值**：
- 抄 `applyKnownFields` 的思路（事实不允许模型复述）
- 抄「命名错误路径 + 一次修复轮」的校验反馈设计
- 渲染器可以复用（如果我们做 SVG 视图）

### archify

Node CLI + JSON Schema，MIT，130K+ skills.sh 安装量。

五种图：architecture / workflow / sequence / dataflow / lifecycle。

有 `--repo-root` 证据机制（`references/repository-authoring.md`）：
- 从目标仓库记录 `git rev-parse HEAD`、origin、`git status --short`
- 每条断言记录 `repo-relative path` + `inclusive line ranges`
- 校验引用在**pinned revision 的提交字节**上存在

**这是它比 pr-lens 强的地方**：至少能验「引用的行号存在」。

**但它验不了语义** —— 只验 `X.go:10-20` 这个范围有效，不验「这个组件真的做这件事」。

**对本项目的价值**：证据快照 + pinned revision 的做法值得抄。`archify/bin/archify.mjs` 有完整实现。

### graphify（Graphify-Labs）

Python，Apache-2.0，YC S26。PyPI 包 `graphifyy`。

把整个项目（代码 + 文档 + PDF + 图片 + 视频）映射成**知识图谱**，用查询代替 grep。

关键设计（`ARCHITECTURE.md`）：

```
detect() → extract() → build() → cluster() → analyze → report.generate() → export.to_*()
```

**每条边标可信度**：
| Label | Meaning |
|---|---|
| `EXTRACTED` | 源码里显式存在（import 语句、直接调用） |
| `INFERRED` | 合理推断（调用图二次扫描、上下文共现） |
| `AMBIGUOUS` | 不确定，在报告中标记待人工审查 |

代码用 tree-sitter AST 解析，**确定性、无 LLM、不出本机**。文档/PDF/图片/视频才用 LLM 做语义抽取。

有 `analyze.graph_diff(G_old, G_new)`：比较两个图快照，返回 `new_nodes / removed_nodes / new_edges / removed_edges / summary`。

输出三个文件：`graph.html`（力导向图，可点）/ `GRAPH_REPORT.md` / `graph.json`。
另有 MCP server、HTTP server、watch 模式、Obsidian vault、wiki 导出。

**它已经证明的事**：
1. 「边标 EXTRACTED/INFERRED」这个机制成立且有用
2. 图和 diff 是人类理解代码的有效形式
3. 代码部分的确定性抽取可行

**它缺的事**：
1. **只有语法层** —— tree-sitter 看到 `db.Query(query)` 和 `query := fmt.Sprintf(...)`，但**连不起来**。看不到 taint 传播。
2. **无 PR 级 diff** —— `graph_diff` 是全量图对全量图，节点 ID 依赖路径，重构改个文件名就全乱。
3. **无「逻辑结构」层** —— 图上只有「谁调谁 / 谁引用谁」，没有「数据从 A 流到 B」。

这三条正好是 SSA + SyntaxFlow 的强项。

## 汇总结论

| 项目 | 值得抄的 | 不要抄的 |
|---|---|---|
| ub-mode | `Attack the Premise` 那一条 | 整个 Skill 形态 |
| desloppify | **状态机 + 队列 + 反刷分计分** | 26 万行检测器 |
| pr-lens | **事实字段强制覆盖模型输出**、校验反馈设计 | 「分析交给 LLM」 |
| archify | **pinned revision 证据快照** | 「分析交给 LLM」 |
| graphify | **EXTRACTED/INFERRED 可信度标注**、graph_diff 形态 | tree-sitter 单层分析 |

**intentflow 的定位**：graphify 的可信度标注 + pr-lens 的事实约束 + desloppify 的状态机 + SSA 的数据流深度。
