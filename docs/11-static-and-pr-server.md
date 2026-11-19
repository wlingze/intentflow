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
3. GitHub 兼容不另做插件，复用服务端抓取 `pull/<number>.diff`。公开仓库不需要 token；需要私有仓库时设置 `GITHUB_TOKEN` 或 `GH_TOKEN`。

插件方案在当前阶段不划算：它多一套运行环境，却没有增加 diff 能力。工作台真正需要的数据已经由 patch 解析得到，浏览器里再抓一次 DOM 只会增加耦合。

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
        └── serve.ListenPR    /pr/<owner>/<repo>/<number> 多 PR 工作台
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

## 6. GitHub 兼容取舍

选了「服务端按 PR 抓 `.diff`」：

- 优点：与本地补丁同一个渲染路径；不需要用户装扩展；抓到的补丁落盘，第二次访问不再请求 GitHub；公开仓库零配置。
- 缺点：只读公开仓库时可用；GitHub 限流会返回错误；没有 PR 标题、作者、评论等元数据（可选 `4.json` 补标题）；不能像油猴脚本那样在 github.com 页面内直接注入。
- 未做：GitHub API 拉取 base/head SHA、PR 描述、review comment 同步。这些需要 token 与更完整的 API 客户端，超出最小闭环。

如果以后要做浏览器插件，建议只做「打开当前 PR 的工作台」这一跳转，不复制 diff 渲染逻辑。

## 7. 验证记录

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

浏览器检查：Playwright 打开页面后，`/api/payload.json` 与 `/api/revisions.json` 都返回 200，22 个改动文件渲染，无 console error。

## 8. 遗留问题

- patch 之外的未改源码不可恢复；展开 gap 是空占位行。要显示真实上下文，需要同时提供仓库或 base/head 源码。
- 静态导出不生成多 PR 索引；多 PR 需要 `serve --pr-dir`。
- 服务模式默认不提供评论持久化；评论仍在浏览器。
- GitHub 抓取只认公开仓库或带 token 的请求；没有 ETag/条件请求，缓存更新靠删除本地文件。
- 单补丁模式的 identity 固定为 `patch` / `patch`；不同补丁在同一浏览器里会共用 session 前缀，但 `comparison_id` 由 diff 摘要决定，不会串行号。
