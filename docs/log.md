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

## 2026-10-30 · 第六轮：三级图、放大详情、DeepSeek

用户反馈：图要能拖拽；点节点要像 Archify 一样放大看信息，再从卡片里展开代码；
一屏应该分文件总览、函数分组、函数内部三级；同源节点要合并，不能一条一条堆。

改法：

- **文件层**：行为节点按文件聚合；只画文件之间的行为关系。
- **函数层**：按 `function + file` 合并触发/变换/效果节点；节点按文件分组框排列；保留调用和数据关系。
- **行为层**：按 trigger 分组；同一入口的多条 scenario 合并成一组，组内仍保留每条路径的判定和数据边。
- 画布改为固定视口 + 平移/缩放；初始 100% 显示左上区域，`适应` 才缩到全图。
- 点击节点不再直接开底部代码坞；先弹出放大卡片，卡片里点「展开代码」才打开代码坞。
- 文件节点没有具体函数行；代码坞支持只有 `file/line`、没有 behavior 节点的打开方式。
- 代码视角的行为导航也按 trigger 分组，组内可展开同源 scenario。
- LLM 默认模型切到 `deepseek-v4.1-flash`，两套工作台都用它重新生成摘要。

结果：

- demo：函数层 3 个函数、1 个文件分组；行为层 2 条同源行为合并为 1 组。
- yaklang：文件层 10 个涉及文件/6 条关系；函数层 21 个函数/10 个文件分组/13 条关系；
  行为层 15 条 scenario 合并为 8 组，48 节点/67 边。
- AI 摘要：`ok`，模型 `deepseek-v4.1-flash`，5 条风险。

验证：

- `go build ./...`、`go vet ./...`、`go test ./...` 通过。
- `pnpm typecheck`、`pnpm build` 通过。
- 浏览器验证：文件/函数/行为切换、拖拽平移、滚轮缩放、点击节点放大、展开代码、
  文件节点代码坞、代码视角分组行为导航、AI tab。
- 两个工作台监听 `0.0.0.0`：demo `:8123`，yaklang `:8124`。

## 2026-10-30 · 第七轮：单张函数图 + 底部内部行为

反馈两点：

- 画布上的边穿过卡片、标签堆在文件框上。
- 文件框里的函数按列排成顺序块，看不出调用逻辑。
- `文件 / 函数 / 行为` 三个 tab 也不直观。

改法：

- 去掉三个层级 tab。主图固定为函数关系图。
- 函数节点按 `file + function` 合并角色；只保留调用边。
- 布局改为网格初始化 + 调用边弹簧 + 矩形碰撞；文件不再决定列或顺序。
- 边用 6px 障碍物网格做 A* 寻路，绕开卡片；边标签默认隐藏，悬停显示。
- 去掉右上角浮动节点卡片。点函数直接在底部展开内部行为。
- 底部左栏列 scenario：触发 → 判定 → 变换 → 效果；点步骤切换右栏源码。
- 默认源码行改为所选函数自身的节点，不跳到别的函数。
- 打开页面自动适应画布；仍可拖拽、滚轮缩放和手动适应。

结果：

- yaklang：21 个函数、10 个文件、13 条调用；点 `CompileObjectToBinarySC` 展开 6 条内部路径。
- demo：3 个函数、2 条调用；点 `findUser` 展开 1 条内部路径。

验证：

- `pnpm typecheck`、`pnpm build` 通过。
- 浏览器验证主图、自动适应、点击函数下钻、点击步骤切源码、代码视角。

## 2026-10-30 · 第八轮：把工作台改成 review 优先

### 目标

用户要求先做 review 能力，行为图第二。列出 12 条验收：大 diff 快、分栏/统一一致、小屏可读、可换行、右栏三类结论逐条可忽略/加入 review、左栏文件+行为图可折叠、显示 from/to 分支、提交选择、代码优先；图要含函数与类型、文件分组、下钻、零遮挡、绿/红/黄增量。

### 做了什么

- diff 引擎换成 prefix/suffix + patience 锚点 + 有界 Myers。原来的 4,000,000 单元矩阵之外的「按位置对齐」会把一次插入后的所有行标成改动，现在不会。
- `DiffView` 只渲染视口内的行；换行开启时按测量高度虚拟化。
- 分栏改成两等分弹性列，长行各自横向滚动，窄屏不再丢 before 或 after。
- 工作台改为「代码主视图 + 左侧文件/符号图/行为导航三块可折叠 + 右侧 AI/SyntaxFlow/Review」。小屏用抽屉。
- AI 风险条目化，和 SyntaxFlow 共用 ignore / keep 状态。
- 新增 Git 提交选择：`--repo --subdir --from --to`，`/api/commits` 与 `/api/payload?commits=`，只应用所选提交。
- 符号图来自 SSA：函数 + 类型 + 调用边，按文件分组；下钻是一跳子图，共享节点合并。

### 验证

- 前端 15 个单测、`tsc --noEmit`、`vite build` 通过。
- Go 全量测试通过，新增符号图合并测试与 gitcompare 语义测试。
- 真实仓库验证：6 个提交 → 10 文件；只选 2 个 → 5 文件、53 条事实，标签同步变化。

### 遗留

- 完整图（1,400+ 边）用曲线，交叉/穿卡数量如实显示；只有下钻子图用 A* 绕卡。
- 提交切换会重跑完整 SSA 分析，大仓库要等几分钟，结果按选择缓存在内存。

## 2026-11-02 · 第九轮：按代码结构讲清楚改动

### 问题

用户看 demo 后指出三件事：

1. 默认视图不是 GitHub/Zed 那样「文件逐个列出」。改动散在整份文件里，未改动行也在。
2. AI 列表把条目一条条铺开，太大，读不出逻辑。
3. 图形结构没有反映代码结构变化（删除什么、新增什么、修改什么）。

### 做了什么

- **堆叠改动视图**：新增 `hunks.ts`（改动行 + 3 行上下文，折叠缺口，单块上限 400 行）、`FileDiffCard`、`useNearViewport`。默认视图是「全部改动」，文件一张张卡片往下排，未改动部分折成「展开 N 行未改动代码」。点行号打开单文件视图并定位到该行。
- **文字版概览**（`ChangeBrief` + `brief.ts`）：按模块或目录分组，显示新增/删除/修改文件数、每组增删行数。有 LLM 时用 LLM 的业务分组，没有就退回目录分组，不编造业务含义。
- **结构变更清单**（`StructureList` + `structure.ts`）：按目录 → 文件 → 符号三层列出 `+新增 / −删除 / ~修改`。符号视图默认打开清单，不再默认画图；点文件名下钻到该文件的符号图。
- **信号清单**（`SignalList`）：SyntaxFlow 结果按文件分组、一行一条，详情按下展开。替换原来一卡一条的 `SignalCard`。
- **大仓库文件级聚合**（`aggregateByFile`）：子图超过 160 个符号就先按文件聚合成格子，点文件再下钻。yaklang 从 885 个卡片变成 81 个文件格子、19 个目录。
- **类型采集修正**：`collectTypes` 改走 `ObjectType.VerboseName`，再用 `type X` 声明行确认位置。只保留项目内真实声明的类型。yaklang 从 360 个类型（含 `http`、`sql`、`DB` 这类库类型）降到 118 个声明类型。
- **过滤编译器生成符号**：`AnonymousFunc-126`、`BlueprintFunc-15` 这类不进图。
- **STE 写作规范**：`internal/insight/llm.go` 加 `steRules` 常量，写进 prompt；AI 输出要求一句一事、具体动词、固定状态词。模块必须绑定真实文件路径，后端校验后才采用。

### 验证

- `make check`：`go vet`、`go test ./internal/...`、`tsc --noEmit`、`vitest`（30 个测试）全部通过。
- demo（`examples/demo-go`）：默认堆叠视图、3 个业务分组、5 条风险、行号跳转。
- yaklang `ssa2llvm`（122 个文件）：概览 19 组、结构清单 86 个文件、图聚合 81 个文件格子 / 45 条跨文件调用。
- LLM 网关接通（`deepseek-v4.1-flash`），输出符合 STE。

### 遗留

- 类型节点只覆盖项目内 `type` 声明；标准库类型（`*http.Request`）仍不进图，这是刻意的。
- 文件级聚合的边权重（调用次数）只用于布局，没有在 UI 上标注。

---

## 2026-11-02 · 第十轮：按 commit / 功能分类，重做常规 diff

### 问题

用户对比 oil-diff 后指出：

1. 阅读流缺少「先按 commit 或功能分类，再逐类读该类的图解」。
2. 折叠区只能一次展开整段，方向也不对。
3. 左右两栏没有收敛为「左文件树、右审计」。

### 做了什么

- **分类**（`ReviewNavigator` + `lib/groups.ts`）：顶部按功能或按提交分类。功能分类用 LLM 模块；没有 LLM 时按目录，并写明只用于导航。提交分类新增 `GET /api/payload?commit=<sha>`，把单个提交与第一父提交比较；`gitcompare.Open` 接受 `--subdir .`。
- **分类图解**（`CategoryDiagram` + `lib/diagram.ts`）：范围随分类变化，单文件显示 SSA 函数，多文件显示文件级汇总，点文件下钻。连线只画已解析调用。
- **常规 diff**（`FileDiffCard` + `lib/diffSections.ts` + `hooks/useDiffWindow.ts`）：每张卡片独立保留改动行 + 3 行上下文。折叠区上下各有按钮，每次补 5 行。行虚拟化改为挂在共享滚动容器上，滚动时只渲染约 60–120 行。
- **文件差异缓存**（`lib/fileDiff.ts`）：文件树和 diff 共享同一次对齐结果。
- **文件树**：去掉目录统计之外的多余信息，加路径过滤；点文件滚动到对应卡片。
- **清理**：删除已不可达的图视角代码（`GraphView`、`SymbolView`、`BehaviorSidebar`、`CodeDock`、`symbolLayout`、`behavior`、`levels`、`labels`、`structure`、`brief`、`useNearViewport`）和对应的 `view`/`peek`/`selected` 状态。

### 验证

- `tsc --noEmit`、`vitest`（27 个测试，新增 `diffSections.test.ts` 6 个）通过。
- demo：3 个功能分类、分类图解显示 `handleSearch → findUser / loadTemplate`、折叠区「每次 5 行」。
- Git 演示仓库（3 个提交）：按提交分类显示 `fdff13d` 与第一父提交的差异；点文件下钻到 `FindUser`。
- yaklang `ssa2llvm`（122 个文件）：`全部改动` 429,083 px 滚动高度，滚动时 DOM 行数 56–102，单帧 9–16 ms。
- 窄屏 860px：左右两栏变为抽屉，顶部按钮可打开。

### 遗留

- 提交分类的 payload 首次构建需要完整 SSA 分析，结果按提交缓存。
- 目录模式没有提交，`按提交` 按钮禁用。

## 2026-11-03 · 第十一轮：删掉分类，回到 diff

### 判断

上一轮把「分类 → 分类图解 → 堆叠 diff」放进一个阅读顺序。实际使用
时出现了三个问题：

1. 换分类会换掉整段 diff，读者不知道自己刚才看到哪。
2. 分类图解和 diff 争夺同一块屏幕，图解的信息量撑不起这个位置。
3. 「按提交」需要为每个提交重建 SSA，等待时间不可控。

用户要求只保留 diff + review，做成 GitHub PR 的样子。分类、图解、
符号图、单文件视图全部删除。

### 改动

- **CLI**：改成 `intentflow -l go -t .`。与 Git 基线（默认 HEAD）比较，
  服务先启动，扫描在后台。`--mode diff|scan|review` 三档。
  删除 `--repo`、`--from`、`--to`、`--commits` 与提交选择接口。
- **规则目录**：`syntaxflow/rule/*.yaml`，覆盖 HTTP 入口、全局变量、
  数据库操作、配置与协议。三种引擎：`syntaxflow`、`declaration`、`path`。
  规则内嵌进二进制。
- **扫描**：`internal/scan/keypoints.go` 只保留改动文件内的命中；
  snippet 取改动后文件的真实源码行。新增 `TestScanKeyPoints`。
- **后台状态**：`GET /api/scan` 返回状态、规则数、文件数、命中数和 AI 文本。
  前端每 1.2s 轮询，终态停止。
- **前端**：重写为 GitHub PR 布局。左侧文件树、中间堆叠 diff、右侧四页签
  （重点位置 / SyntaxFlow / AI Review / Review）。右侧可收起，窄屏变抽屉。
- **删除**：`ReviewNavigator`、`CategoryDiagram`、`CommitPicker`、
  `SignalList`、`Composer`、`SearchView`、`ReviewPanel`、`DiffView`、
  `CodeStage`，以及 `diagram.ts`、`groups.ts`、`selection.ts`、`search.ts`。
- **payload**：只携带改动文件。之前 702 个文件里未改动文件挤占了 6MB
  上限，导致新增文件没有正文，diff 显示为空。

### 验证

- `make check`：`go vet`、`go test`、`tsc --noEmit`、27 个 vitest 通过。
- 自评审（HEAD 74058743 → 工作区）：82 个改动文件，扫描 35s，11 条规则，
  14 条命中；重点位置 8 条，分 HTTP / 全局变量 / 配置三组。
- 浏览器：点重点位置滚到 `internal/scan/keypoints_test.go:39` 并高亮；
  行内评论进入 Review 页签；已查看同步文件树；统一视图与浅色主题正常；
  900px 下左右抽屉正常；控制台零错误。
- demo 目录比较：1 个文件，5 条命中（HTTP 2、全局变量 1、数据库 1、
  处理函数 1）。

### 遗留

- 扫描仍受 SSA 编译时间限制。服务可用，但结果要等。
- 前端不再使用三层事实、行为图与符号图；后端生成代码还在，未删。
- 单进程只跑一次扫描（SSA 程序名固定）。

## 2026-11-03 · 第十二轮：base/head 与 host/port

### 改动

- **`--base` 默认自动探测**：只接受当前分支历史里的 `main`、`master`、
  `origin/main`、`origin/master`（也就是 rebase 之后）。多个候选取距离
  最近的。都不在历史里就报错，要求显式 `--base`；不猜 `HEAD~1`。
- **新增 `--head`**：默认 `HEAD`，表示提交到提交比较；`WORKTREE` 表示与当前
  工作区比较。两种模式都先导出基线到临时目录，退出时删除。
- **比较说明写进 `comparison.note`**：提交比较写明「不含工作区未提交改动」；
  base 与 head 相同时直接说明没有差异。
- **`--addr` 拆成 `--host` 与 `--port`**：默认 `0.0.0.0`；`--port` 为 0 时
  用 `utils.GetRandomAvailableTCPPort()` 选端口，绑定失败重试 5 次。
- **启动打印所有可访问地址**：绑定通配地址时列出回环与所有本机 IPv4，
  最后打印实际端口。
- 临时比较目录改为退出时清理（之前 `serve` 会一直留着）。

### 验证

- `intentflow -t /tmp/if-git-demo`：自动选 `main`，打印
  `未指定 --base，使用 main（ef2a5f4b）`。
- `--base HEAD~2 --head HEAD`：2 个改动文件，note 写「不含工作区未提交改动」。
- `--head WORKTREE`：83 个改动文件，note 写「包含未提交改动」。
- 没有 main/master 的仓库：报错「找不到 main 或 master；用 --base 指定基线」。
- 不传 `--port`：随机端口 44981，打印 8 个地址 + `端口: 44981`，HTTP 200。

## 2026-11-03 · 第十三轮：单文件分发与 revision 切换

### 单文件

- `frontend/embed.go` 用 `//go:embed all:dist` 把产物嵌进二进制。
  `--dist` 仍可覆盖，调试时读磁盘。
- `scripts/build.sh`：先 `pnpm build`，再 `go build`。`make build` 调它。
- `frontend/dist/.gitkeep` 保留目录，缺少构建产物时 Go 仍能编译；
  服务启动会明确报「二进制里没有前端产物」。
- 验证：把 `bin/intentflow` 复制到 `/tmp`，从另一个仓库启动，页面与
  assets 都返回 200。

### Revision 切换

- `GET /api/revisions`：`worktree`（有未提交改动时）、`range`、
  每个提交（新到旧）。`files` 是 `git status` 的文件数。
- `GET /api/payload?revision=worktree|range|commit:<sha>` 切换比较范围。
- worktree：HEAD → 工作区，含未跟踪文件。commit：提交 vs 第一父提交。
  range：base → head。
- 每个 revision 缓存 payload 与扫描结果。切回来不重跑 SSA。
  SSA 编译仍串行（程序名固定）。
- 前端顶部下拉框切换；`已查看` 按 revision 分开存，评论按仓库共享。
- `--head WORKTREE` 且工作区干净时默认回到 `range`，worktree 仍作为
  「工作区（无改动）」保留。base 与 head 相同但有未提交改动时，默认
  直接选 worktree。
- 验证：demo 仓库 range 2 文件、worktree 2 文件、单提交 1 文件；
  扫描结果 2 / 1 条，切回 range 仍是 2 条。

## 2026-11-03 · 第十三轮补丁

- **旧二进制坑**：`~/.local/bin/intentflow` 还是 15:10 的旧版本，仍会去找
  `frontend/dist`。`scripts/build.sh` 现在检测 PATH，若旧文件在 `$HOME` 下
  且可写，直接覆盖。报错原文「前端产物不存在」只可能来自旧版本。
- **默认白色**：浅色调色板改成纯白 + GitHub 灰阶；默认主题从「跟随系统」
  改为「浅色」，并换用 `if-theme-2` 存储键，旧的 system 偏好
  不再生效。首屏脚本与 `useTheme` 同步。
- **payload 预算**：正文上限 6MB → 24MB；单文件上限 512KB → 2MB。
  分配改为按体积从小到大，避免目录顺序靠前的大文件吃掉全部预算。
  卡片列表顶部显示「N 个文件超出体积上限」。

## 2026-11-03 · 第十四轮：纯 diff 工作台与本地 PR Review

### 去掉 SSA

- 先定位 `--mode diff` 仍编译 SSA 的原因：`startScan` 未判断模式，
  diff 也排队编译，进而初始化 ssadb/gorm，报 `no such module: fts5`。
- `startScan` 对 diff 直接返回；`--mode scan|review` 改为明确报错。
- 从主模块删除旧 `internal/scan`、`internal/insight` 和 `syntaxflow/` 代码；
  需要查阅时从 Git 历史恢复。主模块不再导入 Yaklang、SSA、SQLite、Gorm。
- 主程序改为纯文本 diff；`go list -deps` 不再出现 Yaklang 包。
- 验证：系统调用跟踪没有打开任何数据库文件；只执行 intentflow 和 git。
  常驻进程约 9MB RSS，不再出现编译或 `zsh: killed`。

### Session 与 Review JSON

- 一个「仓库 + 分支 + 子目录」对应稳定 `session_id`；每个比较范围另有
  `comparison_id`，包含 base/head/revision 和 diff 内容摘要。
- Review 默认写入启动目录 `.intentflow/sessions/<session>/<comparison>.json`；
  可用 `--review-dir` 改到缓存目录。临时文件 + rename 原子替换，权限 0600。
- 恢复和导入都会校验版本、仓库、分支、子目录、base/head、revision、
  diff 摘要、评论行号和已查看文件。不匹配返回 409，当前评审不变。
- 损坏 JSON 不覆盖，报出具体路径。
- 同名分支的不同仓库隔离；同一提交的不同分支也隔离；detached HEAD
  使用 `detached:<sha>`。
- `.intentflow` 不参与工作区 diff，也不触发 worktree 默认选择。

### 前端

- 评论、总结、结论、已查看文件自动保存到服务端 JSON；400ms 防抖、
  串行写入。保存失败停在错误状态，不谎报已保存。
- 右栏显示分支和 session id；支持导入/导出 JSON、导出 Markdown、
  修改/删除/解决/重新打开评论、筛选未解决。
- 切换比较范围前先保存当前评审；加载期间禁用交互。
- 固定白色 GitHub 风格；右栏全高贴右，可拖动或键盘调整宽度，双击复位。
- 文件树 14px；每个 Tab 按 4 列渲染；长行底部有可拖动横向滚动块，
  分栏两侧独立同步。

### 分发与验证

- `scripts/build.sh` 使用 `CGO_ENABLED=0`，产出约 8.3MB 静态二进制，
  前端已 embed；脚本不再改 PATH 或替换软链接。
- PATH 入口已改为指向 `bin/intentflow` 的软链接。
- 验证通过：`go test -race ./cmd/... ./internal/...`；45 个前端测试；
  Playwright 验证保存、重启恢复、错误分支导入拒绝、revision 隔离、
  宽度拖动、Tab 缩进、拖动滚动块、自动换行、390px 抽屉，浏览器零错误。
- `make check` 通过。

## 2026-11-04 · 第十五轮：按评审意见补齐交互

### 文档定位

- 恢复 README 的产品定位：三层语义 diff + 行为图是目标，当前只是第一阶段。
- 恢复被删除的 yaklang 示例截图。
- docs/05、08、09 补充当前阶段与目标阶段的边界。

### 右栏

- 恢复 AI / SyntaxFlow / Review 三 tab 骨架。AI 与 SyntaxFlow 明确标注
  「未启用」，说明数据源依赖 SSA；Review 全功能。
- 恢复「提交 Review」下拉菜单：提交给 Agent（写 review.json 并复制 prompt）、
  复制 Review（JSON + prompt）、保存 .json、保存 .md。
- 底部保留导入 JSON / 导出 JSON / Markdown。

### 评论

- 行内评论渲染在对应代码行下方，右栏仍保留完整列表。
- 新增评论不再强制打开右栏；右栏收起时只在 diff 内显示。
- 左侧文件树显示评论数，目录显示聚合数。

### 已查看

- 每个 hunk 头增加「已查看」，键为 `<file>@<row>`，写入 `reviewed_hunks`。
- 文件级「已查看」一次性标记全部 hunk，取消时清空该文件的 hunk 标记。
- 全部 hunk 标记后文件自动算作已查看，卡片折叠，左侧文件行置灰。
- 重新打开页面时保持折叠和置灰状态。

### 图片

- 评论与总体意见都可带图，单条最多 4 张，单张 6MB。
- 服务端按内容 SHA-256 存储到 `.intentflow/assets/`，JSON 只存文件名。
- 支持点击选择、粘贴和拖入；格式限 png、jpg、gif、webp。
- `GET /api/review/assets/{name}` 提供图片，长缓存。

### 草稿恢复

- `GET /api/review/drafts` 列出当前分支 session 的其他比较范围草稿。
- `POST /api/review/drafts/{comparison_id}` 恢复；失效行号降级为总体意见，
  失效的已查看文件被丢弃。
- 右栏顶部提示草稿数量和保存时间，可一键恢复。

### 顺序与验证

- 文件树与 diff 卡片共用同一排序：以文件树 DFS 顺序为准。
- `git status` 使用 `-uall`，改动文件计数与实际文件一致。
- `make check` 通过：Go 测试、tsc、47 个前端测试。
- Playwright 验证：三 tab、hunk 折叠、左侧置灰、行内评论、评论计数、
  总体意见带图、草稿恢复、顺序一致、390px 抽屉，浏览器零错误。

## 2026-11-04 · 第十六轮：精简右栏与内容哈希

### 右栏

- Review tab 改成评论历史聚合，只保留顶部小输入框和评论卡片。
- 删除会话条、过滤、已查看进度、总结、结论、通过 / 请求修改和底部导出栏。
- 三个 tab 保持 AI / SyntaxFlow / Review；AI 与 SyntaxFlow 仍是未启用说明。
- 评论卡片支持解决 / 重新打开、修改、删除；修改时可继续粘贴图片。
- 导入 JSON 和导出入口移到顶部「提交 Review」菜单。

### 评论与图片

- 评论框改成两行输入，按钮「增加意见」；不再有图片按钮。
- 图片直接粘贴进正文，保存为 Markdown 图片，渲染时内嵌显示。
- 旧数据的 `images` 字段继续显示；新评论固定写 `images: []`。
- 导入旧 JSON 时剥离 `summary` / `decision` 等未知字段，避免严格解码失败。

### 已查看

- 文件级键改为 `<file>#<file digest>`，hunk 键改为 `<file>@<row>#<hunk digest>`。
- 摘要来自 cyrb53 内容哈希；代码内容变化后键不匹配，标记自动失效。
- 旧的无哈希标记在载入时丢弃；恢复旧草稿后失效标记也不会显示为已读。

### 数据模型

- `ReviewSession` 删除 `summary` 和 `decision`，评审只剩评论与已查看。
- `ReviewDraft` 删除 `summary`；草稿列表跳过 0 条评论的草稿。
- 生成类型同步更新；旧文件仍可读取，保存时写成新结构。

### 验证

- `make check` 通过：Go 测试、tsc、50 个前端测试。
- Playwright 验证：三 tab、评论增改删/解决、粘贴图片 160×60 渲染、
  旧 JSON 导入、草稿恢复、哈希失效、左侧字重 500，浏览器零错误。
- 8124 / 8125 已用新二进制重启，页面返回 200。


## 2026-11-04 · 第十七轮：全局搜索

### 入口

- 拦截 `Ctrl+F` / `Cmd+F`，不再打开浏览器原生查找。
- 顶部栏增加放大镜按钮，移动端同样可用。
- `F3` 在关闭状态打开搜索，在打开状态跳到下一条。

### 搜索范围

- 搜索所有文件的 diff 行：新增、删除、上下文和折叠区内的行。
- 同一行多次命中只显示一条，跳转以行为单位。
- 结果按文件分组，显示行号、变更类型和高亮片段。
- 结果超过 200 行时首批只渲染 200 条，可继续显示更多。

### 跳转

- 输入时自动跳到第一条结果；`Enter` / `Shift+Enter` 循环前后跳转。
- 点击结果调用现有 `code/reveal`，复用折叠展开和行定位。
- 已查看而折叠的文件会自动打开，目标行显示琥珀色定位条。
- 右上角放大镜与快捷键打开同一搜索面板。

### 验证

- 新增 4 个搜索单测；前端共 54 个测试通过。
- Playwright 验证：`Ctrl+F` 拦截、跨文件搜索、已查看文件自动展开、
  顶部折叠区展开、`Enter` / `Shift+Enter` 计数、移动端 390px 无横向溢出。
- 8124 / 8125 使用新二进制重启。


## 2026-11-04 · 第十八轮：选区搜索与导出菜单

### 搜索

- 按 `Ctrl+F` / `Cmd+F` 时，如果页面有选中文本，直接用它作为搜索词。
- 多行选区取第一行，因为搜索按 diff 行匹配。
- 搜索框已打开时，新的选区会替换当前关键词。
- `Esc` 关闭搜索；`Enter` / `Shift+Enter` 继续切换匹配。

### 提交 Review

- 菜单只保留 Markdown 和 JSON 两种格式。
- 每种格式各有「复制」和「保存文件」两个按钮。
- 复制 Markdown 得到人类可读评审；复制 JSON 得到完整评审数据。
- 删除「提交给 Agent」「复制 Review」「导入 JSON」和底部旧导出栏。
- 不再生成 Agent prompt。

### 验证

- 前端 54 个测试通过。
- Playwright 验证：鼠标选中代码后 `Ctrl+F` 自动填入选区、`Esc` 关闭、
  菜单只有两行四按钮、Markdown / JSON 复制内容正确、两个下载文件扩展名正确。


## 2026-11-04 · 第十九轮：搜索停留与折叠方向

### 默认布局

- Review 右栏默认收起，diff 占满主区域。
- 顶部「评审信息」按钮可随时打开；偏好存储键升级，旧默认值不再生效。

### 搜索

- 打开搜索、修改关键词都不再自动跳到第一条。
- 新关键词和打开搜索都选最接近当前视口的结果；跳转后重开仍在同一条。
- 回车跳到当前选中行；再按回车才前进到下一条。
- 上下方向键只移动选中行，不移动代码。
- 折叠文件仍会在跳转时自动展开，目标行滚动到搜索面板下方。

### 折叠区

- 修正上下展开方向：向下按钮露出上方 hunk 后面的 5 行，向上按钮露出下方 hunk 前面的 5 行。
- 点击「已折叠 N 行」文字或折叠条空白处，也向下露出 5 行。
- 连续点击可一直向下展开，直到折叠区消失。

### 验证

- Playwright 验证：首次加载无右栏、输入搜索不移动代码、回车跳选中行、
  重开搜索保持序号、方向键不移动代码。
- 折叠测试：38 行折叠区连续点击后依次露出第 9、14 行；向上按钮露出末端行。


## 2026-11-09 · 第二十轮：同名单词高亮

### 交互

- 单击 diff 代码中的标识符，按同一个单词高亮。
- 高亮跨文件生效，使用精确、区分大小写匹配。
- 再次点击同一个词取消；点击另一个词替换；点击代码空白处清除。
- 拖选复制时不触发，双击选择单词时保留已有高亮。

### 实现

- 从点击坐标取字符偏移，再按 Unicode 标识符边界取出单词。
- 单词存入 `AppProvider.code.word`，所有 diff 卡片共享。
- Go 语法高亮的每个 token 和普通语言文本都插入 `<mark>`。
- 蓝色背景加描边，和搜索目标行的琥珀色定位条区分。

### 验证

- 新增 4 个高亮单测；前端共 58 个测试通过。
- Playwright 验证：点击 `hash` 同时高亮两处、点击 `db` 切换、
  再点同一个词取消、点击空白清除、点击另一个词替换。


## 2026-11-09 · 第二十一轮：目录已查看

### 交互

- 目录下的文件全部已查看后，目录行变淡并显示 ✓。
- 目录内任一个文件取消已查看，目录立即恢复未查看状态。
- 只统计当前 diff 里的文件，已过滤的未变文件不参与。

### 实现

- `lib/tree.ts` 新增 `countFiles` 与 `countViewed`。
- 目录行复用文件行的 `isViewed` 判定，按文件 digest 校验。
- 目录名变淡沿用 `.dirRowDone`，不新增状态字段。

### 验证

- 新增 1 个目录计数单测；前端 59 个测试通过。
- Playwright 验证：勾选 `docs/` 四个文件后目录出现 ✓、
  刷新后仍在、取消其中一个后立即消失，控制台无错误。


## 2026-11-09 · 第二十二轮：搜索配色与符号面板

### 搜索

- 结果行按 diff 类型着色：新增绿、删除红、上下文中性。
- 行首色条与类型徽标同色，活动行仍保持蓝色。

### 符号面板

- 左栏下半部分新增「符号」面板，默认展开，可折叠并记住状态。
- 复用全局搜索：点击代码单词或输入符号，列出全部引用。
- 行内容、匹配高亮、三种颜色与搜索完全一致。
- 点击结果跳到对应文件行；折叠文件自动展开。
- 输入词与代码单词高亮共用 `code.word`。

### 实现

- 抽出 `SearchHitList` 与 `lib/searchHits`，搜索和符号面板共用。
- 新增 `SymbolPanel`，`App` 的左栏和抽屉都挂载。
- 搜索面板删除重复的命中列表代码。

### 验证

- 新增 3 个命中展示单测；前端 62 个测试通过。
- Playwright 验证：`func` 结果同时出现新增 / 删除 / 上下文三色；
  点击符号结果跳转；折叠后刷新仍收起，控制台无错误。


## 2026-11-09 · 第二十三轮：文件类型图标

### 图标

- 文件树、diff 卡片头、搜索结果分组头统一显示文件类型图标。
- 图标按文件名 / 后缀自动选择，覆盖 377 种类型。
- 使用 `material-file-icons`（Material Icon Theme，MIT）。

### 实现

- 新增 `FileTypeIcon`，缓存每个路径的 SVG。
- 文件树替换通用文件图标；卡片头和搜索结果补图标。
- 已查看文件的树图标降低透明度，和文件名状态一致。

### 验证

- 前端类型检查和 62 个测试通过。
- Playwright 验证：树 131 个图标、卡片头 131 个、搜索结果分组 28 个；
  Go / Markdown / TypeScript 图标按后缀区分，控制台无错误。


## 2026-11-09 · 第二十四轮：左栏宽度可调

### 交互

- 左栏右边缘新增拖柄，调整整个左栏宽度，文件树和符号面板同步变化。
- 范围 200–620px，默认 320px；窗口不超过 1300px 时默认 260px。
- 双击恢复 320px；方向键每次 24px，Home / End 到两端。
- 宽度写入 localStorage；刷新后保持。
- 打开右栏时按窗口宽度收缩左栏，尽量保留 360px 的 diff 区域。

### 实现

- `App` 新增 `--left-width` 变量、左栏拖柄和键盘处理。
- 左栏与右栏拖柄共用样式；拖动时直接写 CSS 变量，避免整页重渲染。
- 删除 1300px 固定 260px 的媒体规则，默认宽度交给初始化逻辑。

### 验证

- Playwright 验证：默认 320 → 拖动 410 → 刷新保持；
  End 到 620、ArrowLeft 到 596、Home 到 200、双击回 320；
  1200px 打开右栏后左栏收到 430、diff 仍有 360px，控制台无错误。


## 2026-11-09 · 第二十五轮：代码选区

### 交互

- 从行号、增删号或行尾空白拖动都能选中整行范围。
- 选区整行画蓝色左边条；拖到视口外自动滚动并继续扩展。
- `Ctrl+C` / `Cmd+C` 复制选中行；分栏模式只复制起点那一侧。
- 点代码单词会清除选区，`Esc` 或点击 diff 外也会清除。
- 有选区时按 `+`，评论引用变成多行区间。
- 有选区时按 `Ctrl+F`，搜索框填入选区首行。

### 实现

- 选区不依赖浏览器原生选区：行是虚拟化的，滚动时会重建 DOM。
- 选区状态是 `{side, anchor, focus}` 行索引，渲染时给整行加类。
- 复制走 `copy` 事件，按行重建文本，不混入另一侧。
- 新增 `lib/codeSelection.ts`，供搜索框读取选区首行。

### 验证

- Playwright 验证：分栏选区只落在起点侧、复制文本不含另一侧、
  多行评论引用为 `R1–6`、长距离拖动滚动后选中 60 行并复制 118 行、
  `Esc` 清除、统一布局选区正常，控制台无错误。


## 2026-11-09 · 第二十六轮：精确搜索开关

### 交互

- 搜索框和符号面板各加一个 `Aa` 按钮，切换精确搜索。
- 精确模式匹配完整单词并区分大小写；普通模式为忽略大小写的子串匹配。
- 搜索默认关闭精确，符号面板默认开启精确。
- 两个开关各自写入 localStorage，刷新后保留。

### 实现

- `searchDiff` 新增 `options.exact`；精确模式按标识符边界校验。
- 新增 `lib/exactPref.ts` 统一读写开关。
- 打开、切换开关都用同一个查询重新计算命中。

### 验证

- 新增 3 个精确匹配单测；前端 67 个测试通过。
- Playwright 验证：`func` 精确 291 行、普通 738 行；
  `Func` 精确 12 行、普通仍 738 行；`unc` 精确无结果、普通 839 行；
  两个开关刷新后保持，控制台无错误。


## 2026-11-09 · 第二十七轮：紧凑列表与符号面板开关

### 交互

- 搜索框的 `Aa` 改为只控制区分大小写，新增 `\b` 控制完整匹配。
- 符号面板去掉搜索输入框；两个开关放在「符号」标题行，点击标题仍可折叠。
- 符号面板默认区分大小写、完整匹配；搜索框两个开关默认关闭。
- 符号面板高度可拖顶部横条调整，双击恢复 300px。
- 文件树与符号列表行高收紧。

### 实现

- `searchDiff` 选项拆成 `caseSensitive` 与 `wholeWord`，互不依赖。
- `lib/exactPref.ts` 改为按面板存两个布尔值；旧的 `-exact` 键迁移为两个开关同时开启。
- 符号行使用 `variant="panel"` 的紧凑样式。

### 验证

- 前端 70 个测试通过，新增匹配开关迁移与整词匹配用例。
- Playwright：搜索 `search` 命中 130 行，开启整词 26 行，再开大小写 25 行；
  查 `Search` 区分大小写 1 行、关闭后 26 行。
- 符号面板折叠高度 29px，拖拽后 382px 并写入 localStorage；控制台无错误。


## 2026-11-09 · 第二十八轮：重命名与整段展开

### 重命名

- `git diff -M` 提供旧路径 → 新路径；目录比较与未跟踪文件按内容完全一致配对。
- payload 把删除 + 新增合成一个 `renamed` 文件，带 `old_path`。
- 卡片头显示旧路径删除线 → 新文件名；文件树显示 `R`。

### 折叠区

- 上箭头露出上方行，下箭头露出下方行；首尾折叠区只保留可用的一侧。
- 展开量按当前剩余行数计算，交替展开不再提前卡住。
- 双击折叠行露出整段；卡片头「展开全部」显示整个文件。

### 验证

- Go 测试覆盖 Git 重命名、内容一致配对与未变文件过滤。
- Playwright：`pkg/source-old.sf → pkg/new.sf` 单卡片、`R` 标记、正文含改动行。
- 折叠区：尾部 197 行点一次变 192 行且第 2 行可见；头部 196 行变 191 行；
  「展开全部」后折叠区为 0。


## 2026-11-09 · 第二十九轮：大 diff 首屏优化

### 问题

1757 个文件的评审首屏出现 17.9 秒长任务，输入延迟约 4 秒。

### 改动

- diff 卡片正文延迟渲染：展开且进入视口 1200px 内才计算 diff。
- 卡片只接收完整评论数组与 hunk 键数组，过滤放进卡片内部，恢复 memo。
- 视图切换、查看状态等回调改在卡片内 dispatch，避免每次渲染新建函数。
- 行定位改为等布局重排后再滚动，避免展开折叠区后仍停在卡片顶部。

### 验证

- 同一仓库 1374 个文件：首屏最长任务从 17.9 秒降到 0.76 秒；
  DOM 节点 79k → 48k；输入 5 个字符从 4.2 秒降到 0.48 秒；
  滚动期间无长任务。
- 搜索跳转命中行可见（scrollTop 1980，目标行在视口内）。
