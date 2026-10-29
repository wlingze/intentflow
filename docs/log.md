# 实验日志

## 2026-10-29 · 立项与第一轮验证

### 起点

对比了六个项目：ub-mode、desloppify、pr-lens、archify、graphify、intentflow。

共同点：都在解决「人看不懂 Agent 写的代码」。分野在于**谁做分析**。

关键观察：**没有一个是真正解析代码来做意图分析的。**
- ub-mode：纯提示词
- desloppify：外部 linter + 队列，好的是状态机不是分析
- pr-lens / archify：LLM 读代码写 JSON，结构可校验但语义不可校验
- graphify：tree-sitter 抽图，代码部分确定性，但只有语法层，没有数据流

定位确认：**intentflow 把 SyntaxFlow 插进它们空着的那一层 —— 分析层。**

### 方向修正

最初想做「代码分析工具」。用户指出真实目标是 **PR 级语义 diff**，且有 web 端给人类 review。

模型重定为三层：项目结构 / 逻辑结构 / 意图。

### 概念修正

用户指出：**代码本身不能表达意图，所以一定需要 LLM 做高层解析。**

这条推翻了我原来的说法「SyntaxFlow 负责是什么，LLM 负责为什么」。修正为：

> SyntaxFlow 的作用不是提取意图，是给 LLM 的意图推断装锚点。
> 它做三件事：禁止发明事实、压缩推断空间、让结论可回查。

推论：可信度必须显式标注，且意图层永远不能标 `EXTRACTED`。

graphify 已经验证了这条路 —— 它每条边标 `EXTRACTED / INFERRED / AMBIGUOUS`。

### 技术验证

硬门槛依次通过：

1. yaklang 可作为 Go module 引入（`v1.4.9-beta4`）→ build 通过
2. 内存模式编译 Go 目录 → 通过
3. SyntaxFlow 查询 sink 与实参 → 通过
4. `GetTopDefs()` 跨函数回溯 + 函数归属 → 通过
5. 精确定位（file:line:col）→ 通过

### 踩到的坑

**坑 1：`*.Method()` 不匹配标准库成员。**
`os.ReadFile(* as $p)` 命中，`*.ReadFile(* as $p)` 零结果。
标准库调用必须显式写包名。

**坑 2：结果变量名不带 `$`。**
`GetValues("param")` 对，`GetValues("$param")` 静默返回空。

**坑 3（最重要）：身份键太粗，吃掉了最关键的改动。**

第一版意图层身份键是 `函数 | 副作用类别 | 来源类别`。demo 里 before 用参数化查询、after 改成字符串拼接，两边身份键完全一样，diff 报 ±0/0。

修正：身份键加上「数据如何到达」（`shape`：direct / format / concat / member / call）。

结论记进 `02-layers.md`：**语义 diff 的身份键必须编码「如何到达」，不能只编码「从哪来、到哪去」。**

**坑 4：`GetTopDefs()` 只返回叶子。**
`os.Getenv("X") + "/a"` 的回溯结果是 `[ExternLib-os, "X", "/a"]` —— 全是字面量，来源信息丢了。
修正：候选集 = 实参本身 + 叶子。

### 结果

三层 diff 全部跑通：

```
意图层 ±2/1  逻辑层 ±7/2  项目层 ±3/0  关注点 5
```

意图层正确识别出：
- 新增 `handleSearch → findUser → SQL`（shape=format，HIGH）
- 移除 `handleSearch → findUser → SQL`（shape=direct，info）
- 新增 `loadTemplate → 文件读写`（shape=concat，source=env，warn）

### 未解决

1. **Go 标准库无签名。** 所有标准库调用编译成 `Undefined-pkg.Func`。调用链可用，但类型级分析和误报控制受限。
2. **`*.Method` 误报率高。** `*.Query` 抓到 `r.URL.Query()`。目前靠 `Exclude` 黑名单兜，不可扩展。
3. **`opcode:call` 条件无效。** 无法枚举全部调用，只能按 sink 规则反查。
4. **大项目未测。** demo 只有单文件 43 行。
5. **LLM 层未接。** `Summary` 结构已定义，实现为空。
6. **web 端是静态页。** 没有下钻、没有 diff 对比视图。

### 下一步

优先级排序：

1. 把 demo 扩到多文件多包，验证跨文件数据流
2. 拿 yaklang 自己的一个子包跑一遍，看噪声和性能
3. 接 LLM 叙述层，做 A/B：结构化 diff vs 原始 diff 喂给同一模型，比输出质量
4. 考虑接 `git diff` 直接驱动，而不是手工准备两个目录

## 2026-10-29 · 第二轮：图形化与三工具对比

### Web 端

原来的页面只有文字列表。这一轮改成「先图后表」：

- 意图流图：来源 → 函数链 → 副作用，横向分层；新增绿色实线，移除红色虚线，形态变化标在边上。
- 主题：`system / light / dark` 三态，跟随系统 + localStorage 记忆；首屏脚本先定主题，避免闪烁。
- 交互：悬停边看快照，点击节点/边固定到 inspector；点击下方事实会高亮对应链路。
- 图是浏览器里用内联 JSON 排的，页面仍是单文件、无外部依赖。

### 同一 demo 的三份产物

- intentflow：意图层 ±2/1。`format` 与 `direct` 作为两条边同时出现，是这次改动的核心。
- PR Lens：3 lanes / 7 nodes / 7 edges / 1 flow，渲染 4 个 light/dark SVG。
- Archify：base/head 两份 architecture JSON，`compare` 输出 `+3 ~1 -0` 组件、`+4 -1` 连接，28/28 checks。

### 结论

三者不冲突：intentflow 产出事实，PR Lens / Archify 负责让人看见。
下一步值得做的是把意图链自动投影成 graph document，而不是继续手写文档。

详细对比见 [04-compare.md](04-compare.md)。

## 2026-10-29 · 第三轮：独立前端工作台

### 为什么不再用单文件 HTML

上一轮的页面把排版、主题和交互都写在 Go 模板里。
改一次样式就要重编 265 MB 的二进制，也无法做 diff 和评论。

### 现在的结构

- Go 只做分析。`serve` 命令跑完 diff 后监听 HTTP。
- `GET /api/payload` 返回 review 与两侧源码。
- `POST /api/review` 把工作台里整理好的意见写成 `review.md`。
- `frontend/` 是 React + TypeScript + Vite。Go 用 `http.FileServer` 托管 `frontend/dist`，不嵌入。

### 工作台里能做什么

- 中间的图从 `handleSearch` 分出两条：`findUser` 的 SQL 从 `direct` 变成 `format`，`loadTemplate` 是新增的 env → 文件读写。
- 左侧是文件树和项目层事实。点击跳到代码。
- 右侧 SyntaxFlow 结果逐条处理：认为没事，或认为有问题并进入 Review。
- 代码面板默认统一 diff。选中一段代码后，引用进入底部输入框。
- 右上角提交：写入 `review.md`，同时复制给 Agent 的 prompt。

### 验证

demo 结果与上一轮一致：意图层 ±2/1，逻辑层 ±6/2，项目层 ±3/0，关注点 5。
浏览器里验证了：图的分叉、代码跳转到 `main.go:14`、选中引用、评论、提交、搜索、深色主题。
`review.md` 与 `review-state.json` 已写入 `examples/demo-go/out/`。

设计见 [05-frontend.md](05-frontend.md)。

## 2026-10-29 · 第四轮：行为模型、统一契约、双视角工作台

### 先回答三个问题

1. **为什么是入口 / 处理链 / 副作用？** 因为它借用了污点分析的 source → propagation → sink。
   它适合找漏洞，不适合回答「改动改变了什么行为」。调研与取舍见 `06-behavior-research.md`。
2. **图是怎么生成的？** Go AST 提供调用边、调用点、条件；SSA + SyntaxFlow 提供
   source、sink、shape；行为投影把两者拼成 scenario。没有 LLM。
3. **AI 怎么介入？** 当前不介入。未来只做叙述层，必须引用 Fact.identity。

### 新模型

- 四类角色：触发 / 判定 / 变换 / 效果。
- 角色回答「是什么」，阶段回答「在因果链的哪一步」。阶段由拓扑最长路径计算，
  所以判定可以出现在变换之后。
- 一个判定节点对应一个 `if`/`switch`，分支是边，不是节点。
- effect 节点 identity 不含 shape：`direct → format` 是 modified。
- data 边 identity 含 shape/source：before/after 两条边同时出现。

### 统一契约

- 唯一事实来源：`schema/openapi.yaml`。
- Go：`oapi-codegen v2.4.1` → `internal/contract/types.gen.go`。
- TS：`openapi-typescript 7.13.0` → `frontend/src/api/schema.gen.ts`。
- `internal/model` 改为生成类型的领域别名；`internal/payload` / `internal/serve` 直接用生成类型。
- `make schema` 重新生成，`make check` 校验。

### 双视角

- 行为图视角：全宽 DAG + 右下角代码 peek + 底部行为清单 / 三层事实 ledger。
- 代码视角：全宽 diff / 搜索 + 左下角可缩放的行为缩略图。
- 右侧 Review 栏在两个视角都保留；底栏 composer 不变。
- 删除了旧的右抽屉 `CodeDrawer`，也删除了 Go 内嵌 HTML 的 `internal/emit/web.go`。

### demo

`findUser` 增加 `switch`：输入含 `@` 走 email 模板，否则走 name 模板；两者仍然
用 `fmt.Sprintf` 拼接。`handleSearch` 增加 `name == ""` 守卫。新增 `loadTemplate`。

结果：

```
意图层 ±2/1  逻辑层 ±7/2  项目层 ±4/0  关注点 5
行为图 7 节点 · 10 边 · 2 条行为 · 5 个阶段
```

### 验证

- `go build ./...`、`go vet ./...` 通过。
- `pnpm typecheck`、`pnpm build` 通过。
- 浏览器验证：分叉图、switch 判定、节点 peek、`main.go:21` 跳转、
  缩略图点击跳转、选中引用、评论、提交、搜索、深色/浅色。
- `review.md` 与 `review-state.json` 已写入 `examples/demo-go/out/`。
- 未上传 GitHub，全部为本地提交。

## 2026-10-30 · 第五轮：去掉字法树，按行为行重排，跑 yaklang LLVM 分支

### 去掉 go/ast

项目层、逻辑层、意图层现在共用一次 SSA 编译：

- 文件：`Program.FileList`
- 函数：`Program.EachFunction`
- 调用：`*ssa.Call`
- 分支：`*ssa.If` / `*ssa.Switch`
- 数据来源与形态：SyntaxFlow + `GetTopDefs`

`internal/scan/ir.go` 是唯一入口。`project.go` 只保留路径工具；`behavior.go`
不再出现 `go/parser`。

### 行为图重排

旧版把所有节点塞进全局阶段列，`handleSearch` 的守卫同时连向 `findUser`
和 `loadTemplate`，看起来像一条分叉。实际是两条 scenario。

现在一条 scenario 一行：

- 行内按 `scenario.nodes` 从左往右排。
- 不同行之间不画边。
- 数据边跨判定时从下方绕行。
- 调用边和判定路径同时存在时，只画判定路径。

### 工作台

- 图上点击节点只开底部详情/代码坞，不自动切代码。
- 代码坞可拖高、可关闭，带证据与「引用到评论」。
- 代码视角左侧改成行为导航；下面是变更文件树；没有悬浮缩略图。
- 左栏换成项目改动目录树：目录聚合 +/− 行数、变更文件数、结构/调用事实数。
- 右侧加 AI tab。

### LLM

新增 `internal/insight`。只读事实，输出 `summary`、`risks`、`focus`。
默认走 OpenAI Responses 兼容端点：

```text
INTENTFLOW_LLM_BASE_URL
INTENTFLOW_LLM_API_KEY
INTENTFLOW_LLM_MODEL
```

没配置时 `status=unavailable`，不影响分析。prompt 要求 evidence 只能引用
输入里的标题、路径或行号。

### yaklang 分支

- before：`main`
- after：`feature/ssa2llvm/support_ci_and_mustpass_test`
- 范围：`common/yak/ssa2llvm`，304 个文件，122 个改动

结果：项目层 +581/−6，逻辑层 +1935/−106，意图层 +9，关注点 22，
行为图 15 条 scenario，48 节点 / 67 边（23 新增 / 21 移除 / 0 变化）。触发函数与变换函数按 before/after 对齐后，未变的入口不再被标成新增。SSA 编译约 1 分钟。

LLM 摘要指出：编译器调用绑定/闭包/控制流大范围调整，新增 FileReadFile、
FileOpen、FileSave、FileCopy 等 env→format→文件读写行为；优先复核 aotlib
文件路径、elfsplit 运行时补丁和测试覆盖。

### 验证

- `go build ./...`、`go vet ./...` 通过。
- `pnpm typecheck`、`pnpm build` 通过。
- 浏览器验证：两条 scenario 分行、format 弧线、底部代码坞、拖拽、
  代码视角行为导航、项目目录树、AI tab、SyntaxFlow/Review。
- `examples/yaklang-llvm/out/review.json` 与 `review.md` 已生成。
