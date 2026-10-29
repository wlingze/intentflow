# 代码行为视图：调研与取舍

> 目标：为 intentflow 的 review 图找一个有依据的模型，而不是把「入口 / 处理链 / 副作用」当成默认答案。
>
> 结论先说：现有三层图借用了污点分析的 source → propagation → sink 管线。它适合找漏洞，不适合回答「这次改动改变了什么行为」。新的图应该是一个**行为投影**：触发、判定、变换、效果，按因果阶段排布，而不是按函数调用深度排布。

## 1. 问题：review 时人到底在看什么

高级开发者在 review 一个改动时，通常按下面的顺序建立模型：

1. **谁能触发这段代码？** HTTP handler、CLI、消费者、定时任务、测试。
2. **哪个条件决定了走哪条路？** 守卫、分发、feature flag、路由表。
3. **数据被怎么处理？** 解析、格式化、拼接、映射、跨边界传递。
4. **最后发生了什么？** 写库、读文件、起进程、发网络请求、写响应。
5. **影响了多大范围？** 调用者、被调用者、包边界、信任边界。

行级 diff 只回答「哪些字符变了」。调用图只回答「谁调用谁」。两者都不直接回答上面五个问题。

## 2. 已有表示法盘点

| 表示法 | 回答什么 | 优点 | 局限 |
| --- | --- | --- | --- |
| 控制流图 CFG | 语句执行顺序、分支 | 精确、成熟 | 没有数据语义，图很大 |
| 调用图 Call Graph | 函数之间谁调用谁 | 便宜、跨语言 | 不知道调用里发生了什么 |
| 数据流 / 污点分析 | 数据从 source 到 sink | 安全分析核心 | 把中间逻辑压成「传播」，看不到判定与变换 |
| 程序依赖图 PDG | 语句之间的控制依赖与数据依赖 | 语义精确，可做切片 | 语句级，节点太多，不适合人读 |
| 系统依赖图 SDG | 跨过程 PDG | 跨函数切片 | 更重，仍偏底层 |
| 代码属性图 CPG | AST + CFG + PDG 的统一图 | 可查询、可组合 | 是数据库，不是给人看的视图 |
| Concern Graph | 程序元素与关注点的关系 | 支持特征定位 | 需要额外建立 concern 映射 |
| 运行时行为图 | 真实执行路径、时序、耗时 | 贴近生产行为 | 需要跑起来；静态改动可能没有覆盖 |
| 4+1 视图 | 多视角描述架构 | 提醒「视图是投影」 | 偏架构层，不落到语句 |
| Review Map / Flows | 入口、变体、端到端流 | 人读友好，支持评论 | 多为动态/服务层，静态语义弱 |

### 2.1 PDG 与 CPG：语义图的根

PDG 的节点是语句，边是控制依赖和数据依赖。它从 1987 年的优化论文开始，后来成为切片、调试、理解程序行为的基础。([Ferrante et al., 1987](https://www.cs.utexas.edu/~pingali/CS395T/2009fa/papers/ferrante87.pdf); [PDG 概览](https://en.wikipedia.org/wiki/Program_dependence_graph))

CPG 把 AST、CFG、PDG 合成一张属性图，用图查询找漏洞。它证明了「语法 + 控制 + 数据」可以放在同一个可查询结构里。([Yamaguchi et al., IEEE S&P 2014](https://ieeexplore.ieee.org/document/6956589))

intentflow 的 SSA + SyntaxFlow 已经在做 CPG 的一部分：SSA 提供 def-use，SyntaxFlow 提供 sink 匹配与参数绑定。缺的是**把图投影成人能读的行为层**。

### 2.2 4+1 视图：提醒我们「图是投影」

Kruchten 的 4+1 模型把架构拆成逻辑、进程、开发、物理四个视图，再加场景。关键不是这四个名字，而是：**同一个系统需要多个并发视图，每个视图只回答一类问题。** ([4+1 view model](https://en.wikipedia.org/wiki/4%2B1_architectural_view_model))

行为图不是「代码的另一个画法」，而是一个**场景视图**：每条 scenario 是一次从触发到效果的端到端执行。它不试图装下所有语句。

### 2.3 CodeSee Flows：入口、变体、流

CodeSee 的定义很接近 review 需要的粒度：

> Most software systems wait around until some input or trigger kicks them into action... We call that initial point of entry to your system an **entry point**.
>
> Often, an entry point will result in different behavior depending on the situation... each different variation of execution is grouped together into what we call a **variant**.
>
> A **flow** is made up of all the **variants** that have the same **entry point**.

来源：[CodeSee Flows and Variants](https://docs.codesee.io/docs/flows-and-variants)

这给了两个可直接借用的词：**入口**与**变体**。但 CodeSee 的 flow 多来自运行时/服务观测；intentflow 要在**静态代码**上构造同样的东西。

CodeSee 的 Review Map 还提出「按逻辑块 review，而不是按字母序」，并在图上双击节点看 diff、加评论。([Review Maps](https://docs.codesee.io/docs/review-map-guide))

这验证了「图 + 代码 + 评论」三件套的方向，但没有解决静态语义 diff。

### 2.4 AppMap：运行时行为图的边界

AppMap 通过运行应用记录 HTTP 请求、函数调用、SQL、下游请求，再渲染依赖图、序列图、trace、flame graph。([AppMap: Reverse Engineering](https://appmap.io/docs/reference/guides/reverse-engineering.html))

它的优势是真实；劣势是必须先跑起来，而且只能看到被覆盖的路径。review 一个静态 diff 时，很多新分支根本没有测试覆盖。

所以 intentflow 只选静态 SSA，不依赖运行。运行时可作为未来的证据补充，不作为图的唯一来源。

### 2.5 Twitter / X 上的讨论

搜索 `code review intent graph visualization`、`program dependence graph` 等词，X/Twitter 的结果主要是两类：

- **AI 上下文压缩**：把仓库索引成调用/依赖图，减少模型读文件的数量。例如 `code-review-graph`，用 Tree-sitter 建结构图，通过 MCP 提供给 Claude/Cursor，宣称减少 token。
- **PR 视觉摘要**：把 diff 按 review 意图分组、加进度条、加解释。例如 Flow-Next 的 PR render lens。

这些产品解决的是「让 AI 少读文件」或「让 PR 更好读」，没有提出可复用的**代码行为模型**。它们可以作为交互参考，不能作为语义依据。

结论：**Twitter 上没有比 PDG/CPG/Flows 更扎实的模型。** 不要从社交媒体发明术语。

## 3. 为什么「入口 / 处理链 / 副作用」不够

现有三层图的三列来自污点分析：

```
source (入口) → propagation (处理链) → sink (副作用)
```

它有三个问题：

1. **把判定吞掉了。** `if name == ""`、`switch` 分发、权限检查都落在「处理链」里，图上不可见。
2. **按调用深度分列，而不是按语义分列。** 一个做判定的函数和一个做数据变换的函数都叫「处理链」。
3. **假设线性。** 真实行为是分支、汇合、多个效果；一条链一个 row 会把共享节点和分支关系压扁。

它适合回答「有没有从 HTTP 到 SQL 的路径」，不适合回答「这次改动把哪条行为改成了什么」。

## 4. 新模型：四类行为 + 一条 scenario + 边界

### 4.1 四类行为角色

| 角色 | 英文 | 定义 | 例子 |
| --- | --- | --- | --- |
| 触发 | trigger | 外部刺激进入系统的位置 | HTTP handler、CLI、消费者、cron、测试 |
| 判定 | decision | 选择走哪条行为的条件或分发 | `if`、`switch`、类型断言、feature flag、路由 |
| 变换 | transform | 数据被构造、解析、传递的步骤 | `fmt.Sprintf`、`json.Unmarshal`、map、join、函数调用 |
| 效果 | effect | 可观察的副作用 | SQL、文件、进程、网络、响应写回 |

四个词不是随便起的：

- **触发**对应 CodeSee 的 entry point，也对应污点分析的 source，但强调「谁启动」而不是「数据从哪来」。
- **判定**对应 PDG 的控制依赖，但提升为一级节点。这是现有图最缺的东西。
- **变换**对应 PDG 的数据依赖与 SSA 的 def-use。它比「处理」具体：数据形状变了。
- **效果**对应污点分析的 sink，但不只安全 sink；任何可观察副作用都算。

### 4.2 Scenario：一条端到端行为

一条 scenario 是：

```
触发 → (判定 →)? 变换* → 效果
```

它不是函数调用栈，而是一条**行为路径**。同一个触发可以有多条 scenario（CodeSee 叫 variant）。同一个效果可以被多条 scenario 到达（例如两个分支都执行同一个 SQL）。

### 4.3 阶段与角色是两个轴

这是本次设计最重要的决定：

- **角色**回答「这是什么行为」。
- **阶段**回答「它在因果链的哪一步」。

一个 `switch` 可能出现在触发之后，也可能出现在变换之后。把四类角色硬编码成四列，会把后面的判定画到前面，产生回边。正确做法是：

- 节点按**因果阶段**从左到右排（拓扑最长路径）。
- 节点用**角色**着色/加图标。
- 效果节点统一贴到最右列，方便比较 before/after。

这样既能保留「触发 / 判定 / 变换 / 效果」的语义，又能容纳任意深度和多次判定。

### 4.4 边界不是一列

包边界、服务边界、信任边界不适合做成第五列。它们是**边的属性**或**节点的 tag**：

- 跨包调用：边上标 `boundary`。
- 跨服务/跨进程：未来加 `boundary: process`。
- 信任边界：由 source 类别和 sink 类别推导。

当前 MVP 先保留 `package` 字段与边的 `boundary` 枚举，不强行画边界列。

## 5. 图是怎么生成的

### 5.1 分析管线

```
SSA（只编译一次）
  ├─ 项目层：文件、函数、调用边
  ├─ 逻辑层：调用点行号、CFG
  ├─ 判定层：if / switch / guard
  └─ SyntaxFlow
       ├─ sink 匹配（SQL / 文件 / 进程）
       ├─ 参数回溯 GetTopDefs
       ├─ 来源分类（http_input / env / cli_args）
       └─ 到达形态（direct / format / concat / member / call）

行为投影
  ├─ 用逻辑层调用边还原 scenario 路径
  ├─ 把路径上的函数变成 transform
  ├─ 把路径上的 if/switch 变成 decision
  ├─ 把 sink 变成 effect
  └─ 按稳定 identity 做 before/after diff
```

### 5.2 全部来自 SSA

| 信息 | 来源 | 可信度 |
| --- | --- | --- |
| 调用边 | SSA `*ssa.Call` | EXTRACTED |
| 调用点行号 | SSA 指令位置 | EXTRACTED |
| 条件表达式 / 分支 | SSA `*ssa.If` / `*ssa.Switch` | DERIVED |
| sink 存在 | SSA + SyntaxFlow | EXTRACTED / DERIVED |
| source 分类 | SSA `GetTopDefs` + 规则 | DERIVED |
| 到达形态 | SSA opcode + 值文本 | DERIVED |
| 跨函数路径 | SSA 调用边 | DERIVED |

**没有 LLM。** 图里的每个节点和边都能回到代码位置或事实 identity。

### 5.3 为什么不用 LLM 生成图

- LLM 生成的图不可复现，review 结论无法审计。
- 同一个 diff 两次运行可能得到不同结构。
- 安全相关的 shape（direct/format/concat）必须由 IR 判定，不能猜。

LLM 只能出现在**叙述层**：把结构化事实写成一段人话，并且每个论点必须挂 evidence。
当前版本已接可选 LLM；它不生成节点、边或行号，未配置时自动降级。

## 6. 与现有工具的区别

| 工具 | 图从哪来 | 是否静态 | 是否表达判定 | 是否做语义 diff |
| --- | --- | --- | --- | --- |
| AppMap | 运行时 trace | 否 | 间接 | 否 |
| CodeSee | 运行时/服务 + 静态结构 | 部分 | 变体 | PR 级 |
| Sourcetrail | 静态索引 | 是 | 否（依赖图） | 否 |
| CodeQL / Joern | CPG / 查询 | 是 | 查询可表达 | 否（要自己写查询） |
| PR Lens / Archify | 手写/LLM 辅助的架构文档 | 是 | 架构层 | 架构层 |
| intentflow | SSA + SyntaxFlow | 是 | 是 | 是（三层 + 行为） |

intentflow 的差异点不是「又一个图」，而是：

1. **判定是一级节点**，不是藏在「处理链」里。
2. **shape 参与 identity**，所以「参数化 → 拼接」不会被 diff 吃掉。
3. **图由分析器生成**，不是 LLM 画的。
4. **图是 review 工作台的一部分**，不是一次性报告。

## 7. 对实现的约束

- 图必须包含 `evidence`（事实 identity）和代码位置。
- 节点必须在 before/after 两侧有稳定 identity；行号变化不产生新节点。
- 效果节点的 identity 不含 shape，shape 变化标成 `modified`。
- 数据边的 identity 含 shape/source，所以 before/after 两条边会同时出现。
- 所有 `DERIVED` 结论在 UI 上必须可见（不能伪装成 EXTRACTED）。
- 没有 LLM 的图，不标 `INFERRED`；将来加叙述层时才用。

## 8. 参考

- Ferrante, Ottenstein, Warren. *The Program Dependence Graph and its Use in Optimization*. ACM TOPLAS, 1987. <https://www.cs.utexas.edu/~pingali/CS395T/2009fa/papers/ferrante87.pdf>
- Yamaguchi et al. *Modeling and Discovering Vulnerabilities with Code Property Graphs*. IEEE S&P, 2014. <https://ieeexplore.ieee.org/document/6956589>
- Kruchten. *Architectural Blueprints — The "4+1" View Model of Software Architecture*. IEEE Software, 1995. <https://en.wikipedia.org/wiki/4%2B1_architectural_view_model>
- CodeSee. *Flows and Variants*. <https://docs.codesee.io/docs/flows-and-variants>
- CodeSee. *Review Maps*. <https://docs.codesee.io/docs/review-map-guide>
- AppMap. *Reverse Engineering with AppMap*. <https://appmap.io/docs/reference/guides/reverse-engineering.html>
- `code-review-graph`: Tree-sitter 结构图 + MCP 上下文压缩。 <https://code-review-graph.com/>
- Flow-Next. *Visual Aids*. <https://flow-next.dev/review/visual-aids/>
