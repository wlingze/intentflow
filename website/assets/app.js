/* UI behaviour: language switch, theme switch, copy buttons, docs sidebar.
   Messages are a plain object so scripts/check-site.mjs can read the keys
   without a parser: one `'key': 'value',` per line, four spaces of indent. */

const messages = {
  en: {
    'page.title': 'intentflow — local diff workbench',
    'page.description': 'Read a local Git diff, comment on the lines, copy the review to your coding agent in one keystroke.',
    'nav.skip': 'Skip to content',
    'nav.copy': 'Copy',
    'nav.git': 'Git ranges',
    'nav.local': 'Local first',
    'nav.symbols': 'Symbols',
    'nav.install': 'Install',
    'nav.docs': 'Docs',
    'tools.lang': 'Switch language',
    'tools.themeLight': 'Switch to the light theme',
    'tools.themeDark': 'Switch to the dark theme',
    'theme.toLight': 'light',
    'theme.toDark': 'dark',
    'btn.copy': 'Copy',
    'copy.done': 'Copied',
    'hero.title': 'Read the diff. Write the note. Hand it to the agent.',
    'hero.lead': 'Local diff review for coding agents.',
    'hero.fact1': 'single static binary',
    'hero.fact2': 'runtime needs only git',
    'hero.fact3': 'reviews stay in the browser',
    'hero.download': 'Download v0.1.0',
    'hero.docs': 'Read the docs',
    'copy.title': 'Copy',
    'copy.claim': 'One keystroke, whole review.',
    'copy.fig': 'Submit menu',
    'copy.figAlt': 'The submit menu with a Markdown row and a JSON row, each with copy and save buttons.',
    'git.title': 'Git ranges',
    'git.claim': 'From history, not a picker.',
    'git.fig': 'Files and counts',
    'git.figAlt': 'The file tree with added and removed counts, status badges and comment counts.',
    'local.title': 'Local first',
    'local.claim': 'No service, no account.',
    'local.tag1': 'one binary',
    'local.fig': 'Review panel',
    'local.figAlt': 'The review panel with two comments on a diff, each carrying the code it quotes.',
    'symbols.title': 'Symbols',
    'symbols.claim': 'No index, no LSP.',
    'symbols.tag1': 'whole word',
    'symbols.tag2': 'changed files',
    'symbols.fig': 'Reference list',
    'symbols.figAlt': 'The symbol panel listing every reference of $hit, grouped by file with line numbers.',
    'install.title': 'Install',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.releases': 'All releases and checksums',
    'status.title': 'What ships today',
    'status.table.caption': 'Stages',
    'status.table.stage': 'Stage',
    'status.table.content': 'Content',
    'status.table.state': 'State',
    'status.stage1': 'Text diff and a local review store',
    'status.stage2': 'SSA fact layer',
    'status.stage3': 'Behaviour graph',
    'status.stage4': 'LLM narrative layer',
    'status.available': 'Available',
    'status.todo': 'Not started',
    'status.note': 'The AI and SyntaxFlow tabs report that they are inactive.',
    'footer.tagline': 'Local diff workbench. Reviews stay in the browser.',
    'footer.docs': 'Docs',
    'footer.github': 'GitHub',
    'footer.releases': 'Releases',
    'footer.license': 'Apache-2.0',
    'footer.note': 'No analytics, no third-party requests.',
    'docs.pageTitle': 'Docs — intentflow',
    'docs.pageDescription': 'Install, pick a range, review a diff, export the result. One page.',
    'docs.head.kicker': 'Reference',
    'docs.head.title': 'Intentflow docs',
    'docs.head.lead': 'Install, pick a range, review, export.',
    'docs.toc': 'Contents',
    'docs.group.start': 'Getting started',
    'docs.group.review': 'Reviewing',
    'docs.group.reference': 'Reference',
    'docs.nav.start': 'Start',
    'docs.nav.range': 'Pick a range',
    'docs.nav.rangeCommands': 'Common ranges',
    'docs.nav.rangeFlags': 'Flags',
    'docs.nav.review': 'Review',
    'docs.nav.reviewMarks': 'Viewed marks',
    'docs.nav.symbols': 'Symbols',
    'docs.nav.symbolsUsage': 'How to use it',
    'docs.nav.export': 'Export',
    'docs.nav.data': 'Where reviews live',
    'docs.nav.build': 'Build',
    'docs.nav.design': 'Design documents',
    'docs.start.title': '1. Start',
    'docs.start.body': 'Run it in the repo you want to review. It opens the browser.',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.range.title': '2. Pick a range',
    'docs.range.commandsTitle': 'Common ranges',
    'docs.range.flagsTitle': 'Flags',
    'docs.range.table.caption': 'Common ranges',
    'docs.range.table.command': 'Command',
    'docs.range.table.meaning': 'Meaning',
    'docs.range.all': 'main to HEAD',
    'docs.range.worktree': 'main to the worktree, with untracked files',
    'docs.range.commits': 'tag or commit range',
    'docs.range.folders': 'two directories, no Git',
    'docs.range.note': 'With no `--base` it takes the nearest ancestor and never falls back to `HEAD~1`.',
    'docs.params.caption': 'Flags',
    'docs.params.flag': 'Flag',
    'docs.params.meaning': 'Meaning',
    'params.target': 'repo directory, default `.`',
    'params.base': 'baseline; nearest of main, master, origin/main, origin/master',
    'params.head': 'end point, default `HEAD`; `WORKTREE` adds uncommitted files',
    'params.beforeAfter': 'two directories instead of a Git range',
    'params.host': 'listen address, default `0.0.0.0`',
    'params.port': 'port; `0` picks a free one',
    'params.out': 'where `intentflow diff` writes `review.json`',
    'params.dist': 'override the embedded frontend, debug only',
    'params.noOpen': 'do not open the browser',
    'params.verbose': 'print progress',
    'docs.review.title': '3. Review',
    'docs.review.body': 'Comments and marks belong to this comparison, in the browser.',
    'docs.review.line': 'Comment a line, or drag a range.',
    'docs.review.search': '`Ctrl`+`F` searches every file, with case and whole-word switches.',
    'docs.review.rename': 'A rename is one card: old path, arrow, new name.',
    'docs.review.marksTitle': 'Viewed marks',
    'docs.review.marksBody': 'Keyed by file, row and content digest, so an edited hunk loses its mark.',
    'docs.review.marksFile': 'Marking a file marks its hunks.',
    'docs.review.marksTree': 'A viewed file greys out and collapses.',
    'docs.symbols.title': '4. Symbols',
    'docs.symbols.body': 'Click an identifier to list every place it appears.',
    'docs.symbols.scopeTitle': 'Scope:',
    'docs.symbols.scopeBody': 'changed files of this comparison, both sides. No index, no language server.',
    'docs.symbols.usageTitle': 'How to use it',
    'docs.symbols.step1': 'Click a word to open the panel.',
    'docs.symbols.step3': 'Click a row to jump to that line.',
    'docs.symbols.step4': 'Whole word by default: `hit` does not match `hits`.',
    'docs.symbols.scale': '`$hit` returned 1457 rows in one comparison.',
    'docs.export.title': '5. Export',
    'docs.export.body': 'Two rows: copy to the clipboard or save a file.',
    'docs.export.markdown': 'Markdown: path, side, line, quoted code.',
    'docs.export.json': 'JSON: the full document.',
    'docs.export.shortcut': '`Ctrl`+`Enter` copies Markdown without the menu.',
    'docs.export.sample': '## Review\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\nConcatenated SQL. Use a parameterised query.\n\n### 2. Overall\nRevert the string concatenation.',
    'docs.data.title': '6. Where reviews live',
    'data.reviews': 'Reviews: `localStorage`, key `intentflow.review.<comparison_id>`.',
    'data.images': 'Images: inline data URLs, up to 1.5MB each.',
    'data.layout': 'Layout preferences: the same store, `intentflow.` prefix.',
    'data.server': 'The server writes no files.',
    'docs.build.title': '7. Build',
    'docs.build.body': 'Go 1.24+, pnpm and git. `schema/openapi.yaml` generates both sides.',
    'docs.build.cmd': 'make tools          # oapi-codegen and frontend deps, once\nmake schema         # schema/openapi.yaml -> Go and TypeScript types\nmake check          # go vet, Go tests, tsc, Vitest\nmake build          # frontend build and static binary\nmake release-check  # cross-compile the six release targets',
    'docs.build.site': 'No binary yet? Run `./scripts/build.sh`. Site: `make site`, port 8131.',
    'docs.design.title': '8. Design documents',
    'docs.design.thesis': 'code cannot express intent',
    'docs.design.layers': 'the three layers',
    'docs.design.frontend': 'workbench layout',
    'docs.design.behavior': 'behaviour view',
    'docs.design.contract': 'one schema, both languages',
    'docs.design.release': 'artifacts and checksums',
    'docs.foot.question': 'Something missing?',
    'docs.foot.issues': 'Open an issue',
    'docs.foot.home': 'Back to the index',
  },
  zh: {
    'page.title': 'intentflow — 本地 diff 工作台',
    'page.description': '读本地 Git diff，在改动上写评论，一次复制交给编码代理。',
    'nav.skip': '跳到正文',
    'nav.copy': '一键复制',
    'nav.git': 'Git 识别',
    'nav.local': '本地优先',
    'nav.symbols': '符号引用',
    'nav.install': '安装',
    'nav.docs': '文档',
    'tools.lang': '切换语言',
    'tools.themeLight': '切换到浅色主题',
    'tools.themeDark': '切换到深色主题',
    'theme.toLight': '浅色',
    'theme.toDark': '深色',
    'btn.copy': '复制',
    'copy.done': '已复制',
    'hero.title': '读完改动，写下意见，交给代理。',
    'hero.lead': '给编码代理用的本地 diff 评审。',
    'hero.fact1': '单个静态二进制',
    'hero.fact2': '运行只依赖 git',
    'hero.fact3': '评审只存在浏览器里',
    'hero.download': '下载 v0.1.0',
    'hero.docs': '查看文档',
    'copy.title': '复制',
    'copy.claim': '一次按键，整份评审。',
    'copy.fig': '提交菜单',
    'copy.figAlt': '提交菜单：Markdown 与 JSON 两行，各自带复制与保存按钮。',
    'git.title': 'Git 范围',
    'git.claim': '来自历史，不是选择器。',
    'git.fig': '文件与计数',
    'git.figAlt': '文件树显示了增删行数、状态标记与评论数。',
    'local.title': '本地优先',
    'local.claim': '不起服务，不登录。',
    'local.tag1': '单个二进制',
    'local.fig': '评审面板',
    'local.figAlt': '评审面板里的两条评论，各自带着引用的代码。',
    'symbols.title': '符号',
    'symbols.claim': '不建索引，不用 LSP。',
    'symbols.tag1': '整词',
    'symbols.tag2': '改动文件',
    'symbols.fig': '引用列表',
    'symbols.figAlt': '符号面板列出 $hit 的每一处引用，按文件分组并带行号。',
    'install.title': '安装',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.releases': '全部发布与校验和',
    'status.title': '当前发布范围',
    'status.table.caption': '阶段',
    'status.table.stage': '阶段',
    'status.table.content': '内容',
    'status.table.state': '状态',
    'status.stage1': '文本 diff 与本地评审',
    'status.stage2': 'SSA 事实层',
    'status.stage3': '行为图',
    'status.stage4': 'LLM 叙述层',
    'status.available': '可用',
    'status.todo': '未开始',
    'status.note': 'AI 与 SyntaxFlow 页签会说明尚未启用。',
    'footer.tagline': '本地 diff 工作台。评审只存在浏览器里。',
    'footer.docs': '文档',
    'footer.github': 'GitHub',
    'footer.releases': '发布',
    'footer.license': 'Apache-2.0',
    'footer.note': '没有统计，没有第三方请求。',
    'docs.pageTitle': '文档 — intentflow',
    'docs.pageDescription': '安装、选范围、评审改动、导出结果。一页写完。',
    'docs.head.kicker': '参考',
    'docs.head.title': 'intentflow 文档',
    'docs.head.lead': '安装、选范围、评审、导出。',
    'docs.toc': '目录',
    'docs.group.start': '开始使用',
    'docs.group.review': '评审',
    'docs.group.reference': '参考',
    'docs.nav.start': '启动',
    'docs.nav.range': '选择范围',
    'docs.nav.rangeCommands': '常用范围',
    'docs.nav.rangeFlags': '命令行参数',
    'docs.nav.review': '评审',
    'docs.nav.reviewMarks': '已查看标记',
    'docs.nav.symbols': '符号',
    'docs.nav.symbolsUsage': '用法',
    'docs.nav.export': '导出',
    'docs.nav.data': '评审存在哪里',
    'docs.nav.build': '构建',
    'docs.nav.design': '设计文档',
    'docs.start.title': '1. 启动',
    'docs.start.body': '在要评审的仓库里运行，它会打开浏览器。',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.range.title': '2. 选择范围',
    'docs.range.commandsTitle': '常用范围',
    'docs.range.flagsTitle': '命令行参数',
    'docs.range.table.caption': '常用范围',
    'docs.range.table.command': '命令',
    'docs.range.table.meaning': '含义',
    'docs.range.all': 'main 到 HEAD',
    'docs.range.worktree': 'main 到工作区，含未跟踪文件',
    'docs.range.commits': '标签或提交范围',
    'docs.range.folders': '两个目录，不需要 Git',
    'docs.range.note': '不传 `--base` 时就近取祖先，绝不退回 `HEAD~1`。',
    'docs.params.caption': '命令行参数',
    'docs.params.flag': '参数',
    'docs.params.meaning': '含义',
    'params.target': '仓库目录，默认 `.`',
    'params.base': '基线；默认取 main、master、origin/main、origin/master 中最近的一个',
    'params.head': '终点，默认 `HEAD`；`WORKTREE` 含未提交文件',
    'params.beforeAfter': '比较两个目录，而不是 Git 范围',
    'params.host': '监听地址，默认 `0.0.0.0`',
    'params.port': '端口；`0` 由系统分配',
    'params.out': '`intentflow diff` 写 `review.json` 的目录',
    'params.dist': '覆盖内嵌前端，仅调试用',
    'params.noOpen': '不自动打开浏览器',
    'params.verbose': '打印进度',
    'docs.review.title': '3. 评审',
    'docs.review.body': '评论与标记都属于本次比较，存在浏览器里。',
    'docs.review.line': '点加号评论一行，或选中多行评论一段。',
    'docs.review.search': '`Ctrl`+`F` 搜索所有文件，可切大小写与整词。',
    'docs.review.rename': '重命名是一张卡片：旧路径、箭头、新名字。',
    'docs.review.marksTitle': '已查看标记',
    'docs.review.marksBody': '按文件、行号和内容摘要计算，改动过的块会失去标记。',
    'docs.review.marksFile': '标记一个文件会标记它所有块。',
    'docs.review.marksTree': '全部查看的文件变灰并折叠。',
    'docs.symbols.title': '4. 符号',
    'docs.symbols.body': '点一个标识符，列出它出现的每一处。',
    'docs.symbols.scopeTitle': '范围：',
    'docs.symbols.scopeBody': '本次比较的改动文件，前后两侧。不建索引，不起语言服务器。',
    'docs.symbols.usageTitle': '用法',
    'docs.symbols.step1': '点代码里的词，面板就打开。',
    'docs.symbols.step3': '点一行，diff 跳到该处。',
    'docs.symbols.step4': '默认整词：`hit` 不会命中 `hits`。',
    'docs.symbols.scale': '一次比较里 `$hit` 返回 1457 行。',
    'docs.export.title': '5. 导出',
    'docs.export.body': '两行：复制到剪贴板，或存成文件。',
    'docs.export.markdown': 'Markdown：路径、左右侧、行号、引用原文。',
    'docs.export.json': 'JSON：完整文档。',
    'docs.export.shortcut': '`Ctrl`+`Enter` 不开菜单直接复制 Markdown。',
    'docs.export.sample': '## 评审\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\n用户输入直接拼进了 SQL。改成参数化查询。\n\n### 2. 整体意见\n建议退回这处字符串拼接。',
    'docs.data.title': '6. 评审存在哪里',
    'data.reviews': '评审：`localStorage`，键 `intentflow.review.<comparison_id>`。',
    'data.images': '图片：内联 data URL，单张上限 1.5MB。',
    'data.layout': '布局偏好：同一个存储，前缀 `intentflow.`。',
    'data.server': '服务端不写文件。',
    'docs.build.title': '7. 构建',
    'docs.build.body': '需要 Go 1.24+、pnpm 与 git。`schema/openapi.yaml` 生成两侧类型。',
    'docs.build.cmd': 'make tools          # 安装 oapi-codegen 与前端依赖，一次即可\nmake schema         # schema/openapi.yaml -> Go 与 TypeScript 类型\nmake check          # go vet、Go 测试、tsc、Vitest\nmake build          # 前端构建 + 静态二进制\nmake release-check  # 六个发布目标交叉编译验证',
    'docs.build.site': '没有二进制？跑 `./scripts/build.sh`。站点用 `make site`，端口 8131。',
    'docs.design.title': '8. 设计文档',
    'docs.design.thesis': '代码不能表达意图',
    'docs.design.layers': '三层模型',
    'docs.design.frontend': '工作台布局',
    'docs.design.behavior': '行为视图',
    'docs.design.contract': '一份 schema，两侧生成',
    'docs.design.release': '产物与校验和',
    'docs.foot.question': '缺了什么？',
    'docs.foot.issues': '提 issue',
    'docs.foot.home': '回到首页',
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

  // renderInline keeps the mono styling for commands and keys after a language
  // switch. Dictionaries write `like this`; the text is escaped first, so the
  // only markup that reaches the page is the <code> element added here.
  function escapeHtml(text) {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderInline(text) {
    if (text.indexOf('`') < 0) return escapeHtml(text);
    const keys = { Ctrl: 1, Cmd: 1, Enter: 1, Escape: 1, Tab: 1, F: 1 };
    return escapeHtml(text).replace(/`([^`]+)`/g, (all, token) =>
      keys[token] ? `<kbd>${token}</kbd>` : `<code>${token}</code>`);
  }

  function applyLang(lang) {
    currentLang = lang === 'zh' ? 'zh' : 'en';
    const table = messages[currentLang];
    root.lang = currentLang === 'zh' ? 'zh-CN' : 'en';

    document.querySelectorAll('[data-i18n]').forEach((node) => {
      const value = table[node.getAttribute('data-i18n')];
      if (typeof value !== 'string') return;
      if (value.indexOf('`') >= 0) node.innerHTML = renderInline(value);
      else node.textContent = value;
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
      button.textContent = table['btn.copy'];
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
          button.textContent = messages[currentLang]['btn.copy'];
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

  // ── Docs sidebar ──────────────────────────────────────────────────
  // On wide screens the sidebar is always visible and the current section
  // is marked from an IntersectionObserver. On narrow screens the same
  // markup becomes an overlay panel driven by the toggle button.
  const docNav = document.querySelector('[data-docnav-panel]');
  if (docNav) {
    const aside = docNav.closest('.docs-aside');
    const toggle = document.querySelector('[data-docnav-toggle]');
    const overlay = document.querySelector('[data-docnav-overlay]');
    const links = Array.prototype.slice.call(docNav.querySelectorAll('a[href^="#"]'));
    const targets = links
      .map((link) => document.getElementById(decodeURIComponent(link.getAttribute('href').slice(1))))
      .filter(Boolean);

    // Only the deepest visible heading wins, so a parent section and its
    // subsection are never highlighted together.
    const setCurrent = (id) => {
      links.forEach((link) => {
        const match = link.getAttribute('href') === '#' + id;
        if (match) link.setAttribute('aria-current', 'location');
        else link.removeAttribute('aria-current');
      });
    };

    // Pick the last heading that has passed the reading line. That is the
    // section the reader is inside. A ratio comparison would highlight
    // whichever block happens to be taller, and the final section would never
    // win, so measure positions in document order instead.
    const readingLine = () => {
      const header = document.querySelector('.site-header');
      const chrome = header ? header.getBoundingClientRect().height : 0;
      // A fifth of the viewport is past the heading a reader just scrolled to.
      return Math.max(chrome + 12, window.innerHeight * 0.2);
    };

    // A click chooses the section for as long as the smooth scroll runs,
    // so a short trailing section cannot lose to the bottom-of-page rule.
    let pinUntil = 0;

    const sync = () => {
      if (Date.now() < pinUntil) return;
      const line = readingLine();
      let chosen = targets[0] ? targets[0].id : null;
      for (const target of targets) {
        if (target.getBoundingClientRect().top <= line) chosen = target.id;
      }
      // At the very bottom the last heading can still sit below the line.
      if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2 && targets.length) {
        chosen = targets[targets.length - 1].id;
      }
      if (chosen) setCurrent(chosen);
    };

    if ('IntersectionObserver' in window && targets.length) {
      const observer = new IntersectionObserver(sync, {
        rootMargin: '-72px 0px -40% 0px',
        threshold: [0, 0.25, 0.5, 1],
      });
      targets.forEach((target) => observer.observe(target));
      sync();

      window.addEventListener('hashchange', () => {
        const id = decodeURIComponent(window.location.hash.slice(1));
        if (id) setCurrent(id);
      });
      if (window.location.hash) setCurrent(decodeURIComponent(window.location.hash.slice(1)));
    }

    const isNarrow = () => window.matchMedia('(max-width: 899px)').matches;

    // restoreFocus:false when a link is chosen, because the target heading
    // takes focus next and the toggle would steal the scroll position.
    const closeNav = (restoreFocus = true) => {
      if (!aside) return;
      aside.removeAttribute('data-open');
      if (overlay) overlay.hidden = true;
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'false');
        if (restoreFocus) toggle.focus();
      }
    };

    const openNav = () => {
      if (!aside) return;
      aside.setAttribute('data-open', 'true');
      if (overlay) overlay.hidden = false;
      if (toggle) toggle.setAttribute('aria-expanded', 'true');
      const first = docNav.querySelector('a');
      if (first) first.focus();
    };

    if (toggle) {
      toggle.addEventListener('click', () => {
        const open = aside && aside.getAttribute('data-open') === 'true';
        if (open) closeNav();
        else openNav();
      });
    }

    if (overlay) overlay.addEventListener('click', closeNav);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (aside && aside.getAttribute('data-open') === 'true') {
        event.preventDefault();
        closeNav();
      }
    });

    docNav.addEventListener('click', (event) => {
      const picked = event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!picked) return;
      const pickedId = decodeURIComponent(picked.getAttribute('href').slice(1));
      pinUntil = Date.now() + 900;
      if (pickedId) setCurrent(pickedId);
    });

    docNav.addEventListener('click', (event) => {
      const link = event.target.closest ? event.target.closest('a[href^="#"]') : null;
      if (!link || !isNarrow()) return;
      const id = decodeURIComponent(link.getAttribute('href').slice(1));
      const target = document.getElementById(id);
      closeNav(false);
      if (target) {
        // Move focus to the heading so the next Tab continues from there.
        // preventScroll keeps the browser's own scroll-to-anchor intact.
        target.setAttribute('tabindex', '-1');
        target.focus({ preventScroll: true });
      }
    });
  }

  applyLang(detectLang());
})();