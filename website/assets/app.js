/* UI behaviour: language switch, theme switch, copy buttons.
   Messages are a plain object so scripts/check-site.mjs can read the keys
   without a parser: one `'key': 'value',` per line, four spaces of indent. */

const messages = {
  en: {
    'page.title': 'intentflow — local diff workbench',
    'page.description': 'Read a local Git diff, write review comments, and copy the result to a coding agent as Markdown. One static binary, no server-side storage.',
    'nav.skip': 'Skip to content',
    'nav.features': 'Capabilities',
    'nav.handoff': 'Handoff',
    'nav.install': 'Install',
    'nav.status': 'Status',
    'nav.docs': 'Docs',
    'tools.lang': 'Switch language',
    'tools.themeLight': 'Switch to the light theme',
    'tools.themeDark': 'Switch to the dark theme',
    'theme.toLight': 'light',
    'theme.toDark': 'dark',
    'hero.eyebrow': 'Local diff workbench',
    'hero.title': 'Review code before you push it.',
    'hero.lead': 'Open a local repository and read the diff file by file. Write line comments, then copy the review to your coding agent as Markdown.',
    'hero.download': 'Download v0.1.0',
    'hero.docs': 'Read the docs',
    'hero.meta': 'Single static binary · Go 1.24 build · reviews stay in the browser',
    'hero.alt': 'The intentflow workbench: file tree on the left, diff cards in the middle, review panel on the right.',
    'hero.caption': 'Workbench: file tree, diff cards, review panel.',
    'features.eyebrow': 'Capabilities',
    'features.title': 'What the workbench does',
    'features.lead': 'Everything below runs on local files. No push, no pull request, no waiting for CI.',
    'features.tree.title': 'File tree',
    'features.tree.body': 'Fold by directory. File-type icons, comment counts, added and removed lines.',
    'features.range.title': 'Comparison range',
    'features.range.body': 'All changes, the uncommitted worktree, or a single commit.',
    'features.hunk.title': 'Hunk review',
    'features.hunk.body': 'Mark each hunk viewed. Editing the file drops its old marks.',
    'features.comment.title': 'Comments',
    'features.comment.body': 'Line comments, range selections, and one overall comment.',
    'features.search.title': 'Global search',
    'features.search.body': 'Search every diff file. Hits split into added, removed and context.',
    'features.symbol.title': 'Symbol references',
    'features.symbol.body': 'Click an identifier to list every reference in the repository, then jump to it.',
    'handoff.eyebrow': 'Handoff',
    'handoff.title': 'Give the review to an agent',
    'handoff.lead': 'Every comment carries the path, the side, the line number and the quoted code. Ctrl+Enter copies the whole review as Markdown.',
    'handoff.sample': '## Review\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\nUser input is concatenated into SQL. Use a parameterised query: WHERE name LIKE ?, and pass the wildcard as a parameter.\n\n### 2. Overall\nThis change replaces parameterised queries with string concatenation. I would revert it.',
    'handoff.note': 'Markdown and JSON are also saved to a file from the same menu.',
    'handoff.shortcut': 'Ctrl+Enter or Cmd+Enter in the diff area copies Markdown without opening the menu.',
    'handoff.quote': 'Quoted code travels with the comment, so the agent sees the exact line.',
    'copy.copy': 'Copy',
    'copy.done': 'Copied',
    'install.eyebrow': 'Install',
    'install.title': 'Download, unpack, run',
    'install.lead': 'Six platform archives for v0.1.0. Each one holds a single executable with the frontend embedded.',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.note': 'Runtime needs git only. No Node.js, pnpm or frontend build.',
    'install.releases': 'All releases and checksums',
    'install.table.caption': 'Platform archives',
    'install.table.platform': 'Platform',
    'install.table.file': 'Archive',
    'data.eyebrow': 'Data',
    'data.title': 'Nothing leaves the machine',
    'data.lead': 'Reviews are written by the browser, not by the server.',
    'data.reviews': 'Reviews live in browser localStorage, under the key intentflow.review.comparison_id.',
    'data.images': 'Comment images are inline data URLs, up to 1.5MB each, stored with the review.',
    'data.layout': 'Layout preferences use the intentflow. prefix in localStorage.',
    'data.server': 'The server writes no files. Closing it loses nothing.',
    'status.eyebrow': 'Status',
    'status.title': 'What works today',
    'status.lead': 'The three-layer semantic diff and the behaviour graph are the target structure, not shipped features.',
    'status.table.caption': 'Stages',
    'status.table.stage': 'Stage',
    'status.table.content': 'Content',
    'status.table.state': 'State',
    'status.stage1': 'Text diff and a local review store',
    'status.stage2': 'SSA fact layer: project, logic and intent diff',
    'status.stage3': 'Behaviour graph: trigger, decision, transform, effect',
    'status.stage4': 'LLM narrative layer that only reads facts',
    'status.available': 'Available',
    'status.todo': 'Not started',
    'status.note': 'The AI and SyntaxFlow tabs are placeholders and report that they are inactive.',
    'shots.eyebrow': 'Screens',
    'shots.title': 'Inside the workbench',
    'shots.review': 'Review panel',
    'shots.reviewAlt': 'The review panel with a file comment and an overall comment.',
    'shots.export': 'Markdown and JSON export',
    'shots.exportAlt': 'The submit menu with Markdown and JSON export rows.',
    'shots.narrow': 'Narrow window',
    'shots.narrowAlt': 'The workbench on a narrow window, with the side panels collapsed into drawers.',
    'footer.tagline': 'Local diff workbench. Reviews stay in the browser.',
    'footer.docs': 'Docs',
    'footer.github': 'GitHub',
    'footer.releases': 'Releases',
    'footer.license': 'Apache-2.0',
    'footer.note': 'Static site: no build step, no analytics, no third-party requests.',
    'docs.pageTitle': 'Docs — intentflow',
    'docs.pageDescription': 'Start the intentflow workbench, pick a comparison range, review a diff, export the result, and build from source.',
    'docs.head.title': 'Docs',
    'docs.head.lead': 'Start the workbench, pick a comparison range, review, export. Build and test commands at the end.',
    'docs.toc.start': 'Start',
    'docs.toc.range': 'Ranges',
    'docs.toc.review': 'Review',
    'docs.toc.export': 'Export',
    'docs.toc.data': 'Data',
    'docs.toc.build': 'Build',
    'docs.toc.design': 'Design docs',
    'docs.start.title': '1. Start',
    'docs.start.body': 'Run inside the repository you want to review. The terminal prints the address and opens the browser. With --no-open it only prints the address.',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.start.note': 'Without a built binary, run ./scripts/build.sh first, or make serve to start the bundled demo.',
    'docs.range.title': '2. Pick a range',
    'docs.range.body': 'Without --base, only main, master, origin/main and origin/master in the current HEAD history are accepted. If none of them is found, the command asks for --base instead of guessing HEAD~1.',
    'docs.range.table.caption': 'Common ranges',
    'docs.range.table.command': 'Command',
    'docs.range.table.meaning': 'Meaning',
    'docs.range.all': 'main to HEAD',
    'docs.range.worktree': 'main to the worktree, including untracked files',
    'docs.range.commits': 'A tag or commit range',
    'docs.range.folders': 'Two directories',
    'docs.params.caption': 'Flags',
    'docs.params.flag': 'Flag',
    'docs.params.meaning': 'Meaning',
    'params.target': 'Repository directory, default .',
    'params.base': 'Baseline; detected among main and master by default',
    'params.head': 'End point, default HEAD; WORKTREE includes uncommitted changes',
    'params.beforeAfter': 'Compare two directories',
    'params.host': 'Listen address, default 0.0.0.0; 127.0.0.1 keeps it local',
    'params.port': 'Port; 0 lets the system pick a free one',
    'params.out': 'Directory for review.json written by intentflow diff',
    'params.dist': 'Override the embedded frontend, debug only',
    'params.noOpen': 'Do not open the browser',
    'params.verbose': 'Print progress',
    'docs.review.title': '3. Review',
    'docs.review.body': 'Every mark and comment is written to the review document of the current comparison.',
    'docs.review.line': 'Add a line comment from the plus button, or select several lines to comment on a range.',
    'docs.review.hunk': 'Mark a hunk viewed from its header. When the file content changes, the old marks drop.',
    'docs.review.overall': 'Write one overall comment for the whole comparison.',
    'docs.review.search': 'Search every diff file with Ctrl+F, or Cmd+F on macOS.',
    'docs.review.alt': 'A diff card in split view with an inline comment about SQL string concatenation.',
    'docs.review.caption': 'A hunk with one inline comment and a suggested fix.',
    'docs.export.title': '4. Export',
    'docs.export.body': 'The submit menu has two rows. Each one can copy to the clipboard or save a file.',
    'docs.export.markdown': 'Markdown: comments with path, side, line numbers and the quoted code.',
    'docs.export.json': 'JSON: the full document, for tools that read it.',
    'docs.export.shortcut': 'Ctrl+Enter or Cmd+Enter copies Markdown without opening the menu. It stays quiet while the focus is in an input or a dialog.',
    'docs.data.title': '5. Where review data lives',
    'docs.data.body': 'The server keeps no review state. Everything below is written by the browser.',
    'docs.build.title': '6. Build from source',
    'docs.build.body': 'Build needs Go 1.24 or later, pnpm and git. schema/openapi.yaml is the only data contract; both type files are generated from it.',
    'docs.build.cmd': 'make tools          # oapi-codegen and frontend deps, once\nmake schema         # schema/openapi.yaml -> Go and TypeScript types\nmake check          # go vet, Go tests, tsc, Vitest\nmake build          # frontend build and static binary\nmake release-check  # cross-compile the six release targets',
    'docs.design.title': '7. Design notes',
    'docs.design.body': 'The thesis, the layer model, the contract rules and the review platform notes live in docs/.',
  },
  zh: {
    'page.title': 'intentflow — 本地 diff 工作台',
    'page.description': '读本地 Git diff、写评审评论、复制成 Markdown 交给编码代理。单个静态二进制，服务端不存评审数据。',
    'nav.skip': '跳到正文',
    'nav.features': '能力',
    'nav.handoff': '交接',
    'nav.install': '安装',
    'nav.status': '现状',
    'nav.docs': '文档',
    'tools.lang': '切换语言',
    'tools.themeLight': '切换到浅色主题',
    'tools.themeDark': '切换到深色主题',
    'theme.toLight': '浅色',
    'theme.toDark': '深色',
    'hero.eyebrow': '本地 diff 工作台',
    'hero.title': '推送之前，先评审完改动。',
    'hero.lead': '打开本地仓库，逐文件读改动，逐行写评论。评审意见复制成 Markdown，交给编码代理。',
    'hero.download': '下载 v0.1.0',
    'hero.docs': '查看文档',
    'hero.meta': '单个静态二进制 · Go 1.24 构建 · 评审只存在浏览器里',
    'hero.alt': 'intentflow 工作台：左侧文件树，中间 diff 卡片，右侧评审面板。',
    'hero.caption': '工作台：文件树、diff 卡片、评审面板。',
    'features.eyebrow': '能力',
    'features.title': '工作台能做什么',
    'features.lead': '以下都在本地文件上完成：不推送、不建 PR、不等 CI。',
    'features.tree.title': '文件树',
    'features.tree.body': '按目录折叠。带文件类型图标、评论数、增删行数。',
    'features.range.title': '比较范围',
    'features.range.body': '全部改动、未提交的工作区，或单个提交。',
    'features.hunk.title': '逐 hunk 查看',
    'features.hunk.body': '逐 hunk 标记已查看。文件改过之后旧标记自动失效。',
    'features.comment.title': '评论',
    'features.comment.body': '行级评论、跨行选区评论，以及一条总评。',
    'features.search.title': '全局搜索',
    'features.search.body': '跨全部 diff 文件搜索。命中分新增、删除与上下文三色。',
    'features.symbol.title': '符号引用',
    'features.symbol.body': '点代码里的标识符，列出全仓引用，点一条就跳过去。',
    'handoff.eyebrow': '交接',
    'handoff.title': '把评审交给编码代理',
    'handoff.lead': '每条评论带文件路径、左右侧、行号与引用代码。Ctrl+Enter 直接把整份评审复制成 Markdown。',
    'handoff.sample': '## 评审\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\n用户输入直接拼进了 SQL。改成参数化查询：WHERE name LIKE ?，通配符放进参数。\n\n### 2. 整体意见\n这次改动把参数化查询换成字符串拼接，建议整体退回。',
    'handoff.note': '同一个菜单里也能把 Markdown 或 JSON 保存为文件。',
    'handoff.shortcut': '在 diff 区域按 Ctrl+Enter 或 Cmd+Enter，直接复制 Markdown，不打开菜单。',
    'handoff.quote': '引用的代码跟着评论一起走，代理看到的就是原来那几行。',
    'copy.copy': '复制',
    'copy.done': '已复制',
    'install.eyebrow': '安装',
    'install.title': '下载、解压、运行',
    'install.lead': 'v0.1.0 提供六个平台压缩包。每个包只有一个可执行文件，前端已内嵌。',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.note': '运行只依赖 git。不需要 Node.js、pnpm 或前端构建。',
    'install.releases': '全部发布与校验和',
    'install.table.caption': '平台产物',
    'install.table.platform': '平台',
    'install.table.file': '文件',
    'data.eyebrow': '数据',
    'data.title': '数据不出本机',
    'data.lead': '评审数据由浏览器写入，服务端不参与。',
    'data.reviews': '评审存在浏览器 localStorage，键为 intentflow.review.comparison_id。',
    'data.images': '评论图片用内联 data URL，单张上限 1.5MB，随评审一起存。',
    'data.layout': '布局偏好也用 localStorage，前缀是 intentflow.。',
    'data.server': '服务端不写任何文件。关掉服务不会丢东西。',
    'status.eyebrow': '现状',
    'status.title': '当前可用范围',
    'status.lead': '三层语义 diff 与行为图是目标结构，不是当前能力。',
    'status.table.caption': '阶段',
    'status.table.stage': '阶段',
    'status.table.content': '内容',
    'status.table.state': '状态',
    'status.stage1': '文本 diff 与本地评审',
    'status.stage2': 'SSA 事实层：项目、逻辑、意图三层 diff',
    'status.stage3': '行为图：触发、判定、变换、效果',
    'status.stage4': 'LLM 叙述层：只读事实，写摘要',
    'status.available': '可用',
    'status.todo': '未开始',
    'status.note': '右侧 AI 与 SyntaxFlow 两个 tab 只是占位，当前显示未启用。',
    'shots.eyebrow': '界面',
    'shots.title': '工作台细节',
    'shots.review': '评审面板',
    'shots.reviewAlt': '评审面板：一条文件评论与一条总评。',
    'shots.export': 'Markdown 与 JSON 导出',
    'shots.exportAlt': '提交菜单：Markdown 与 JSON 两行导出。',
    'shots.narrow': '窄窗口',
    'shots.narrowAlt': '窄窗口下的工作台，左右栏收成抽屉。',
    'footer.tagline': '本地 diff 工作台。评审只存在浏览器里。',
    'footer.docs': '文档',
    'footer.github': 'GitHub',
    'footer.releases': '发布',
    'footer.license': 'Apache-2.0',
    'footer.note': '纯静态站点：无构建步骤、无统计、无第三方请求。',
    'docs.pageTitle': '文档 — intentflow',
    'docs.pageDescription': '启动 intentflow 工作台、选择比较范围、评审 diff、导出结果，以及从源码构建。',
    'docs.head.title': '文档',
    'docs.head.lead': '启动工作台、选比较范围、评审、导出。末尾是从源码构建与测试的命令。',
    'docs.toc.start': '启动',
    'docs.toc.range': '范围',
    'docs.toc.review': '评审',
    'docs.toc.export': '导出',
    'docs.toc.data': '数据',
    'docs.toc.build': '构建',
    'docs.toc.design': '设计文档',
    'docs.start.title': '1. 启动',
    'docs.start.body': '在要评审的仓库里运行。终端打印地址并自动打开浏览器；加 --no-open 只打印地址。',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.start.note': '没有现成二进制时，先跑 ./scripts/build.sh，或 make serve 启动自带 demo。',
    'docs.range.title': '2. 选比较范围',
    'docs.range.body': '不给 --base 时，只接受当前 HEAD 历史里的 main、master、origin/main、origin/master。都不在历史里就要求显式指定，不会退回 HEAD~1。',
    'docs.range.table.caption': '常用范围',
    'docs.range.table.command': '命令',
    'docs.range.table.meaning': '含义',
    'docs.range.all': 'main → HEAD',
    'docs.range.worktree': 'main → 工作区，含未跟踪文件',
    'docs.range.commits': '指定提交或 tag 范围',
    'docs.range.folders': '两个目录',
    'docs.params.caption': '命令行参数',
    'docs.params.flag': '参数',
    'docs.params.meaning': '含义',
    'params.target': '仓库目录，默认 .',
    'params.base': '基线；默认在 main 与 master 中检测',
    'params.head': '终点，默认 HEAD；WORKTREE 表示含未提交改动',
    'params.beforeAfter': '比较两个目录',
    'params.host': '监听地址，默认 0.0.0.0；仅本机可设 127.0.0.1',
    'params.port': '端口；0 表示由系统分配空闲端口',
    'params.out': 'intentflow diff 写 review.json 的目录',
    'params.dist': '覆盖内嵌前端，仅调试用',
    'params.noOpen': '不自动打开浏览器',
    'params.verbose': '打印进度',
    'docs.review.title': '3. 评审',
    'docs.review.body': '每个标记与每条评论都写进当前比较范围的评审文档。',
    'docs.review.line': '点行左侧的加号加行级评论，或拖动选中多行加跨行评论。',
    'docs.review.hunk': '在 hunk 头右侧标记已查看。文件内容变化后旧标记自动失效。',
    'docs.review.overall': '给整个比较范围写一条总评。',
    'docs.review.search': '按 Ctrl+F 或 macOS 上的 Cmd+F 跨全部 diff 文件搜索。',
    'docs.review.alt': '分栏视图的一张 diff 卡片，带一条关于 SQL 字符串拼接的行内评论。',
    'docs.review.caption': '一个 hunk，带一条行内评论与修复建议。',
    'docs.export.title': '4. 导出',
    'docs.export.body': '提交菜单有 Markdown 与 JSON 两行。每行都能复制到剪贴板或保存文件。',
    'docs.export.markdown': 'Markdown：评论带路径、左右侧、行号与引用代码。',
    'docs.export.json': 'JSON：完整结构，适合程序读取。',
    'docs.export.shortcut': '按 Ctrl+Enter 或 Cmd+Enter 直接复制 Markdown，不打开菜单。焦点在输入框或对话框里时不触发。',
    'docs.data.title': '5. 评审数据存在哪',
    'docs.data.body': '服务端不保存评审状态。以下全部由浏览器写入。',
    'docs.build.title': '6. 从源码构建',
    'docs.build.body': '构建依赖 Go 1.24 以上、pnpm 与 git。schema/openapi.yaml 是唯一数据契约，两侧类型都由它生成。',
    'docs.build.cmd': 'make tools          # 安装 oapi-codegen 与前端依赖，一次即可\nmake schema         # schema/openapi.yaml -> Go 与 TypeScript 类型\nmake check          # go vet、Go 测试、tsc、Vitest\nmake build          # 前端构建 + 静态二进制\nmake release-check  # 六个发布目标交叉编译验证',
    'docs.design.title': '7. 设计文档',
    'docs.design.body': '论题、三层模型、契约规则与评审平台说明都在 docs/ 里。',
  },
};

(function () {
  const LANG_KEY = 'intentflow.lang';
  const THEME_KEY = 'intentflow.theme';
  const root = document.documentElement;
  let currentLang = 'en';

  function read(key) {
    try {
      return localStorage.getItem(key);
    } catch (_) {
      return null;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, value);
    } catch (_) {
      /* Private mode and file:// can refuse storage; the page still works. */
    }
  }

  function detectLang() {
    const stored = read(LANG_KEY);
    if (stored === 'zh' || stored === 'en') return stored;
    const tags = navigator.languages && navigator.languages.length
      ? Array.prototype.slice.call(navigator.languages)
      : [navigator.language || ''];
    return tags.some((tag) => String(tag).toLowerCase().indexOf('zh') === 0) ? 'zh' : 'en';
  }

  function themeName() {
    return root.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  }

  function renderThemeButton() {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    const dark = themeName() === 'dark';
    const table = messages[currentLang];
    // The label names the action, not the current state: "light" means
    // clicking gives a light page. A word beats a glyph here, because sun
    // and moon characters render unevenly across fonts.
    button.textContent = dark ? table['theme.toLight'] : table['theme.toDark'];
    button.setAttribute('aria-label', dark ? table['tools.themeLight'] : table['tools.themeDark']);
  }

  function applyLang(lang) {
    currentLang = lang === 'zh' ? 'zh' : 'en';
    const table = messages[currentLang];
    root.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const value = table[node.getAttribute('data-i18n')];
      if (typeof value === 'string') node.textContent = value;
    });
    document.querySelectorAll('[data-i18n-alt]').forEach((node) => {
      const value = table[node.getAttribute('data-i18n-alt')];
      if (typeof value === 'string') node.setAttribute('alt', value);
    });
    document.querySelectorAll('[data-i18n-label]').forEach((node) => {
      const value = table[node.getAttribute('data-i18n-label')];
      if (typeof value === 'string') node.setAttribute('aria-label', value);
    });
    document.querySelectorAll('[data-i18n-content]').forEach((node) => {
      const value = table[node.getAttribute('data-i18n-content')];
      if (typeof value === 'string') node.setAttribute('content', value);
    });

    const langButton = document.querySelector('[data-lang-toggle]');
    if (langButton) langButton.textContent = currentLang === 'zh' ? 'English' : '中文';

    renderThemeButton();

    document.querySelectorAll('[data-copy]').forEach((button) => {
      if (button.hasAttribute('data-copied')) return;
      button.textContent = table['copy.copy'];
    });
  }

  function applyTheme(theme, remember) {
    root.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
    if (remember) write(THEME_KEY, theme);
    renderThemeButton();
  }

  const langButton = document.querySelector('[data-lang-toggle]');
  if (langButton) {
    langButton.addEventListener('click', () => {
      const next = currentLang === 'zh' ? 'en' : 'zh';
      write(LANG_KEY, next);
      applyLang(next);
    });
  }

  const themeButton = document.querySelector('[data-theme-toggle]');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      applyTheme(themeName() === 'dark' ? 'light' : 'dark', true);
    });
  }

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const stored = read(THEME_KEY);
    if (media.addEventListener) {
      media.addEventListener('change', (event) => {
        if (!read(THEME_KEY)) applyTheme(event.matches ? 'light' : 'dark', false);
      });
    }
    if (!stored) applyTheme(media.matches ? 'light' : 'dark', false);
  }

  function legacyCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    try {
      document.execCommand('copy');
    } catch (_) {
      /* Nothing else to try; the text stays selected for a manual copy. */
    }
    document.body.removeChild(area);
  }

  document.querySelectorAll('[data-copy]').forEach((button) => {
    button.addEventListener('click', () => {
      const target = document.getElementById(button.getAttribute('data-copy'));
      if (!target) return;
      const text = target.textContent;
      const done = () => {
        button.setAttribute('data-copied', 'true');
        button.textContent = messages[currentLang]['copy.done'];
        window.setTimeout(() => {
          button.removeAttribute('data-copied');
          button.textContent = messages[currentLang]['copy.copy'];
        }, 1800);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, () => {
          legacyCopy(text);
          done();
        });
        return;
      }
      legacyCopy(text);
      done();
    });
  });

  applyLang(detectLang());
})();