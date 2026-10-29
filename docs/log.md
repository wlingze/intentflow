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
