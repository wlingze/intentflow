/* UI behaviour: language switch, theme switch, copy buttons, docs sidebar.
   Messages are a plain object so scripts/check-site.mjs can read the keys
   without a parser: one `'key': 'value',` per line, four spaces of indent. */

const messages = {
  en: {
    'page.title': 'intentflow — local diff workbench',
    'page.description': 'Read a local Git diff, write line comments, copy the review to your coding agent in one keystroke. One static binary, no server-side storage.',
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
    'hero.kicker': 'Local diff workbench for coding agents',
    'hero.title': 'Read the diff. Write the note. Hand it to the agent.',
    'hero.lead': 'Read a local diff, comment, copy one block into your agent.',
    'hero.fact1': 'single static binary',
    'hero.fact2': 'runtime needs only git',
    'hero.fact3': 'reviews stay in the browser',
    'hero.download': 'Download v0.1.0',
    'hero.docs': 'Read the docs',
    'copy.title': 'One keystroke to the agent',
    'copy.claim': 'One keystroke copies the whole review as Markdown.',
    'copy.d1': 'copies without opening the menu',
    'copy.d2': 'every comment carries the lines it quotes',
    'copy.d3': 'both formats copy or save',
    'copy.fig': 'Submit menu: Markdown and JSON.',
    'copy.figAlt': 'The submit menu open on the review panel, with Markdown and JSON rows.',
    'git.title': 'Git ranges, not a file picker',
    'git.claim': 'Renames stay one card; viewed marks expire on change.',
    'git.d1': 'any branch, tag, commit or worktree',
    'git.d2': 'nearest ancestor; never `HEAD~1`',
    'git.d3': 'renames show as one card',
    'git.fig': 'Split view: hunk header, viewed mark, line comment.',
    'git.figAlt': 'A diff card in split view with a hunk header, a viewed checkbox and an inline comment.',
    'local.title': 'Local first, in one binary',
    'local.claim': 'One binary, frontend inside. No service, no account.',
    'local.d1': 'runtime needs `git` only',
    'local.d2': 'drafts, marks and images stay here',
    'local.d3': 'the server writes no files',
    'local.fig': 'Review panel: comments stay in this browser.',
    'local.figAlt': 'The review panel with two comments on a diff, each carrying the code it quotes.',
    'symbols.title': 'Every reference, without a language server',
    'symbols.claim': 'Click a word to see every place it appears.',
    'symbols.d1': 'changed files, both sides; no index, no LSP',
    'symbols.d2': 'whole word: `hit` does not match `hits`',
    'symbols.d3': 'rows in one comparison',
    'symbols.fig': 'Left, lower panel: the reference list for `$hit`, 1457 rows.',
    'symbols.figAlt': 'The full workbench: file tree and the symbol panel on the left, diff cards in the middle, review panel on the right.',
    'spec.quote': 'quoted code',
    'spec.detect': 'detection',
    'spec.scope': 'scope',
    'spec.disk': 'disk',
    'spec.match': 'match',
    'spec.range': 'range',
    'spec.formats': 'formats',
    'more.title': 'Also in the workbench',
    'more.i1': 'File tree with comment counts',
    'more.i2': 'Line and multi-line comments',
    'more.i3': 'Search with case and whole-word switches',
    'more.i4': 'Split or unified view, with wrapping',
    'more.i5': 'Virtualised rows for long diffs',
    'more.i6': '`Ctrl`+`F` search, arrow keys, `Ctrl`+`Enter` copy',
    'install.title': 'Install',
    'install.lead': 'Six v0.1.0 archives, one executable each.',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.releases': 'All releases and checksums',
    'install.table.caption': 'Platform archives',
    'install.table.platform': 'Platform',
    'install.table.file': 'Archive',
    'status.title': 'What ships today',
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
    'docs.range.body': 'Ranges come from Git, or from two directories.',
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
    'docs.review.hunk': 'Fold a hunk; expand five lines at a time.',
    'docs.review.tree': 'The tree folds by directory and counts comments.',
    'docs.review.search': '`Ctrl`+`F` searches every file, with case and whole-word switches.',
    'docs.review.rename': 'A rename is one card: old path, arrow, new name.',
    'docs.review.marksTitle': 'Viewed marks',
    'docs.review.marksBody': 'A hunk is keyed by file, row and content digest, so an edited hunk loses its mark.',
    'docs.review.marksFile': 'Marking a file marks its hunks.',
    'docs.review.marksTree': 'A viewed file greys out and collapses.',
    'docs.symbols.title': '4. Symbols',
    'docs.symbols.body': 'Click an identifier to list every place it appears.',
    'docs.symbols.scopeTitle': 'Scope:',
    'docs.symbols.scopeBody': 'changed files of this comparison, both sides. No index, no language server.',
    'docs.symbols.usageTitle': 'How to use it',
    'docs.symbols.step1': 'Click a word to open the panel.',
    'docs.symbols.step2': 'Rows group by file, with a line number and one of three colours.',
    'docs.symbols.step3': 'Click a row to jump to that line.',
    'docs.symbols.step4': 'Whole word by default: `hit` does not match `hits`.',
    'docs.symbols.scale': '`$hit` returned 1457 rows in one comparison.',
    'docs.export.title': '5. Export',
    'docs.export.body': 'Two rows: copy to the clipboard or save a file.',
    'docs.export.markdown': 'Markdown: path, side, line, quoted code.',
    'docs.export.json': 'JSON: the full document.',
    'docs.export.shortcut': '`Ctrl`+`Enter` copies Markdown without the menu.',
    'docs.export.usage': 'Paste into Claude Code, Codex or pi. Nothing is sent.',
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
    'page.description': '读本地 Git diff、写行级评论、一次复制成 Markdown 交给编码代理。单个静态二进制，服务端不存评审数据。',
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
    'hero.kicker': '给编码代理用的本地 diff 工作台',
    'hero.title': '读完改动，写下意见，交给代理。',
    'hero.lead': '读本地 diff，写评论，一次复制成 agent 能用的块。',
    'hero.fact1': '单个静态二进制',
    'hero.fact2': '运行只依赖 git',
    'hero.fact3': '评审只存在浏览器里',
    'hero.download': '下载 v0.1.0',
    'hero.docs': '查看文档',
    'copy.title': '一键复制，直接交给代理',
    'copy.claim': '一次按键，整份评审复制成 Markdown。',
    'copy.d1': '不打开菜单，直接复制',
    'copy.d2': '每条评论都带上它引用的代码行',
    'copy.d3': '两种格式都能复制或保存',
    'copy.fig': '提交菜单：Markdown 与 JSON。',
    'copy.figAlt': '评审面板上打开的提交菜单，含 Markdown 与 JSON 两行。',
    'git.title': '范围来自 Git，不是文件选择器',
    'git.claim': '重命名是一张卡片；内容一变，标记失效。',
    'git.d1': '任意分支、标签、提交或工作区',
    'git.d2': '就近取祖先；绝不退回 `HEAD~1`',
    'git.d3': '重命名显示为一张卡片',
    'git.fig': '分栏视图：hunk 头、已查看勾选、行级评论。',
    'git.figAlt': '分栏视图的一张 diff 卡片，带 hunk 头、已查看勾选与一条行内评论。',
    'local.title': '本地优先，只有一个二进制',
    'local.claim': '一个二进制，内嵌前端。不起服务，不登录。',
    'local.d1': '运行时只需要 `git`',
    'local.d2': '草稿、标记与图片都留在这里',
    'local.d3': '服务端不写任何文件',
    'local.fig': '评审面板：评论留在这个浏览器里。',
    'local.figAlt': '窄窗口下的工作台，左右两栏都收成抽屉。',
    'symbols.title': '不用语言服务器，也能列出每处引用',
    'symbols.claim': '点一个词，看它出现的每一处。',
    'symbols.d1': '改动文件的前后两侧；不建索引，不用 LSP',
    'symbols.d2': '默认整词：`hit` 不会命中 `hits`',
    'symbols.d3': '一次比较里的全部行',
    'symbols.fig': '左下角面板：`$hit` 的引用列表，共 1457 行。',
    'symbols.figAlt': '完整工作台：左侧是文件树与符号面板，中间是 diff 卡片，右侧是评审面板。',
    'spec.quote': '引用原文',
    'spec.detect': '自动识别',
    'spec.scope': '范围',
    'spec.disk': '磁盘',
    'spec.match': '匹配',
    'spec.range': '范围',
    'spec.formats': '格式',
    'more.title': '工作台里的其他部分',
    'more.i1': '文件树带评论计数',
    'more.i2': '行评论与多行评论',
    'more.i3': '搜索带大小写与整词开关',
    'more.i4': '并排或统一视图，可换行',
    'more.i5': '长 diff 用虚拟滚动',
    'more.i6': '`Ctrl`+`F` 搜索、方向键、`Ctrl`+`Enter` 复制',
    'install.title': '安装',
    'install.lead': '六个 v0.1.0 压缩包，各含一个可执行文件。',
    'install.unix': 'Linux / macOS',
    'install.windows': 'Windows',
    'install.unixCmd': 'tar -xzf intentflow_0.1.0_linux_amd64.tar.gz\nsudo install -m755 intentflow /usr/local/bin/intentflow\nintentflow version',
    'install.windowsCmd': 'Expand-Archive intentflow_0.1.0_windows_amd64.zip -DestinationPath .\n.\\intentflow.exe version',
    'install.releases': '全部发布与校验和',
    'install.table.caption': '平台产物',
    'install.table.platform': '平台',
    'install.table.file': '文件',
    'status.title': '当前发布范围',
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
    'docs.range.body': '范围来自 Git，或来自两个目录。',
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
    'docs.review.hunk': '折叠代码块；每次展开 5 行。',
    'docs.review.tree': '文件树按目录折叠，并统计评论数。',
    'docs.review.search': '`Ctrl`+`F` 搜索所有文件，可切大小写与整词。',
    'docs.review.rename': '重命名是一张卡片：旧路径、箭头、新名字。',
    'docs.review.marksTitle': '已查看标记',
    'docs.review.marksBody': '标记按文件、行号和内容摘要计算，改动过的块会失去标记。',
    'docs.review.marksFile': '标记一个文件会标记它所有块。',
    'docs.review.marksTree': '全部查看的文件变灰并折叠。',
    'docs.symbols.title': '4. 符号',
    'docs.symbols.body': '点一个标识符，列出它出现的每一处。',
    'docs.symbols.scopeTitle': '范围：',
    'docs.symbols.scopeBody': '本次比较的改动文件，前后两侧。不建索引，不起语言服务器。',
    'docs.symbols.usageTitle': '用法',
    'docs.symbols.step1': '点代码里的词，面板就打开。',
    'docs.symbols.step2': '按文件分组，每行带行号与三种颜色之一。',
    'docs.symbols.step3': '点一行，diff 跳到该处。',
    'docs.symbols.step4': '默认整词：`hit` 不会命中 `hits`。',
    'docs.symbols.scale': '一次比较里 `$hit` 返回 1457 行。',
    'docs.export.title': '5. 导出',
    'docs.export.body': '两行：复制到剪贴板，或存成文件。',
    'docs.export.markdown': 'Markdown：路径、左右侧、行号、引用原文。',
    'docs.export.json': 'JSON：完整文档。',
    'docs.export.shortcut': '`Ctrl`+`Enter` 不开菜单直接复制 Markdown。',
    'docs.export.usage': '粘进 Claude Code、Codex 或 pi，不会自动提交。',
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