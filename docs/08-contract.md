# 数据契约：一份 OpenAPI，生成 Go 与 TypeScript

> 目标：JSON 结构只在一个地方定义。Go 服务端、TypeScript 前端、离线 review.json 都使用生成出来的类型，不再各自手写一套。

## 1. 为什么选 OpenAPI，而不是 protobuf

| 方案 | 优点 | 代价 |
| --- | --- | --- |
| protobuf | 强类型、可扩展 gRPC、二进制 | 需要 proto 插件；JSON 走 protojson 命名规则；HTTP 语义要另写 |
| OpenAPI | 直接描述 HTTP JSON；工具成熟；可读 | 不适合二进制/流式 |
| 手写 TS + Go | 无生成步骤 | 一定漂移 |

intentflow 的接口是**本机 HTTP + JSON**，不是 gRPC。OpenAPI 能同时描述：

- 路径：`GET /api/payload`、`POST /api/review`
- 请求/响应 body
- 枚举与必填字段
- 前端可以直接 `openapi-typescript` 生成类型

所以选 OpenAPI 3.0.3。未来如果要 gRPC，可以从同一份模型迁到 proto，而不是现在引入两套。

## 2. 文件

```
schema/openapi.yaml              唯一事实来源
oapi-codegen.yaml                Go 生成配置
internal/contract/types.gen.go   生成：Go 结构体（勿手改）
frontend/src/api/schema.gen.ts   生成：TypeScript 类型（勿手改）
```

生成命令：

```bash
# Go
/home/wlz/go/bin/oapi-codegen -config oapi-codegen.yaml schema/openapi.yaml

# TypeScript
cd frontend
pnpm exec openapi-typescript ../schema/openapi.yaml -o src/api/schema.gen.ts
```

`make schema` 已串联两条命令；不要手改生成物。

## 3. 类型层次

```text
Payload
├── Review
│   ├── before / after
│   ├── project / logic / intent : Delta<Fact>
│   ├── signals : Signal[]
│   ├── notes : string[]
│   ├── behavior : BehaviorGraph
│   └── ai : AiSummary
└── CodeBundle
    └── files : CodeFile[]

BehaviorGraph
├── nodes : BehaviorNode[]
├── edges : BehaviorEdge[]          // id/from/to/kind/label/scenario
├── scenarios : BehaviorScenario[]
├── lanes : BehaviorLane[]        // 图例：角色 + 数量
├── entry : string
├── stageCount : int
└── stats : BehaviorStats

ReviewRequest
├── markdown : string
└── data : ReviewState
    ├── comments : Comment[]
    ├── dismissed : string[]
    └── kept : string[]

AiSummary
├── status : ok | unavailable | error
├── model : string
├── summary : string
├── risks : AiRisk[]
├── focus : string[]
└── generated_at : string
```

### 3.1 必填策略

除 `Comment.quote` 外，所有 schema 字段都标成 `required`。原因：

- oapi-codegen 对非 required 字段生成指针，扫描器代码会被 `*string` 污染。
- 空字符串/空数组足以表达「没有」，前端用 `status` 区分新增/删除文件。
- JSON 输出稳定，agent 不需要处理缺字段。

`Comment.quote` 是唯一可选字段：评论可以不引用代码。生成 Go 时是 `*Quote`，生成 TS 时是 `quote?: Quote`。

代价：`CodeFile.before/after` 在文件新增/删除时是空串，不是 `null`。前端必须看 `status`，不能看字段是否存在。

### 3.2 枚举

| 枚举 | 值 |
| --- | --- |
| `Confidence` | `EXTRACTED` / `DERIVED` / `INFERRED` / `ASSERTED` / `UNKNOWN` |
| `Layer` | `project` / `logic` / `intent` |
| `Severity` | `info` / `warn` / `high` |
| `DeltaKind` | `added` / `removed` / `modified` / `unchanged` |
| `CodeStatus` | 同上 |
| `BehaviorRole` | `trigger` / `decision` / `transform` / `effect` |
| `BehaviorEdgeKind` | `call` / `data` / `control` / `boundary` |
| `Side` | `before` / `after` |

## 4. Go 侧怎么用

`internal/model` 不再手写 JSON 结构，而是给生成类型起领域别名：

```go
type Fact = contract.Fact
type Delta = contract.Delta
type Review = contract.Review
type BehaviorGraph = contract.BehaviorGraph
```

这样扫描器、diff、signals、behavior 全部直接使用生成类型。只有 `FactSet`、`Identity`、`Diff` 这些领域函数留在 `model`。

服务端：

```go
var req contract.ReviewRequest
if err := json.Unmarshal(raw, &req); err != nil { ... }
```

响应：

```go
payload := contract.Payload{Review: review, Code: code}
```

`internal/payload` 直接返回 `contract.CodeBundle`，不再定义第二套 `CodeFile`。

## 5. TypeScript 侧怎么用

`frontend/src/types.ts` 只做重导出：

```ts
import type { components } from './api/schema.gen';

export type Fact = components['schemas']['Fact'];
export type Payload = components['schemas']['Payload'];
export type BehaviorNode = components['schemas']['BehaviorNode'];
```

组件不手写 JSON 字段。改 schema 后跑生成，类型错误会直接暴露。

前端自己的视图状态（缩放、选中、抽屉）不在契约里，放在 `state/`。

## 6. `review.json` 与 `review.md`

- `review.json`：`Review` 类型。`diff` 与 `serve` 都写。
- `review.md`：人/agent 读的 Markdown。`POST /api/review` 写入。
- `review-state.json`：`ReviewState` 类型，保存评论/忽略/保留。写入失败不影响主流程。

`review.json` 不包含源码；源码只在 `Payload.code` 里。这样 agent 读事实时不会被大段代码淹没。

## 7. 兼容规则

改 schema 时：

1. 新增字段必须 required，给默认值（空串/空数组/0）。
2. 删除字段前先在前端/Go 搜索使用点。
3. 枚举只能追加，不能改已有值。
4. 不改字段语义；要改就加新字段。
5. 生成后跑 `go build ./...` 与 `pnpm typecheck`。

版本号在 `info.version`。当前 `0.2.0`。

## 8. 当前验证

- `oapi-codegen v2.4.1` 生成 Go，无额外运行时依赖。
- `openapi-typescript 7.13.0` 生成 TS。
- `internal/model` 使用生成类型后，`go build ./...` 通过。
- 前端类型重导出后，`pnpm typecheck` 通过（见实现提交）。
