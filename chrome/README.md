# intentflow userscript

在 GitHub PR 页面打开完整 intentflow 工作台。diff 由脚本在浏览器里解析，
评论直接提交为 GitHub review 评论。

## 安装

1. Chrome 安装 Tampermonkey。
2. 新建脚本，粘贴 `dist/intentflow.user.js` 的全部内容并保存。
3. 打开任意 `https://github.com/<owner>/<repo>/pull/<number>` 页面。
4. 点右下角 `intentflow`，工作台全屏打开。

首次提交 review 时脚本会提示输入 GitHub token。也可以从 Tampermonkey
菜单执行「设置 GitHub token」。

## Token

只存在 Tampermonkey 的 `GM_setValue` 存储里，不写页面 localStorage，
不打印，不放进 URL。

建议 fine-grained PAT：

- `Pull requests: Read and write`
- `Contents: Read`
- `Metadata: Read`

公开仓库只读可以不填 token。私有仓库读取 diff/评论需要 token；提交
review 必须有 token。

## 权限

脚本请求：

- `GM_xmlhttpRequest`：抓 `github.com/...pull/N.diff`、调用 `api.github.com`。
- `GM_getValue` / `GM_setValue`：保存 token。
- `GM_registerMenuCommand`：设置或清除 token。

GitHub 的 CSP 禁止页面内联 iframe 和跨域 `fetch`，所以脚本用
`GM_xmlhttpRequest` 取 diff，并把 React 工作台挂到 Shadow DOM，样式与
GitHub 隔离。

## 提交规则

- 行级评论映射为 GitHub `line` / `side` / `start_line` / `start_side`。
- `after` 映射 `RIGHT`，`before` 映射 `LEFT`。
- 提交前重新抓当前 diff；落不到 hunk 的评论写入 review body 的
  「未映射到当前 diff 的评论」，不会让整个 review 422。
- 导入的 `gh-` 评论只展示，不重复提交。
- 支持 `COMMENT`、`APPROVE`、`REQUEST_CHANGES`。
- 自己的 PR 不能 approve / request changes，GitHub 会返回 422。

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
- token 存在扩展存储；共用电脑时请用「清除 GitHub token」。
- 不导入 PR 会话评论、review 摘要、check 状态。
- 不支持回复现有评论线程。
- 没有自动重试/backoff；GitHub 限流时按 API 错误提示。
- 同一浏览器已有本地草稿时，工作台会优先显示本地草稿。
