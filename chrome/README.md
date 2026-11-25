# intentflow userscript

在 GitHub PR 页面打开完整 intentflow 工作台。diff 由脚本在浏览器里解析，
评论直接提交为 GitHub review 评论。

## 安装

1. Chrome 安装 Tampermonkey。
2. 新建脚本，粘贴 `dist/intentflow.user.js` 的全部内容并保存。
3. 打开任意 `https://github.com/<owner>/<repo>/pull/<number>` 页面。
4. 点右下角 `intentflow`，工作台全屏打开。

也可以直接访问 `.../pull/<number>#intentflow`。

脚本不要求 token 或 PAT。读 diff 用浏览器已有的 GitHub 会话；写 review
走 GitHub 自己的网页表单，也使用当前登录会话。旧版本存过的 PAT 会在
启动时从扩展存储删除。

## 与独立版同一个页面

脚本不再自己画工具栏或加载页。它只提供 PR 数据源，页面交给
`frontend/src/workbench.tsx` 的 `mountWorkbench`，与独立页共用同一份
React 树、CSS、主题、快捷键和评论状态。

因此：

- 文件树、diff、右侧评审、搜索、符号引用面板、主题菜单、提交菜单都一样。
- 主题三态也共用：跟随系统（默认）、浅色、深色，存在 `intentflow.theme`。
- 静态导出页没有 `GitHub` 发布行；只有脚本提供的数据源才有。

## 入口与退出

- 右下角 `intentflow` 按钮把地址改成 `#intentflow`，脚本据此挂载。
- 退出用浏览器后退，或油猴菜单「打开 / 关闭 intentflow」。
- `Esc` 留给工作台自己（搜索框、菜单、抽屉）。
- GitHub 站内跳转到别的页面时，工作台自己关闭。

## 权限

脚本请求：

- `GM_xmlhttpRequest`：抓 `github.com/...pull/N.diff`、调用 `api.github.com`
  读取公开 PR 元数据与已有评论。请求携带浏览器会话，私有仓库也能读。
- `GM_deleteValue`：删除旧版本存过的 PAT。
- `GM_registerMenuCommand`：打开 / 关闭工作台。

GitHub 的 CSP 禁止页面内跨域 `fetch`，所以脚本用 `GM_xmlhttpRequest`
取 diff，并把 React 工作台挂到 Shadow DOM 的全屏 `<dialog>` 里。

## 提交规则

「提交 Review」菜单 → `GitHub` 行：选评论 / 通过 / 请求修改，点「发布」。
发布前先存本地草稿，再重新抓当前 diff，所以网络失败不丢内容。

- 行级评论映射为 GitHub `line` / `side` / `start_line` / `start_side`。
- `after` 映射 `RIGHT`，`before` 映射 `LEFT`。
- 落不到当前 hunk 的评论写入 review body 的「未映射到当前 diff 的评论」，
  不会让整次提交失败。
- 导入的 `gh-` 评论只展示，不重复提交。
- 支持 `COMMENT`、`APPROVE`、`REQUEST_CHANGES`。
- 自己的 PR 不能 approve / request changes，GitHub 会拒绝。

请求顺序：

```text
POST /<owner>/<repo>/pull/<number>/review_comments   （每条行内评论一次）
POST /<owner>/<repo>/pull/<number>/reviews           （整次 review）
```

两条都带页面里的 `authenticity_token`，由 GitHub 校验登录会话与权限。

这是 GitHub 网页表单，不是公开 REST API；字段随 GitHub 前端改版可能变化。
字段与请求顺序有单元测试和 Playwright 模拟；真实登录会话下的提交未在本地
自动验证，首次使用请确认评论落在当前 PR。失败时工作台提示 GitHub 原文。

## 构建

```bash
cd chrome
pnpm install
pnpm build
pnpm test
```

产物：`chrome/dist/intentflow.user.js`。

`src/patch.js`、`src/payload.js`、`src/github.js`、`src/prSource.js` 是纯
JavaScript。`src/main.js` 只负责挂载点、地址、Shadow DOM 和数据源；Vite
把共享工作台和 CSS 一起打进单文件 userscript。

## 限制

- 需要 Tampermonkey（或支持 GM_* API 的同类扩展）。
- 不导入 PR 会话评论、review 摘要、check 状态。
- 不支持回复现有评论线程。
- 没有自动重试/backoff；GitHub 限流时按错误提示。
- 同一浏览器已有本地草稿时，工作台会优先显示本地草稿。
- GitHub Enterprise 未实机验证。
