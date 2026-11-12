#intentflow
# 三层语义 diff 模型

## 结构

```
git diff（或两个目录）
        │
        ├── L3 项目结构层 ── SSA ──────── 文件、函数定义
        ├── L2 逻辑结构层 ── SSA ──────── 函数调用边、分支
        └── L1 意图层     ── SSA + SF ─── 数据从入口到副作用
                                   │
                                   ▼
                        review.json（agent）+ 行为工作台（人）
                        schema/openapi.yaml 生成两侧类型
```

## 为什么不用 go/ast

早期版本用 go/ast 算 L3/L2，理由是「快」。代价是两套坐标系：

- AST 的行号、函数名、调用点与 SSA 的 `Call` 指令可能对不上。
- 同一个 `if` 在 AST 里是 `IfStmt`，在 SSA 里是 `*ssa.If`；两套判定逻辑会给出不同分支。
- 改一处调用关系，需要同时修两个分析器。

现在只编译一次 SSA，三层事实都从同一份 IR 读出：

- `Program.FileList` → 文件
- `Program.EachFunction` → 函数、参数、入口
- `*ssa.Call` → 调用边、调用点
- `*ssa.If` / `*ssa.Switch` → 分支、条件、guard
- SyntaxFlow → sink、source、shape

SSA 的代价是编译慢、标准库签名缺失会产生诊断。这是可接受的：一次 1 分钟换来一套可复现的行号与调用关系。

## 可信度分级

| 标注 | 含义 | 本项目里谁产出 |
|---|---|---|
| `EXTRACTED` | IR 里直接存在 | L3 全部、L2 全部 |
| `DERIVED` | 由 IR 事实经一层规则推出 | L1 全部（来源分类、到达形态、跨函数路径是规则映射的） |
| `INFERRED` | LLM 从语义推断 | 预留；AI 摘要不进入事实层 |
| `ASSERTED` | 来自 PR 描述 / commit message | 尚未接入 |
| `UNKNOWN` | 无依据 | — |

**L1 没有一条是 `EXTRACTED`。** 因为「数据流存在」是 IR 事实，但「这是一条 HTTP→SQL 链路」需要规则把叶子值映射成 `http_input` / `sql` 这些标签。映射规则可能错。

这条边界必须绷住。一旦把规则映射标成 `EXTRACTED`，可信度体系就失效了。

## 身份键：整个设计最容易错的地方

diff 只比较事实的 `Identity`，不比较行号、变量名、文件路径。所以 `Identity` 的设计直接决定 diff 质量。

### 第一版错了

最初的意图层身份键：

```
chain | 函数名 | 副作用类别 | 来源类别
```

跑 demo 的结果是 **意图层 ±0/0**，但实际改动是：

```go
// before —— 参数化，安全
db.QueryRow("SELECT id FROM users WHERE name = ?", name)

// after —— 字符串拼接，不安全
db.Query(fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%%%s%%'", name))
```

两边的身份键完全一样。**整个 demo 里最重要的改动，被 diff 吃掉了。**

### 修正

身份键加上「数据如何到达」：

```
chain | 函数名 | 副作用类别 | 来源类别 | 到达形态
```

到达形态（`Shape`）：

| Shape | 含义 | 判定 |
|---|---|---|
| `direct` | 参数直接传入 | `Parameter` |
| `format` | 经格式化函数拼接 | `Call` 且含 Sprintf / Join / Builder / Format |
| `concat` | 字符串拼接 | `BinOp` 且为 add |
| `member` | 取字段或下标 | `ParameterMember` |
| `call` | 其他函数返回 | 兜底 |

修正后：

```
ADDED    handleSearch → findUser → SQL   shape=format   src=http_input   [HIGH]
REMOVED  handleSearch → findUser → SQL   shape=direct   src=http_input   [INFO]
```

### 结论

> **语义 diff 的身份键必须编码「数据如何到达」，不能只编码「从哪里来、到哪里去」。**

因为「安全」与「不安全」的分界线不在端点，在中间：同样是 HTTP→SQL，参数化传参和字符串拼接是两件完全不同的事。

同理，用节点 ID（依赖路径）做图 diff 身份的工具，重构改文件名就会全量误报。这是同一个坑的另一种形态。

## 来源归一化

`findUser(name string)` 里的 `name` 是函数参数，但它最终来自 `handleSearch` 的 `r.URL.Query()`。

如果不处理，来源会同时是 `[function_param, http_input]`。而 `function_param` 只是中转 —— 一旦有人把这段逻辑搬进另一个函数，身份就变了，产生假 diff。

规则：**只要还有一个外部来源，就丢掉 `function_param`。**

## 事实抽取流程（L1）

对每条 sink 规则：

1. SyntaxFlow 匹配到调用，`$sink` 绑定调用本身，`$param` 绑定实参
2. 排除误报（`Exclude` 子串）
3. 对每个非常量实参：
   - `shapeOf(实参)` 判定到达形态，多个实参取最危险的
   - 候选集 = 实参本身 + `GetTopDefs()` 的叶子
   - 逐个 `classifySource` 得到来源类别
   - 用叶子所属函数补全跨函数 `path`
4. 来源归一化
5. 生成 Fact

**候选集必须包含实参本身。** `GetTopDefs()` 只返回叶子，而 `os.Getenv` 这类信息只存在于中间节点。只看叶子会把 `os.Getenv("X") + "/a"` 判成没有来源。
