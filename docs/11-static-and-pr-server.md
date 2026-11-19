# 单 diff、静态导出与 PR 服务

本文说明一份补丁如何变成工作台数据，以及三种交付方式的边界。

## 1. 方案对比

| 方案 | 数据需求 | 部署成本 | 能做什么 | 限制 |
| --- | --- | --- | --- | --- |
| 纯静态导出 | 一份 patch；构建时生成 `payload.json` 与 `revisions.json` | 最低：任意静态文件服务器，或对象存储 + CDN | 看 diff、文件树、搜索、符号引用、写评审、导出 Markdown/JSON | 没有服务端；不能切换 commit 范围；patch 之外的未改源码不存在；评审只存浏览器 |
| 服务端托管 | 每个 PR 一份 patch；目录按 owner/repo/number 排列 | 中：一个 Go 二进制 + 反向代理 + 磁盘 | 路径路由、索引页、静态导出同样的交互、按需抓取公开 PR | 需要进程与磁盘；默认不写评审；GitHub 抓取受公开仓库与限流约束 |
| 浏览器插件 / 油猴脚本 | 运行在 github.com PR 页，读 DOM 或调用 GitHub API | 高：需要扩展商店、权限、跨域与内容脚本维护 | 直接在 PR 页注入工作台，可复用登录态 | 浏览器与商店审核；GitHub DOM 变更会破坏注入；无法覆盖非 GitHub 的 patch 文件；安装门槛高 |

结论：

1. 纯静态导出解决「只有一份 diff、想发给别人看」。
2. `serve --pr-dir` 解决「一台服务器上按路径浏览多个 PR」。
3. GitHub 双向采用 B（REST API）；A（Actions）作为发布层；C（浏览器注入）暂不做。

### 1.1 GitHub 接入路线

| 路线 | 数据需求 | 部署成本 | 能力 | 限制 | 取舍 |
| --- | --- | --- | --- | --- | --- |
| A. GitHub Actions | PR 事件、PR diff、Pages 或 artifact 权限 | 中：一个 workflow + Pages 设置 | PR 打开/更新时生成静态 review 页，自动回贴链接 | Fork PR 的 `GITHUB_TOKEN` 只读；Pages 需要仓库设置；无法写回行级评论 | 采用为发布层，不替代 API |
| B. GitHub REST 双向 | PR 元数据、聚合 diff、已有 review 评论、写 review 权限 | 低：一个命令 + 环境变量 token | 拉 patch 与评论；把本地评论映射成行级 comment；提交 comment / approve / request changes | 需要 token；受权限、限流、outdated 行约束；当前是 CLI 提交，未做按钮 | **最小闭环，采用** |
| C. 浏览器注入 | PR 页 DOM 或 GitHub API、扩展权限 | 高：扩展商店/油猴安装、权限、DOM 维护 | 在 PR 页内直接看 diff、写回评论 | GitHub DOM 变更会破坏；安装门槛高；审核与跨域成本高 | 暂不做 |

Actions 和 API 不是二选一：Actions 负责「让每个人打开一个链接」，API 负责「把 review 写回 PR」。插件方案在当前阶段不划算：它多一套运行环境，却没有增加 diff 能力。

## 2. 数据流

```
patch 文件 / stdin
        │
        ▼
internal/patch       解析 unified diff；.patch 多提交按路径合并
        │
        ▼
internal/payload     BuildPatch：状态、语言、体积预算
        │
        ▼
internal/prdiff      补丁身份、Comparison、ReviewSession
        │
        ├── internal/export   写 index.html + assets + api/*.json
        ├── serve.Listen      单补丁工作台
        ├── serve.ListenPR    /pr/<owner>/<repo>/<number> 多 PR 工作台
        └── internal/ghreview  GitHub REST：读 PR/diff/评论，写 review
```

前端只认两种 JSON：

- `api/payload.json`：`Payload`，包含 `review`、`code`、`session`。
- `api/revisions.json`：`RevisionList`。补丁只有一个 `range` 条目。

评审评论、已读标记与布局偏好仍然只存 `localStorage`，服务端不写磁盘。静态导出因此不需要后端。

## 3. 补丁如何变成 before/after

`internal/patch` 不要求 Git 仓库，也不执行补丁。它按 hunk 头读取行号，把 hunk 放到对应位置：

- hunk 内上下文行同时进入 before 与 after。
- `-` 行只进入 before，`+` 行只进入 after。
- hunk 之间缺失的未改行用空行占位，保证后续 hunk 的绝对行号正确。
- `diff --git`、`---`/`+++`、`new file mode`、`deleted file mode`、`rename from/to`、二进制标记都识别。
- GitHub `.patch` 是每个 commit 一段 diff。解析器按路径合并：第一段提供旧侧，后续 hunk 依次补到新侧。这样「PR 里新增后又修改」的文件仍然是一张新增文件卡片。

边界：patch 只带 hunk 附近的上下文。展开被折叠的未改区间时，看到的是空占位行，不是仓库里的真实源码。hunk 本身的行号、增删标记和行内高亮是正确的。

已用 `wlingze/intentflow#4` 验证：同一 PR 的 `.patch` 与 GitHub 聚合后的 `.diff` 解析结果逐文件一致（22 个文件，before/after 完全相同）。

## 4. 静态导出

```bash
intentflow export --diff fix.patch --out site
python3 -m http.server --directory site 8000
# http://127.0.0.1:8000/
```

产物：

```
site/
  index.html
  assets/index-*.js
  assets/index-*.css
  api/payload.json
  api/revisions.json
```

前端请求相对路径 `api/payload.json`。因此把整个目录放到任意子路径也能工作，只要通过 HTTP 访问。`file://` 不行：ES module 在 `file://` 下被浏览器拦截。

静态化后仍然可用：

- 文件树、目录折叠、过滤。
- hunk 展开、分栏/统一视图、自动换行。
- 行级评论、跨行评论、总评、已读标记（localStorage）。
- 全局搜索、符号引用、复制 Markdown/JSON。

静态化后失效：

- 切换比较范围：只有一份 patch，`revisions` 只有 `range`。
- 服务端评审持久化：本来就没有；换浏览器或清 localStorage 会丢评论。
- 自动抓取新 patch：静态文件不会变。
- 未包含在 patch 里的源码跳转：没有数据。

`--force` 只覆盖同名文件，不删除旧哈希资源。清理旧产物请手动处理输出目录。

## 5. 服务模式：按路径浏览 PR

```bash
intentflow serve --pr-dir /srv/intentflow/prs --host 127.0.0.1 --port 8080 --no-open
```

目录约定：

```
/srv/intentflow/prs/
  wlingze/
    intentflow/
      4.patch                 ← 主约定，可放 git format-patch 或 unified diff
      4.diff                  ← 备选；与 4.patch 同时存在时优先 .patch
      4.json                  ← 可选：{"title": "页面显示的标题"}
```

规则：

1. `GET /pr/<owner>/<repo>/<number>` 重定向到带斜杠的路径。
2. `<number>.patch` 优先，其次 `<number>.diff`。
3. 本地都没有且未加 `--no-github` 时，抓 `https://github.com/<owner>/<repo>/pull/<number>.diff`，成功后缓存为 `<number>.diff`。
4. 抓取需要 30 秒内完成，补丁上限 32 MiB。公开仓库不需要 token；私有仓库设置 `GITHUB_TOKEN` 或 `GH_TOKEN`。
5. `4.json` 只影响索引页和 revision 标签，不参与 diff。

路由：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 索引页，列出本地补丁，并提供 owner/repo/number 表单 |
| GET | `/pr/<owner>/<repo>/<number>` | 308 到带斜杠路径 |
| GET | `/pr/<owner>/<repo>/<number>/` | 工作台 HTML |
| GET | `/pr/<owner>/<repo>/<number>/api/payload.json` | 该 PR 的 payload；也接受无 `.json` 后缀 |
| GET | `/pr/<owner>/<repo>/<number>/api/revisions.json` | 只有 `range` 的 revision 列表 |
| GET | `/pr/<owner>/<repo>/<number>/assets/*` | 内嵌前端资源 |
| GET | `/healthz` | `ok`，供反向代理探活 |

索引页链接使用相对路径 `pr/...`，表单提交到当前路径。反向代理若挂在子路径下，需要先剥掉前缀再转发到根路径。

部署示例（nginx）：

```nginx
location /pr/ {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

二进制本身只监听一个端口；静态资源和 API 都由它提供，不需要额外的 web 服务器目录。

## 6. GitHub API 模式（已实现）

```bash
export GITHUB_TOKEN=...                 # 只从环境变量读，不落盘
intentflow github open --repo owner/repo --pr 4
# 在浏览器里写评论，用「提交 Review」导出 JSON
intentflow github submit --repo owner/repo --pr 4 --review intentflow-review-....json --event comment
intentflow github submit --repo owner/repo --pr 4 --body "LGTM" --event approve
intentflow github submit --repo owner/repo --pr 4 --body "请先修这个" --event request-changes
intentflow github submit --repo owner/repo --pr 4 --review review.json --event comment --dry-run
```

读取：

- `GET /repos/{owner}/{repo}/pulls/{number}`：标题、base/head SHA、状态。
- 同一路径加 `Accept: application/vnd.github.v3.diff`：整个 PR 的聚合 diff，不是每个 commit 一段。
- `GET /repos/{owner}/{repo}/pulls/{number}/comments`：行级 review 评论，每页 100 条，最多 10 页。

写入：

- `POST /repos/{owner}/{repo}/pulls/{number}/reviews`。
- `commit_id` 取提交时重新读取的 PR head SHA；不提供覆盖，避免行号按旧 diff 映射。
- `event`：`comment` → `COMMENT`，`approve` → `APPROVE`，`request-changes` → `REQUEST_CHANGES`。

### 6.1 行号映射

intentflow 的评论引用是 `quote.file` + `quote.side` + `start..end`。映射到 GitHub：

| intentflow | GitHub review comment |
| --- | --- |
| `quote.file` | `path` |
| `quote.side = after` | `side = RIGHT` |
| `quote.side = before` | `side = LEFT` |
| `start = end` | 只发 `line` |
| `start < end` | 发 `start_line` + `line` + `start_side` |
| 标题 + 正文 | `body`，标题加粗 |

`position` 是旧的 diff 行偏移，跨 hunk 与多行评论都容易算错；这里不用它。GitHub 当前的 review API 接受 `line`/`side`/`start_line`/`start_side`，语义比 `position` 稳定。

outdated 行处理：

1. 提交时重新抓当前 PR diff，不信任打开工作台时的旧 diff。
2. 只有落在某个 hunk 的旧侧/新侧范围内的行才发成 inline comment。
3. 落不到当前 diff 的评论，写入 review body 的「未映射到当前 diff 的评论」一节，不会让整个 review 因 422 失败。
4. 已有 GitHub 评论（ID 以 `gh-` 开头）会在提交时跳过，不重复提交；界面里仍可本地编辑，但改动不会写回 GitHub。本地标记为已解决的评论不提交。

### 6.2 权限与 token

| 场景 | 需要的权限 |
| --- | --- |
| 公开仓库，只读 patch/评论 | 匿名也可，但限流很紧；建议 token |
| 公开仓库，提交 review | classic PAT 的 `public_repo`，或 fine-grained 的 `Pull requests: Read and write` |
| 私有仓库，读 + 提交 | classic PAT 的 `repo`，或 fine-grained 的 `Pull requests: Read and write` + `Contents: Read` + `Metadata: Read` |
| GitHub Actions | `permissions: pull-requests: write`、`contents: read`；`GITHUB_TOKEN` 自动注入 |

- token 只从 `GITHUB_TOKEN` 或 `GH_TOKEN` 读，不写配置文件、不写 URL、不打印。
- GitHub Enterprise 用 `GITHUB_API_URL` 覆盖 API 根地址。
- 不要给 review 任务 `admin`、`delete_repo` 等无关 scope。

### 6.3 失败与限流

| 状态 | 行为 |
| --- | --- |
| 401 | 提示 token 无效或过期；不重试 |
| 403 / 429 | 读到 `X-RateLimit-Reset` 或 `Retry-After` 时打印重置时间；不自动重试 |
| 404 | 提示仓库/PR 不存在或 token 无权访问 |
| 422 | 打印 GitHub 的 `message` 与 `errors`（含「不能 approve 自己的 PR」这类原因）；`--dry-run` 可先检查映射 |
| 5xx / 网络错误 | 直接失败并保留原因；用户自行重试 |

限制：单次响应上限 32 MiB；review JSON 上限 8 MiB；评论最多读 1000 条。没有实现自动 backoff、条件请求或分页重试。

### 6.4 自己不能 approve 自己

GitHub 拒绝 PR 作者对自己的 PR 执行 `APPROVE` 或 `REQUEST_CHANGES`（HTTP 422）。验证时用一个由 `github-actions[bot]` 创建的临时 PR 验证了这两个事件。实际使用中，审批人必须是另一个账号。

## 7. GitHub Actions 用法

示例工作流在 [docs/examples/github-actions-review.yml](examples/github-actions-review.yml)。它做四件事：

1. `pull_request` 触发，`gh pr diff` 取聚合 diff。
2. 下载 intentflow release，`intentflow export --diff pr.diff --out site`。
3. 上传 Pages artifact 并部署。
4. 用 `gh pr comment` 回贴访问链接。

关键权限：

```yaml
permissions:
  contents: read
  pull-requests: write
  pages: write
  id-token: write
```

注意：

- 来自 fork 的 `pull_request` 使用只读 `GITHUB_TOKEN`，回贴评论会失败。需要评论时用同仓库分支，或单独用 `pull_request_target` / `workflow_run` 只做评论；后者不要 checkout 并执行不可信代码。
- Pages 需要在仓库设置里选择 GitHub Actions 作为 source。
- 不想开 Pages 时，把 `actions/deploy-pages` 换成 `actions/upload-artifact`，评论里贴 artifact 链接；artifact 需要登录，体验不如 Pages。
- 示例只是模板，本仓库没有启用该 workflow。

## 8. 不推荐的做法

- 把 token 写进 URL、命令行参数、`.env`、仓库变量或日志。URL 和进程列表会泄漏。
- 用 `admin:repo_hook`、`delete_repo` 等宽 scope 只为了发 review。
- 用 `position` 猜行号；跨 hunk、多行评论和 outdated 行都会错。
- 把 GitHub HTML 当 API 抓取；页面结构变化就失效。
- 自动 approve / 自动 request changes 的机器人；评审应该由人决定。
- 为了测试在别人的真实 PR 上提交 review；用临时仓库或自己的测试 PR。
- 在 `pull_request_target` 里 checkout 并运行 PR 作者的代码，同时给它写 token。

## 9. 验证记录

静态导出：

```bash
intentflow export --diff pr4.patch --out static-pr4
python3 -m http.server --directory static-pr4 8132
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8132/
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8132/api/payload.json
```

服务模式：

```bash
intentflow serve --pr-dir prs --no-open --host 127.0.0.1 --port 8134
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:8134/pr/wlingze/intentflow/4
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8134/pr/wlingze/intentflow/4/api/payload.json
```

GitHub API（临时公开仓库，PR 已关闭、分支已删除，仓库已归档）：

- PR #1（作者 wlingze）：`intentflow github open` 读到 1 个文件、0 条初始评论；提交 `comment` review 成功，返回 `COMMENTED`。GitHub 上只有 1 条 inline comment；2 条越界评论进入 review body。
- `curl GET /repos/.../pulls/1/reviews` 返回 200，review id `5971092846`，state `COMMENTED`。
- `curl GET /repos/.../pulls/1/comments` 返回 200，inline comment 在 `demo.txt:2`、side `RIGHT`。
- 重新编译后再提交一次：review id `5971188100`，state `COMMENTED`，inline comment 在 `demo.txt:3`。
- PR #2（作者 `github-actions[bot]`）：`approve` 成功，state `APPROVED`；`request-changes` 成功，state `CHANGES_REQUESTED`。
- `curl GET /repos/.../pulls/2/reviews` 返回 200，两个 state 都存在；重编译后的 id 为 `5971190430` / `5971192511`。
- 对作者自己的 PR 发 `approve` / `request-changes`：HTTP 422，错误文本为 `Can not approve your own pull request` / `Can not request changes on your own pull request`。
- 清理：PR 已关闭、分支已删除。验证 token 没有 `delete_repo` scope，临时仓库被归档而不是删除；需要时在 GitHub 设置里手动删除。

## 10. 遗留问题

- patch 之外的未改源码不可恢复；展开 gap 是空占位行。要显示真实上下文，需要同时提供仓库或 base/head 源码。
- 静态导出不生成多 PR 索引；多 PR 需要 `serve --pr-dir`。
- 服务模式默认不提供评论持久化；评论仍在浏览器。
- GitHub 模式当前是 CLI 提交，前端没有「提交到 GitHub」按钮。按钮需要额外做 CSRF 防护与写接口。
- 导入的 GitHub 评论不能在线程里回复；提交时会跳过，本地编辑不会写回。
- 同一浏览器里已有本地草稿时，localStorage 会覆盖新导入的 GitHub 评论；清掉该草稿后才能看到最新导入结果。
- 没有导入 PR 的 issue 评论、review 摘要、check 状态；只导入行级 review 评论。
- 没有自动重试/backoff、ETag、GitHub Enterprise 实机验证。
- 单补丁模式的 identity 固定为 `patch` / `patch`；不同补丁在同一浏览器里会共用 session 前缀，但 `comparison_id` 由 diff 摘要决定，不会串行号。
