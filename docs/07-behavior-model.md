# 行为视图：定义与生成规则

> 本文是 `docs/06-behavior-research.md` 的落地规范。
> 读完本文应该能回答：图里有哪些节点、边怎么连、before/after 怎么比、为什么这样画。
>
> 依赖的 JSON 契约见 `schema/openapi.yaml`，生成方式见 `docs/08-contract.md`。

## 1. 一句话定义

**行为视图是代码依赖图的一个场景投影：把一次改动的端到端执行拆成「触发 → 判定 → 变换 → 效果」，按 scenario 分行，按稳定身份做 diff。**

它不是调用图，不是控制流图，也不是 LLM 生成的架构图。

## 2. 四个角色

| 角色 | ID | 回答的问题 | 判定规则 | 颜色 |
| --- | --- | --- | --- | --- |
| 触发 | `trigger` | 谁启动这段行为？ | 函数签名是 HTTP handler、`main`、`ServeHTTP`、`Test*`；或调用链最外层 | 蓝 |
| 判定 | `decision` | 哪个条件选择路径？ | 路径函数里的 `if` / `switch` / guard | 琥珀 |
| 变换 | `transform` | 数据经过谁、怎么变？ | 路径上的中间函数 | 中性 |
| 效果 | `effect` | 最终发生了什么？ | SyntaxFlow 命中的 sink | 绿 / 红 / 琥珀（按 delta） |

### 2.1 为什么是这四个

- **触发**：没有入口的行为不可 review。先定「谁能让它跑」。
- **判定**：这是旧图最缺的。安全与设计问题经常在条件里，而不在 sink 里。
- **变换**：数据形状变化是 bug 与注入的根源。`direct` / `format` / `concat` 必须可见。
- **效果**：review 最终要回答「这次改动让系统多做了什么/少做了什么」。

### 2.2 不采用的命名

| 候选 | 不采用的原因 |
| --- | --- |
| 入口 / 处理链 / 副作用 | 污点分析管线，把判定和变换压成一段；按调用深度分列 |
| Source / Propagation / Sink | 同上，安全术语，不适合业务 review |
| Event / Condition / Action | 接近 ECA 规则，但 Action 同时包含变换与效果，无法区分 |
| Input / Process / Output | 太泛，无法区分判定与数据构造 |

「触发 / 判定 / 变换 / 效果」不是行业标准术语，但每个词都对应一个可判定的程序结构，并且能直接映射到 PDG 的控制依赖/数据依赖。

## 3. 节点

### 3.1 字段

```jsonc
{
  "id": "decision:handleSearch:d00cb322",
  "role": "decision",
  "stage": 1,
  "label": "name == \"\"",
  "detail": "if",
  "file": "main.go",
  "line": 37,
  "function": "handleSearch",
  "package": "main",
  "delta": "added",
  "confidence": "DERIVED",
  "evidence": [],
  "tags": ["if"],
  "snippet": "name == \"\"",
  "source": "",
  "shape": "",
  "category": "",
  "change": ""
}
```

- `stage` 由拓扑最长路径计算，不由角色固定。
- `evidence` 指向 `Fact.identity`。效果节点必须有 evidence；判定节点可以没有（它是规则推导）。
- `confidence`：触发/判定/变换为 `DERIVED` 或 `EXTRACTED`；效果沿用事实的可信度。
- `change` 只在 `delta=modified` 时非空，例如 `direct → format`。

### 3.2 稳定身份

| 节点 | identity | 说明 |
| --- | --- | --- |
| 触发 | `trigger:<function>:<filehash>` | 同名函数按文件区分 |
| 判定 | `decision:<function>:<filehash>:<hash(groupLabel, groupLine)>` | 同一条件组一个节点；分支是边 |
| 变换 | `transform:<function>:<filehash>` | 同名函数按文件区分 |
| 效果 | `effect:<category>:<function>:<filehash>` | **不含 shape**，shape 变化才是 modified |

行号不进入 identity。改注释、挪行不会产生新节点。

### 3.3 判定节点的粒度

一个 `if`/`switch` 语句是一个判定节点，不是每个分支一个节点。

```
        ┌─────────────────────┐
        │ switch { HasPrefix }│
        └──────┬───────┬──────┘
          true │       │ default
               ▼       ▼
            effect   effect
```

- 分支是**边**，标签是 `true` / `false` / `case 值` / `default`。
- 这样同一条件的多个分支不会在图上散成多个节点。
- 如果两个分支都到达同一个效果，效果节点只有一个，入边有两条。

## 4. 边

| 类别 | ID | 语义 | 例子 |
| --- | --- | --- | --- |
| `call` | `from>to:call` | 函数调用 | `handleSearch → findUser` |
| `data` | `from>to:data:<shape>:<source>` | 数据流入副作用 | `format · http_input` |
| `control` | `from>to:control:<label>` | 条件选择 | `true` / `false` / `继续` |
| `boundary` | `from>to:boundary:<kind>` | 跨包/跨服务（预留） | `pkg:store` |

- 数据边的 identity **包含 shape 与 source**，所以 before 的 `direct` 和 after 的 `format` 会同时出现：一条 removed，一条 added。
- 控制边从判定节点指向被选中的下一步。
- 调用边不携带 shape；shape 只属于数据边。

## 5. Scenario

一条 scenario 是一条端到端路径：

```jsonc
{
  "id": "scenario:trigger:handleSearch:effect:sql:findUser",
  "trigger": "trigger:handleSearch",
  "effect": "effect:sql:findUser",
  "title": "handleSearch → SQL 执行",
  "delta": "modified",
  "nodes": ["trigger:handleSearch", "decision:handleSearch:...", "transform:findUser", "decision:findUser:...", "effect:sql:findUser"],
  "source": "http_input",
  "shape": "format",
  "category": "sql"
}
```

- 同一个入口的不同效果是不同 scenario（variant）。
- 同一个效果被两个分支到达时，scenario 只有一个，判定节点有两个出边。
- `nodes` 是行内顺序：触发到效果。边补充数据/控制语义。

### 5.1 路径还原

不用 `Fact.Path` 直接当调用链。原因：`Fact.Path` 是 SSA 追源时碰到的函数集合，包含旁支。

正确做法：

1. 从 `Fact.Function`（sink 所在函数）开始。
2. 从 SSA 调用边索引里找调用者（`from → to`，带文件路径）。
3. 优先选出现在 `Fact.Path` 里的调用者；其次选入口函数；最后选第一个未见过的调用者。
4. 直到 `main` 或没有调用者。
5. 反转得到「入口 → … → sink 函数」。

## 6. 行排版

### 6.1 规则

1. 一条 scenario 占一行。
2. 行内按 `scenario.nodes` 从左到右排；效果在行末，不再对齐全局最右列。
3. 不同 scenario 之间不画边。
4. `stage` 仍保留在 JSON 里，作为角色/因果深度的元数据；UI 不再用它做全局列布局。
5. `stageCount` 只用于统计。

### 6.2 为什么不用固定四列

固定四列 = 假设判定只出现在触发之后、变换之前。真实代码里：

```go
func findUser(name string) {
    switch { ... }        // 判定在变换之后
    rows, err := db.Query(query)
}
```

如果判定固定在第二列，而 `findUser` 在第三列，边会从右往左画。阶段排版允许判定出现在任意位置，角色只决定颜色和图标。

### 6.3 当前 demo 的排版

```
01  handleSearch → SQL 执行
    [IN] → [name == ""] → [findUser] → [switch] → [SQL 执行]
                                        ╰── format 数据边 ──╯

02  handleSearch → 文件读写
    [IN] → [name == ""] → [loadTemplate] → [文件读写]
```

- `name == ""` 是新增 guard，两条 scenario 都经过它。
- `switch` 只属于 SQL 路径，不会连到文件读写。
- 数据边 `format` 从 `findUser` 跨过判定，画在行下方，避免被卡片遮住。

## 7. Diff 规则

### 7.1 节点

| before | after | delta |
| --- | --- | --- |
| 无 | 有 | added |
| 有 | 无 | removed |
| 有 | 有，属性相同 | unchanged |
| 有 | 有，`label/detail/source/shape` 不同 | modified |

效果节点的 identity 不含 shape，所以 `direct → format` 是 **modified**，不是 removed+added。

### 7.2 边

- 数据边 identity 含 shape/source：`direct` 与 `format` 是两条边，分别 removed/added。
- 调用边/控制边 identity 含 label：条件文本变了就是新边。
- 两边都存在的边标 unchanged。

### 7.3 Scenario

- 一条 scenario 在数据里仍是一条独立路径。
- 主图只画函数调用；点函数后，底部按 scenario 列出该函数涉及的内部路径。
- 不同 scenario 之间不画边；每条路径保留自己的判定与效果。
- 同一 trigger+effect 在两边都存在：比较 `nodes`、`source`、`shape`。
- 路径或 shape 变了 → modified。
- 只在一侧 → added/removed。

### 7.4 UI 投影

同一份行为图在 UI 里有两个投影：

| 位置 | 内容 | 规则 |
| --- | --- | --- |
| 主图 | 函数调用关系 | 按 `function + file` 合并角色节点；只保留调用边 |
| 底部下钻 | 某个函数的内部路径 | 保留触发/判定/变换/效果与数据边 |

主图节点位置由调用边决定，文件只作为节点元数据，不再按文件框分组。
聚合和下钻只发生在 UI，不改变 `review.json` 里的节点和边。

## 8. 与三层事实的关系

| 层 | 作用 | 行为图怎么用 |
| --- | --- | --- |
| 项目层 | import、func、包 | 函数位置、包名、入口分类 |
| 逻辑层 | 调用边、调用点 | 还原 scenario、找 decision 所在函数 |
| 意图层 | source → sink 链、shape | 生成 effect 与 data 边 |
| 行为图 | 场景投影 | 不产生新事实；只重新组织已有事实 |

**行为图不替代三层 diff。** 三层 diff 是事实清单；行为图是 review 视图。两者都保留。

## 9. AI 在哪里

图里没有 LLM。

- 图的节点/边全部来自 SSA + SyntaxFlow。
- `confidence` 只有 `EXTRACTED` / `DERIVED`。
- 没有 `INFERRED` 节点。

可选的 LLM 叙述层：

- 只生成 `summary`、`risks`、`focus`，不生成节点/边。
- 每个论点必须引用 `evidence`（Fact.identity、文件行号或节点标题）。
- UI 单独放在 AI tab，不能和确定性分析混在一起。
- 未配置端点时返回 `unavailable`，分析照常完成。
- 默认模型是 `deepseek-v4.1-flash`；可用 `INTENTFLOW_LLM_MODEL` 覆盖。

## 10. 已知限制

1. **只支持 Go。** 入口规则、sink 规则、SSA 分支解析都是 Go 专用。
2. **判定的路径敏感性有限。** 只记录「调用在哪个分支里」，不做完整路径条件求解。
3. **效果节点按 `category + function` 合并。** 同一函数里两个同类别 sink 会合并；后续可加 sink 签名。
4. **跨包路径依赖 SSA 短名。** 目前取最后一段，跨包同名函数可能混淆。
5. **没有循环/异步建模。** goroutine、channel、定时器暂不进入图。
6. **没有边界边。** `boundary` 枚举已预留，当前不生成。

这些限制会写进 review 的运行说明，避免让人误以为图是全量语义。
