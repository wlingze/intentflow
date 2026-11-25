# 单 diff、静态导出与 PR 服务

本文说明一份补丁如何变成工作台数据，以及三种交付方式的边界。

## 1. 方案对比

| 方案 | 数据需求 | 部署成本 | 能做什么 | 限制 |
| --- | --- | --- | --- | --- |
| 纯静态导出 | 一份 patch；构建时生成 `payload.json` 与 `revisions.json` | 最低：任意静态文件服务器，或对象存储 + CDN | 看 diff、文件树、搜索、符号引用、写评审、导出 Markdown/JSON | 没有服务端；不能切换 commit 范围；patch 之外的未改源码不存在；评审只存浏览器 |
| 服务端托管 | 每个 PR 一份 patch；目录按 owner/repo/number 排列 | 中：一个 Go 二进制 + 反向代理 + 磁盘 | 路径路由、索引页、静态导出同样的交互、按需抓取公开 PR | 需要进程与磁盘；默认不写评审；GitHub 抓取受公开仓库与限流约束 |
| 浏览器插件 / 油猴脚本 | 运行在 github.com PR 页，读 DOM 或调用 GitHub API | 高：需要扩展商店、权限、跨域与内容脚本维护 | 直接在 PR 页注入工作台或打开侧栏，可复用页面上下文 | 浏览器与商店审核；GitHub DOM 与网页表单变更会破坏注入；写回依赖登录会话 |

结论：

1. 纯静态导出解决「只有一份 diff、想发给别人看」。
2. `serve --pr-dir` 解决「一台服务器上按路径浏览多个 PR」。
3. GitHub 读取采用 B（REST API）；A（Actions）作为发布层；C（浏览器注入）暂不做。
   本分支的 GitHub 模式只读；提交不在 CLI 中。

### 1.1 GitHub 接入路线

| 路线 | 数据需求 | 部署成本 | 能力 | 限制 | 取舍 |
| --- | --- | --- | --- | --- | --- |
| A. GitHub Actions | PR 事件、PR diff、Pages 或 artifact 权限 | 中：一个 workflow + Pages 设置 | PR 打开/更新时生成静态 review 页，自动回贴链接 | Fork PR 的 `GITHUB_TOKEN` 只读；Pages 需要仓库设置；无法写回行级评论 | 采用为发布层，不替代 API |
| B. GitHub REST 只读 | PR 元数据、聚合 diff、已有 review 评论 | 低：一个命令 + 环境变量 token | 拉 patch 与评论；在只读工作台里查看 | 需要 token；受权限与限流约束；不写回 | **读取闭环，采用** |
| C. 浏览器注入 | PR 页 DOM 或 GitHub API、扩展权限 | 高：扩展商店/油猴安装、权限、DOM 维护 | 在 PR 页内直接看 diff；写回使用页面登录会话 | GitHub DOM 与网页表单变更会破坏；安装门槛高；审核与跨域成本高 | **已实现（油猴脚本）** |

Actions 和 API 不是二选一：Actions 负责「让每个人打开一个链接」，API 负责「本地读到一个 PR 的完整上下文」。提交留给后续界面或浏览器扩展；本分支不暴露 CLI 写回。

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
        └── internal/ghreview  GitHub REST：读 PR/diff/评论；提交代码保留但无入口
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

## 6. GitHub 只读模式

```bash
export GITHUB_TOKEN=...        # 只从环境变量读，不落盘
intentflow github open --repo owner/repo --pr 4
```

读取：

- `GET /repos/{owner}/{repo}/pulls/{number}`：标题、base/head SHA、状态。
- 同一路径加 `Accept: application/vnd.github.v3.diff`：整个 PR 的聚合 diff，不是每个 commit 一段。
- `GET /repos/{owner}/{repo}/pulls/{number}/comments`：行级 review 评论，每页 100 条，最多 10 页。

导入的评论会出现在工作台里。ID 前缀 `gh-`，只展示，不写回。

本模式只读。GitHub review 提交不在 CLI 中；当前分支没有暴露写接口。

### 6.1 与 `serve --pr-dir` 的区别

| 维度 | `github open` | `serve --pr-dir` |
| --- | --- | --- |
| 数据来源 | GitHub REST API | 本地 patch；缺失时抓 `pull/<n>.diff` |
| 范围 | 单个 PR，一个工作台 | 多个 PR，索引页 + 路径路由 |
| PR 元数据 | 标题、base/head SHA、状态 | 文件名 + 可选 `<n>.json` 标题 |
| 已有评论 | 导入 | 不导入 |
| 认证 | 建议 token；公开仓库可匿名 | 公开仓库可匿名 |
| 缓存 | 不落盘 | 抓到的 `.diff` 缓存在 PR 目录 |
| 用途 | 本地读一个 PR 和评论 | 部署、分享链接、批量浏览 |

两者重叠的部分只有「把 patch 渲染成工作台」。`serve --pr-dir` 是托管模式；`github open` 是带认证和评论的本地读取模式。

### 6.2 权限与 token

| 场景 | 需要的权限 |
| --- | --- |
| 公开仓库，只读 patch/评论 | 匿名也可，但限流很紧；建议 token |
| 私有仓库，只读 | classic PAT 的 `repo`，或 fine-grained 的 `Pull requests: Read` + `Contents: Read` + `Metadata: Read` |
| GitHub Actions | `contents: read`；`GITHUB_TOKEN` 自动注入 |

- token 只从 `GITHUB_TOKEN` 或 `GH_TOKEN` 读，不写配置文件、不写 URL、不打印。
- GitHub Enterprise 用 `GITHUB_API_URL` 覆盖 API 根地址。
- 只读模式不需要 `pull-requests: write`。

### 6.3 失败与限流

| 状态 | 行为 |
| --- | --- |
| 401 | 提示 token 无效或过期；不重试 |
| 403 / 429 | 读到 `X-RateLimit-Reset` 或 `Retry-After` 时打印重置时间；不自动重试 |
| 404 | 提示仓库/PR 不存在或 token 无权访问 |
| 422 | 只读请求通常不出现；出现时打印 GitHub 的 `message` 与 `errors` |
| 5xx / 网络错误 | 直接失败并保留原因；用户自行重试 |

限制：单次响应上限 32 MiB；评论最多读 1000 条。没有实现自动 backoff、条件请求或分页重试。

## 7. 浏览器插件（油猴脚本，已实现）

已实现一个 Tampermonkey 用户脚本，代码在 `chrome/`。它把完整 React 工作台挂到 GitHub 页面的 Shadow DOM 里，diff 由脚本在浏览器本地解析。

### 7.1 方案分层

| 形态 | 做什么 | 成本 | 限制 |
| --- | --- | --- | --- |
| 油猴脚本 + Shadow DOM | PR 页加按钮，全屏挂载打包好的前端 | 中 | 需要 Tampermonkey；GitHub CSP、样式隔离、网页表单变更 |
| 扩展侧栏 / iframe | 在 GitHub 侧栏嵌入本地 intentflow 页面 | 中 | 需要本地端口发现、CSP、扩展权限 |
| 完整内容脚本改写 GitHub DOM | 把 diff 和评论 UI 拆进 GitHub 页面 | 最高 | GitHub DOM 变更、CSP、bundle 体积、商店审核 |

当前实现采用第一种：脚本不依赖本地进程，在 PR 页右下角加
`intentflow` 入口，全屏挂载工作台。diff 用 `GM_xmlhttpRequest` 抓取，
绕开 GitHub 的 `connect-src`；前端资源已经打进单文件 userscript。

### 7.2 页面与独立版一致

脚本不再自己画工具栏、加载页、错误页，也不再改 `window.fetch`、不再
单独读一份 localStorage 草稿。它只做三件事：

1. 解析 PR 地址，取 diff、元数据和已有评论。
2. 把结果包装成 `WorkbenchSource`，交给共享入口 `mountWorkbench`。
3. 在 `#intentflow` 打开一个全屏 `<dialog>`，工作台挂在 Shadow DOM 里。

独立页和脚本都走同一个 `mountWorkbench`（`frontend/src/workbench.tsx`），
页面树、加载状态、错误提示、快捷键、评论编辑、主题和样式只有一份。
差异只在数据源：独立页读 `api/*.json`，脚本读 PR。顶栏是否显示远端
发布入口也由数据源决定，静态导出仍然只读。

### 7.3 入口与退出

- 右下角 `intentflow` 按钮：把地址改成 `#intentflow`，脚本据此挂载。
- 直接打开 `.../pull/N#intentflow`：同样可用。
- 退出用浏览器后退，或油猴菜单「打开 / 关闭 intentflow」。
- `Esc` 留给工作台自己（搜索框、菜单、抽屉）。

### 7.4 提交怎么接

写回在原来的「提交 Review」菜单里，多一行 `GitHub`：下拉选
评论 / 通过 / 请求修改，点「发布」。脚本取当前评审状态，重新抓当前
diff，映射成 GitHub review 评论后走 GitHub 自己的网页表单：

```text
POST /<owner>/<repo>/pull/<number>/review_comments
POST /<owner>/<repo>/pull/<number>/reviews
```

两条请求都带页面里的 `authenticity_token`，用 `fetch` 的
`credentials: same-origin` 发送，所以使用浏览器已登录的 GitHub 会话，
不要求 token 或 PAT。行内评论先进待提交 review，最后一条请求提交整次
review（`COMMENT` / `APPROVE` / `REQUEST_CHANGES`）。

这不是公开 REST API，是 GitHub 前端使用的网页表单；字段随 GitHub 改版
可能变化。字段与请求顺序已有单元测试和 Playwright 模拟；真实登录会话下
的提交未在本地自动验证，首次使用请确认评论落在当前 PR。失败时工作台
用提示条显示 GitHub 返回的原文，评审内容已先存本地草稿，不会丢。


### 7.5 行号映射（已实现）

| intentflow | GitHub review comment |
| --- | --- |
| `quote.file` | `path` |
| `quote.side = after` | `side = RIGHT` |
| `quote.side = before` | `side = LEFT` |
| `start = end` | 只发 `line` |
| `start < end` | 发 `start_line` + `line` + `start_side` |

`position` 是旧的 diff 行偏移，跨 hunk 与多行评论都容易算错；不使用。
outdated 行处理：提交时重新抓当前 PR diff；落不到 hunk 的评论写入 review body，不发 inline。
同一套规则在 `chrome/src/github.js` 中实现，并有纯 JS 测试。

## 8. GitHub Actions 用法

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

## 9. 不推荐的做法

- 把 token 写进 URL、命令行参数、`.env`、仓库变量或日志。URL 和进程列表会泄漏。
- 用 `admin:repo_hook`、`delete_repo` 等宽 scope 只为了读 PR。
- 用 `position` 猜行号；跨 hunk、多行评论和 outdated 行都会错。
- 把 GitHub HTML 当 API 抓取；页面结构变化就失效。
- 在浏览器扩展里长期保存 PAT，除非有明确的加密与权限模型；优先使用页面登录会话，或让本地进程持有 token。
- 伪造、导出或转发 GitHub 的会话 cookie / CSRF token；脚本只在当前页面内提交。
- 为了测试在别人的真实 PR 上提交 review；用临时仓库或自己的测试 PR。
- 在 `pull_request_target` 里 checkout 并运行 PR 作者的代码，同时给它写 token。

## 10. 验证记录

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

GitHub 只读：

- 临时公开仓库的 PR：`intentflow github open` 读到 1 个文件、已有 1 条 review 评论。
- 工作台 `/api/payload.json` 返回 200；导入的评论出现在 `session.comments`。
- GitHub review 提交曾在移除 CLI 前完成验证；当前分支不再暴露该命令。

浏览器检查：Playwright 打开静态页和 `/pr/...` 页，`api/*.json` 均返回 200，无 console error。

油猴脚本：

- 在 `wlingze/intentflow#4` 页面注入 `chrome/dist/intentflow.user.js`，22 个文件全部渲染。
- 工作台挂在 Shadow DOM 的全屏 `<dialog>` 里，GitHub 页面样式不互相污染。
- 浅色、深色下顶栏、卡片、左侧栏尺寸、字体、CSS 变量与独立导出页逐项相同。
- 深色 / 浅色 / 跟随系统三态主题；两种主题下 YAML 字符串、注释、数字都可读。
- 点击 diff 里的标识符，右下角「符号引用」浮层出现并列出引用。
- 脚本没有自己的工具栏；「提交 Review」菜单里出现 `GitHub` 行。
- `node --test chrome/src/*.test.js` 覆盖 diff 解析、行号映射、评论导入、网页表单字段。
- 模拟提交：2 个 POST，字段、`authenticity_token` 与事件正确，提示「已提交评论」；浏览器后退可退出。
- 网页表单提交需要真实登录会话，本地无法代替；未登录时工作台提示 GitHub 的原文。

## 11. 遗留问题

- patch 之外的未改源码不可恢复；展开 gap 是空占位行。要显示真实上下文，需要同时提供仓库或 base/head 源码。
- 静态导出不生成多 PR 索引；多 PR 需要 `serve --pr-dir`。
- 服务模式默认不提供评论持久化；评论仍在浏览器。
- GitHub 只读模式不导入 PR 会话评论、review 摘要、check 状态。
- 导入的 GitHub 评论不能在线程里回复；本地编辑不会写回。
- 同一浏览器里已有本地草稿时，localStorage 会覆盖新导入的 GitHub 评论；清掉该草稿后才能看到最新导入结果。
- 油猴脚本已实现，产物是 `chrome/dist/intentflow.user.js`。它需要 Tampermonkey；写 review 使用浏览器登录会话，不要求 PAT。
- 脚本与独立页共用 `mountWorkbench`；脚本只提供 PR 数据源，不再有独立页面层。
- 网页表单提交路径未在真实登录会话下自动验证；首次使用请确认评论落在当前 PR。
- 脚本不导入 PR 会话评论、review 摘要、check 状态；不支持回复现有评论线程。
- 没有自动重试/backoff、ETag、GitHub Enterprise 实机验证。
- 单补丁模式的 identity 固定为 `patch` / `patch`；不同补丁在同一浏览器里会共用 session 前缀，但 `comparison_id` 由 diff 摘要决定，不会串行号。
