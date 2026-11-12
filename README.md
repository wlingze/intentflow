# intentflow

**一次改动，三个层面的语义 diff，加一张行为图。**

不是「哪些行变了」，是「这次改动在语义上干了什么」。

```
意图层   数据从哪来 ──▶ 经过谁 ──▶ 到达什么副作用      需要 SSA
逻辑层   谁调用了谁、在哪个条件里                       SSA
项目层   文件、函数与调用边的增删                        SSA

行为图   触发 ──▶ 判定 ──▶ 变换 ──▶ 效果               三层事实的场景投影
```

## 为什么

代码里没有「意图」。意图在人的脑子里。所以：

- **IR 算得出**的：数据流、调用边、依赖、条件。这些可复现。
- **IR 算不出**的：为什么这么改、合不合理。这些只能推断。

intentflow 把这两件事分层，**并给每条结论标可信度**。

行为图不是 LLM 画的。节点和边全部来自 SSA + SyntaxFlow；LLM 只读这些事实写摘要，不生成事实。

## 路线

三层语义 diff 和行为图是目标结构，不是当前全部能力。分阶段做，每阶段都能独立使用。

| 阶段 | 内容 | 状态 |
| --- | --- | --- |
| 一 | 文本 diff + 本地 PR Review：文件树、行内评论、不绑定文件的意见、已查看、评审 JSON | 可用 |
| 二 | 接回 SSA 事实层：项目层 / 逻辑层 / 意图层 diff，SyntaxFlow 关注点 | 未开始 |
| 三 | 行为图：触发 → 判定 → 变换 → 效果，函数下钻与代码联动 | 未开始 |
| 四 | LLM 叙述层：只读事实，写摘要、风险与复核顺序 | 未开始 |

第一阶段的工作台先做成一个能用的 review 平台。右侧 AI 与 SyntaxFlow
两个 tab 已经留有位置，当前显示「未启用」和数据来源说明。设计文档描述的目标
模型不变。

## 当前阶段：diff + Review

```bash
./scripts/build.sh
./bin/intentflow -t /path/to/repo --base main
```

前端直接嵌入 Go 二进制。运行时不需要 `frontend/dist`、Node.js 或 pnpm。
Git 比较需要系统安装 Git。

构建脚本只更新 `bin/intentflow`，不复制或覆盖 PATH 入口。

```bash
# 可选：让 PATH 入口始终指向构建产物
ln -sfn /absolute/path/to/intentflow/bin/intentflow "$HOME/.local/bin/intentflow"
intentflow --base main
```

### 比较范围

```bash
# 基线 → HEAD，不含未提交改动
intentflow --base main

# HEAD → 工作区，含未跟踪文件
intentflow --base main --head WORKTREE

# 指定提交范围
intentflow --base v1.0 --head HEAD

# 两个本地目录
intentflow --before /path/before --after /path/after
```

顶部明确展示仓库、当前分支和比较范围。下拉框可选择全部改动、未提交的改动、
单个提交。未指定 `--base` 时，只接受当前 HEAD 历史中的 `main`、`master`、
`origin/main`、`origin/master`，并选距离最近的一个；都不在历史里就要求显式
指定基线，不退回 `HEAD~1`。

### Review

- 在代码行旁点 `+` 添加评论；评论带文件、左右侧和行号。
- 拖动可跨行选中代码，`Ctrl+C` 复制；有选区时评论自动引用多行。
- 行内评论直接显示在 diff 里，右栏同时保留一份；右栏收起时不会强制弹出。
- 左侧文件树显示每个文件的评论数。
- 右侧评审面板默认收起；点顶部「评审信息」打开。
- 右栏可直接写意见，不绑定任何文件。
- 左侧文件树与符号面板共用可调宽度；拖右边缘或按方向键调整，双击恢复。
- 文件树、diff 卡片和搜索结果按后缀显示文件类型图标。
- 目录内文件全部已查看时，目录也标记为已查看。
- 点击 diff 中的单词，高亮所有同名标识符；再次点击同一个词取消。
- 评论正文可直接粘贴图片，图片随正文一起保存。
- 修改、删除、解决或重新打开评论；点击位置跳回代码。
- 每个 hunk 可单独标记「已查看」；全部标记后文件自动折叠、左侧置灰。
- 已查看记录带内容摘要；代码改动后旧标记自动失效，不会误显示为已读。
- 修改后自动保存为服务端 JSON；保存失败时明确提示。
- 「提交 Review」只提供 Markdown / JSON；每种格式可复制，也可保存为文件；`⌘↵` 直接复制 Markdown。
- Git 重命名显示为一张卡片：旧路径 → 新文件名，正文只显示内容改动。
- `Ctrl+F` / `Cmd+F` 打开全局搜索；有选中文本时直接搜索选区，回车逐条跳转。
- 搜索框和符号面板都有 `Aa`（区分大小写）与 `\b`（完整匹配）两个独立开关。搜索默认都关，符号默认都开。
- 搜索结果按新增 / 删除 / 上下文三种颜色标记。
- 左栏下半部分有可折叠的「符号」面板：点击代码单词列出全部引用，点击跳转；高度可拖拽调整。

一个「仓库 + 分支 + 比较子目录」对应一个稳定 `session_id`，相当于本地 PR。
不同仓库的同名分支不会串记录。同一 session 下每个比较范围另存草稿，
JSON 记录 `base/head/revision/diff_digest`，避免旧行号套到新代码。

默认写入**启动目录**的 `.intentflow/sessions/`，图片写入 `.intentflow/assets/`。
重新打开时只恢复完全匹配的记录；旧记录不匹配时不会套用到当前代码。
同一分支还有其它比较范围的草稿时，右栏会列出并支持恢复；失效行号降级为不绑定行号的意见。
`.intentflow` 不参与工作区 diff。

```bash
# 改到缓存目录
intentflow --base main --review-dir "$HOME/.cache/intentflow"
```

浏览器 localStorage 只存布局偏好，不作为评审数据源。

### 布局

- 固定白色页面，按 GitHub PR 的边框、灰阶和 diff 配色组织内容。
- 增删行里只给真正变化的词加底色：新增侧绿色，删除侧红色。
- 文件树把当前屏上显示的文件标灰，把刚点开的文件标蓝。
- 右栏全高贴住窗口右边，可拖动分隔线调整宽度，支持键盘和双击复位。
- 右栏三个 tab：AI（未启用）、SyntaxFlow（未启用）、Review。
- 制表位固定 4 列；长行提供可见横向滚动块，分栏两侧分别滚动。
- 窄屏使用抽屉，Esc 关闭。

## 参数

| 参数 | 说明 |
| --- | --- |
| `-t, --target` | Git 代码目录，默认 `.` |
| `--base` | Git 基线，默认按祖先关系检测 |
| `--head` | Git 终点，默认 `HEAD`；支持 `WORKTREE` |
| `--mode diff` | 默认且唯一模式；旧 `scan/review` 模式明确报错 |
| `--review-dir` | 评审 JSON 与图片目录，默认启动目录下 `.intentflow` |
| `--host` | 默认 `0.0.0.0`；仅本机访问可设 `127.0.0.1` |
| `--port` | 默认由系统直接绑定空闲端口 |
| `--before, --after` | 目录比较 |
| `--out` | `review.json` 导出目录 |
| `--dist` | 调试时覆盖内嵌前端 |
| `-l, --language` | 兼容参数；文本 diff 不依赖语言编译器 |

启动后打印实际端口及本机可访问地址。

## 后续阶段的设计

以下内容描述目标模型。当前构建不包含这些能力，代码位置也尚未恢复。
需要查阅旧实现时从 Git 历史恢复。

### 行为图

- **函数关系图**：只画函数调用关系；节点位置由调用边决定，不按文件顺序排列。
- **函数下钻**：点击函数，展开该函数的内部行为路径。
- **代码联动**：点路径里的任一步骤，跳到对应源码行。
- **项目改动树**：目录聚合增删行数与变更文件数。

### AI 在哪里

**不在图里，也不在 diff 里。**

- 节点和边来自 SSA + SyntaxFlow。
- `confidence` 只有 `EXTRACTED` / `DERIVED`，没有 `INFERRED` 节点。

LLM 是可选叙述层：读事实写摘要、风险和复核顺序。它不生成节点、边或行号。
每个论点都要求引用输入里的证据；没有配置端点时界面显示「未启用」。

## 开发与验证

```bash
make schema   # schema/openapi.yaml → Go + TypeScript 类型
make check    # go vet、Go 测试、tsc、Vitest
make build    # 前端构建 + 静态 Go 二进制
```

HTTP 契约见 [docs/08-contract.md](docs/08-contract.md)。评审持久化与匹配规则见
[docs/09-review-platform.md](docs/09-review-platform.md)。前端实现见
[docs/05-frontend.md](docs/05-frontend.md)。语义模型研究见
[docs/00-thesis.md](docs/00-thesis.md)、[docs/02-layers.md](docs/02-layers.md)、
[docs/07-behavior-model.md](docs/07-behavior-model.md)。

## 目录

```
cmd/intentflow/       CLI 入口
schema/openapi.yaml   唯一数据契约
internal/contract/    生成：Go JSON 类型
internal/gitcompare/  Git 比较范围与提交
internal/payload/     源码包：before/after 文本与文件状态
internal/reviewstore/ 评审 JSON 与图片存储
internal/serve/       HTTP 工作台与内嵌前端
frontend/             React + TypeScript + Vite 工作台
examples/             demo 与 yaklang 分支切片
docs/                 调研、模型、契约与日志
```

## 文档

| 文件 | 内容 |
| --- | --- |
| [docs/00-thesis.md](docs/00-thesis.md) | 论题：代码不能表达意图 |
| [docs/01-landscape.md](docs/01-landscape.md) | 相关项目盘点与分野 |
| [docs/02-layers.md](docs/02-layers.md) | 三层模型、身份键设计、抽取流程 |
| [docs/03-findings.md](docs/03-findings.md) | SyntaxFlow 实测行为与 Go 前端缺口 |
| [docs/04-compare.md](docs/04-compare.md) | 同一 demo 的四工具对比 |
| [docs/05-frontend.md](docs/05-frontend.md) | 工作台布局与交互 |
| [docs/06-behavior-research.md](docs/06-behavior-research.md) | PDG/CPG/Flows 调研 |
| [docs/07-behavior-model.md](docs/07-behavior-model.md) | 行为视图定义、身份键、阶段、diff 规则 |
| [docs/08-contract.md](docs/08-contract.md) | OpenAPI 单一定义与生成 |
| [docs/09-review-platform.md](docs/09-review-platform.md) | 评审持久化与验收约定 |
| [docs/log.md](docs/log.md) | 实验日志 |
