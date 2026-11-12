# intentflow 官网

纯静态站点，无构建步骤、无包管理器、无第三方运行时请求。

部署地址：<https://wlingze.github.io/intentflow/>，由 `.github/workflows/pages.yml`
在 `master` 上 `website/**` 变更时发布。仓库是项目页，所以站点挂在
`/intentflow/` 子路径下。

## 本地预览

```bash
make site          # http://0.0.0.0:8131/
make site-check    # node scripts/check-site.mjs
```

`make site` 只调用 `python3 -m http.server`。不要用 `file://` 打开：
`localStorage` 与语言/主题切换在 `file://` 下行为不一致。

## 文件

```
index.html            首页
docs.html             用法文档
404.html              未找到页。必须自包含：样式与文案都内联，链接写绝对地址
.nojekyll             关闭 Jekyll，保留 `_` 前缀文件名
assets/tokens.css     颜色、字号、间距变量；深浅两套
assets/base.css       重置与元素默认样式
assets/style.css      页面布局
assets/app.js         中英文字典、语言切换、主题切换、复制按钮
assets/theme-init.js  首屏前应用主题，避免闪烁
assets/img/           截图，来自 docs/images/
```

## 编辑规则

1. **所有站内链接与资源用相对路径**（`./assets/...`）。绝对路径在子路径部署下会 404。
   唯一例外是 `404.html`：GitHub Pages 把它返回给任意深度的缺失路径，地址栏保留原
   URL，所以那里不能用相对路径，也不能引用共享样式或脚本。
2. **文案只写一份**。HTML 里写英文（无脚本时的兜底），中文进 `app.js` 的 `zh` 字典。
   每个可见文案都带 `data-i18n`；图片 `alt` 用 `data-i18n-alt`，`aria-label` 用
   `data-i18n-label`，`meta` 用 `data-i18n-content`。
3. **两种语言 key 集合必须一致**，HTML 里的英文必须与 `en` 字典一致。
   `node scripts/check-site.mjs` 会逐条比对。
4. **不引入外部资源**。字体用系统栈，图片放本地，只有 GitHub 链接可以外链。
5. **截图单张不超过 600KB**。新增截图先压到这个上限内，再放进 `assets/img/`。
6. 主题默认跟随 `prefers-color-scheme`，选择存 `intentflow.theme`；语言存
   `intentflow.lang`。两者都只在浏览器里，不上报任何数据。

## 内容边界

站点只描述仓库里已有的事实：README、`docs/00-thesis.md`、`docs/05-frontend.md`、
`docs/10-release.md` 与 `docs/images/` 截图。不写 benchmark、用户数、Star 数、
性能数字或路线图承诺。