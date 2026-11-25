# intentflow userscript

在 GitHub PR 页面打开完整 intentflow 工作台。diff 由脚本在浏览器里解析，
评论直接提交为 GitHub review 评论。

## 安装

1. Chrome 安装 Tampermonkey。
2. 新建脚本，粘贴 `dist/intentflow.user.js` 的全部内容并保存。
3. 打开任意 `https://github.com/<owner>/<repo>/pull/<number>` 页面。
4. 点右下角 `intentflow`，工作台全屏打开。

脚本不要求 token 或 PAT。读 diff 用浏览器已有的 GitHub 会话；写 review
走 GitHub 自己的网页表单，也使用当前登录会话。0.1 版本存过的 PAT 会在
启动时从扩展存储删除。

## 权限

脚本请求：

- `GM_xmlhttpRequest`：抓 `github.com/...pull/N.diff`、调用 `api.github.com`
  读取公开 PR 元数据与已有评论。请求携带浏览器会话，私有仓库也能读。
- `GM_setClipboard`：「在页面完成」时把评审 Markdown 放进剪贴板。
- `GM_deleteValue`：删除 0.1 版本存过的 PAT。
- `GM_registerMenuCommand`：打开工作台。

GitHub 的 CSP 禁止页面内联 iframe 和跨域 `fetch`，所以脚本用
`GM_xmlhttpRequest` 取 diff，并把 React 工作台挂到 Shadow DOM，样式与
GitHub 隔离。

## 主题

顶栏主题按钮打开三态菜单：跟随系统、浅色、深色，默认跟随系统。选择存
`intentflow.theme`，独立页与油猴脚本共用同一份 React 工作台和 CSS 变量。

## 提交规则

- 行级评论映射为 GitHub `line` / `side` / `start_line` / `start_side`。
- `after` 映射 `RIGHT`，`before` 映射 `LEFT`。
- 提交前重新抓当前 diff；落不到 hunk 的评论写入 review body 的
  「未映射到当前 diff 的评论」，不会让整次提交失败。
- 导入的 `gh-` 评论只展示，不重复提交。
- 支持 `COMMENT`、`APPROVE`、`REQUEST_CHANGES`。
- 自己的 PR 不能 approve / request changes，GitHub 会拒绝。

提交分两条路径：

1. 「提交到 GitHub」：先逐条 POST 到
   `/<owner>/<repo>/pull/<number>/review_comments`，再 POST
   `/<owner>/<repo>/pull/<number>/reviews`。两条都带页面里的
   `authenticity_token`，由 GitHub 校验登录会话与权限。
2. 「在页面完成」：复制评审 Markdown，打开 GitHub 的 Files changed；
   在原生 Review changes 表单里粘贴并提交。GitHub 改版或脚本被拦时用这条。

路径 1 使用 GitHub 网页表单，不是公开 REST API；字段随 GitHub 前端改版
可能变化。字段与请求顺序有单元测试和 Playwright 模拟；真实登录会话下的
提交未在本地自动验证，首次使用请确认评论落在当前 PR。出错时脚本显示
GitHub 的原文，并保留路径 2。

## 构建

```bash
cd chrome
pnpm install
pnpm build
pnpm test
```

产物：`chrome/dist/intentflow.user.js`。

`src/patch.js`、`src/payload.js`、`src/github.js` 是纯 JavaScript。
`src/main.js` 复用 `frontend/` 的 React 工作台；Vite 把它和 CSS 一起打进
单文件 userscript。

## 限制

- 需要 Tampermonkey（或支持 GM_* API 的同类扩展）。
- 不导入 PR 会话评论、review 摘要、check 状态。
- 不支持回复现有评论线程。
- 没有自动重试/backoff；GitHub 限流时按错误提示。
- 同一浏览器已有本地草稿时，工作台会优先显示本地草稿。
- GitHub Enterprise 未实机验证。
