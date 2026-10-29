# intentflow

**一次改动，三个层面的语义 diff。**

不是「哪些行变了」，是「这次改动在语义上干了什么」。

```
意图层   数据从哪来 ──▶ 经过谁 ──▶ 到达什么副作用      需要 SSA
逻辑层   谁调用了谁                                    go/ast
项目层   依赖与函数结构的增删                           go/ast
```

## 为什么

代码里没有「意图」。意图在人的脑子里。所以：

- **IR 算得出**的：数据流、调用边、依赖。这些可复现。
- **IR 算不出**的：为什么这么改、合不合理。这些只能推断。

intentflow 把这两件事分层，**并给每条结论标可信度**。

## 状态

**实验性。** 只支持 Go，只有一轮 demo 验证过。

已完成：三层 diff、SSA 意图链抽取、review.json、独立前端工作台
（分支图、代码 diff、SyntaxFlow 分诊、Review 评论、提交给 Agent）。
未完成：LLM 叙述层、大项目验证、规则精度。

## 快速开始

```bash
# 前端只需要构建一次
cd frontend && pnpm install && pnpm build && cd ..

go build -o bin/intentflow ./cmd/intentflow

# 分析后直接打开工作台（默认 127.0.0.1:8123）
./bin/intentflow serve \
  --before examples/demo-go/before \
  --after  examples/demo-go/after \
  --out    examples/demo-go/out

# 只要结构化结果、不启动服务
./bin/intentflow diff --before ... --after ... --out ...
```

serve 输出：

```
examples/demo-go/out/
├── review.json         三层 diff 与关注点
└── review.md           在工作台里提交后写入
```

前端开发时另开一个终端：

```bash
cd frontend && pnpm dev
# http://127.0.0.1:5173   /api 代理到 8123
```

加 `-v` 看进度，加 `--dump-facts` 额外导出两侧全量事实，`--no-ssa` 跳过 IR 层。
`--addr` 改监听地址，`--dist` 改前端产物目录。

### 对比 demo

同一组 before/after 代码，同时生成 intentflow、PR Lens、Archify 的产物：

```bash
./examples/demo-go/generate.sh
# 产物在 examples/demo-go/out/，用上面的 serve 打开
```

第一次运行前需要先构建外部工具：PR Lens 执行 `pnpm install && pnpm build`，
Archify 无需构建。路径可用 `PR_LENS_DIR` / `ARCHIFY_DIR` 覆盖。

## demo 的输出

`examples/demo-go` 的改动是：把参数化查询改成字符串拼接，并新增一个从环境变量读文件的函数。

```go
// before
db.QueryRow("SELECT id FROM users WHERE name = ?", name)

// after
db.Query(fmt.Sprintf("SELECT id FROM users WHERE name LIKE '%%%s%%'", name))
```

intentflow 报出来的：

```
意图层 ±2/1

ADDED    handleSearch → findUser → SQL 执行
         shape=format  source=http_input      [DERIVED, HIGH]

ADDED    loadTemplate → 文件读写
         shape=concat  source=env             [DERIVED, warn]

REMOVED  handleSearch → findUser → SQL 执行
         shape=direct  source=http_input      [DERIVED, info]
```

「新增了一条拼接的 HTTP→SQL 链路，同时移除了原来的参数化链路」——

这句话不是 LLM 猜的，是两边 IR 做差做出来的。

## 目录

```
cmd/intentflow/       CLI 入口（diff / serve）
internal/model/       三层数据模型 + 可信度 + 身份键
internal/scan/        go/ast 解析（L3/L2）、SSA 抽取（L1）、信号派生
internal/emit/        review.json、facts.json
internal/payload/     源码包：before/after 文本与文件状态
internal/serve/       HTTP 工作台：/api/payload、/api/review、静态资源
frontend/             React + TypeScript + Vite 工作台
examples/demo-go/     before/after 演示
docs/                 探索文档
```

## 文档

| 文件 | 内容 |
|---|---|
| [docs/00-thesis.md](docs/00-thesis.md) | 论题：代码不能表达意图 |
| [docs/01-landscape.md](docs/01-landscape.md) | 六个相关项目盘点与分野 |
| [docs/02-layers.md](docs/02-layers.md) | 三层模型、身份键设计、抽取流程 |
| [docs/03-findings.md](docs/03-findings.md) | SyntaxFlow 实测行为与 Go 前端缺口 |
| [docs/log.md](docs/log.md) | 实验日志 |
| [docs/04-compare.md](docs/04-compare.md) | 同一 demo 的四工具对比：intentflow / PR Lens / Archify / graphify |
| [docs/05-frontend.md](docs/05-frontend.md) | review 工作台：布局、数据契约、交互 |

## 依赖

`github.com/yaklang/yaklang v1.4.9-beta4`（SSA 编译器 + SyntaxFlow 引擎）。

二进制约 277 MB，因为把整个 yaklang 链进来了。后续可以拆成独立进程。
