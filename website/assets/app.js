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
    'hero.lead': 'Open a local repo, comment on the diff, copy one Markdown block into Claude Code, Codex or pi.',
    'hero.fact1': 'single static binary',
    'hero.fact2': 'runtime needs only git',
    'hero.fact3': 'reviews stay in the browser',
    'hero.download': 'Download v0.1.0',
    'hero.docs': 'Read the docs',
    'copy.title': 'One keystroke to the agent',
    'copy.claim': 'Copies the whole review as Markdown in one keystroke, quoted code included.',
    'copy.d1': 'copies without opening the menu',
    'copy.d2': 'every comment carries the lines it quotes',
    'copy.d3': 'the same menu copies or saves Markdown and JSON',
    'copy.fig': 'Submit menu: Markdown and JSON.',
    'copy.figAlt': 'The submit menu open on the review panel, with Markdown and JSON rows.',
    'git.title': 'Git ranges, not a file picker',
    'git.claim': 'Renames stay one card. Viewed marks expire when the content moves.',
    'git.d1': 'any branch, tag, commit or worktree',
    'git.d2': 'nearest ancestor; never `HEAD~1`',
    'git.d3': 'renames read as one card, not delete plus add',
    'git.fig': 'Split view: hunk header, viewed mark, line comment.',
    'git.figAlt': 'A diff card in split view with a hunk header, a viewed checkbox and an inline comment.',
    'local.title': 'Local first, in one binary',
    'local.claim': 'One executable with the frontend inside. No service, no account, no files on disk.',
    'local.d1': 'runtime needs `git` only',
    'local.d2': 'drafts, marks and images stay in the browser',
    'local.d3': 'the server writes no files',
    'local.fig': 'Review panel: comments stay in this browser.',
    'local.figAlt': 'The review panel with two comments on a diff, each carrying the code it quotes.',
    'symbols.title': 'Every reference, without a language server',
    'symbols.claim': 'Click an identifier to see every place it appears in this comparison.',
    'symbols.d1': 'changed files, both sides; no index, no LSP',
    'symbols.d2': 'whole word: `hit` does not match `hits`',
    'symbols.d3': 'rows for one identifier in one comparison',
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
    'install.note': 'Runtime needs git only.',
    'install.releases': 'All releases and checksums',
    'install.table.caption': 'Platform archives',
    'install.table.platform': 'Platform',
    'install.table.file': 'Archive',
    'status.title': 'What ships today',
    'status.lead': 'Stage one ships. Stages two to four are the target structure.',
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
    'footer.note': 'Static site: no build step, no analytics, no third-party requests.',
    'docs.pageTitle': 'Docs — intentflow',
    'docs.pageDescription': 'Start the workbench, pick a Git range, review a diff, use the symbol panel, export the result, and build from source.',
    'docs.head.kicker': 'Reference',
    'docs.head.title': 'Intentflow docs',
    'docs.head.lead': 'Start the workbench, pick a Git range, review, export. The symbol panel and the build commands come after.',
    'docs.toc': 'Contents',
    'docs.group.start': 'Getting started',
    'docs.group.review': 'Reviewing',
    'docs.group.reference': 'Reference',
    'docs.nav.start': 'Start the workbench',
    'docs.nav.range': 'Pick a range',
    'docs.nav.rangeCommands': 'Common ranges',
    'docs.nav.rangeFlags': 'Flags',
    'docs.nav.review': 'Review a diff',
    'docs.nav.reviewMarks': 'Viewed marks',
    'docs.nav.symbols': 'The symbol panel',
    'docs.nav.symbolsUsage': 'How to use it',
    'docs.nav.export': 'Export',
    'docs.nav.data': 'Where reviews live',
    'docs.nav.build': 'Build from source',
    'docs.nav.design': 'Design documents',
    'docs.start.title': '1. Start the workbench',
    'docs.start.body': 'Run inside the repository you want to review. The terminal prints the address and opens the browser. With `--no-open` it only prints the address.',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.start.note': 'No binary yet? Run `./scripts/build.sh`, or `make serve` to start the bundled demo under `examples/demo-go`.',
    'docs.range.title': '2. Pick a range',
    'docs.range.body': 'The comparison always comes from Git history or from two directories. There is no file picker and no staging area.',
    'docs.range.commandsTitle': 'Common ranges',
    'docs.range.flagsTitle': 'Flags',
    'docs.range.table.caption': 'Common ranges',
    'docs.range.table.command': 'Command',
    'docs.range.table.meaning': 'Meaning',
    'docs.range.all': 'main to HEAD',
    'docs.range.worktree': 'main to the worktree, including untracked files',
    'docs.range.commits': 'A tag or commit range',
    'docs.range.folders': 'Two directories, no Git needed',
    'docs.range.note': 'With no `--base`, intentflow looks for main, master, origin/main and origin/master in the current HEAD history and takes the nearest one. If none of them is an ancestor, it stops and asks for an explicit base. It never falls back to `HEAD~1`.',
    'docs.params.caption': 'Flags',
    'docs.params.flag': 'Flag',
    'docs.params.meaning': 'Meaning',
    'params.target': 'Repository directory, default `.`; a subdirectory keeps paths relative to it',
    'params.base': 'Baseline; the nearest of main, master, origin/main, origin/master by default',
    'params.head': 'End point, default `HEAD`; `WORKTREE` adds uncommitted and untracked files',
    'params.beforeAfter': 'Compare two directories instead of a Git range',
    'params.host': 'Listen address, default `0.0.0.0`; `127.0.0.1` keeps it on this machine',
    'params.port': 'Port; `0` lets the system pick a free one',
    'params.out': 'Directory where `intentflow diff` writes `review.json`',
    'params.dist': 'Override the embedded frontend, debug only',
    'params.noOpen': 'Do not open the browser',
    'params.verbose': 'Print progress',
    'docs.review.title': '3. Review a diff',
    'docs.review.body': 'Every mark and comment belongs to the review document of the current comparison. Nothing is written on the server.',
    'docs.review.line': 'Add a line comment from the plus button, or select several lines to comment on a range.',
    'docs.review.hunk': 'Fold a hunk down, expand it five lines at a time, or open the whole file from the card header.',
    'docs.review.tree': 'The file tree folds by directory and shows added and removed lines plus the comment count per file.',
    'docs.review.search': 'Search every diff file with `Ctrl`+`F`, or `Cmd`+`F` on macOS, with case and whole-word switches.',
    'docs.review.rename': 'A rename shows as one card: the old path struck through, an arrow, then the new name.',
    'docs.review.marksTitle': 'Viewed marks',
    'docs.review.marksBody': 'A hunk header carries a viewed checkbox. The key is the file, the row and a digest of the hunk, so when the file content changes the old mark drops instead of hiding a new hunk.',
    'docs.review.marksFile': 'Marking a file marks every hunk in it; clearing the file clears them too.',
    'docs.review.marksTree': 'A fully viewed file turns grey in the tree and collapses its card; a directory shows a tick when all of its files are done.',
    'docs.review.marksKeep': 'Expanding a card again does not undo the mark.',
    'docs.symbols.title': '4. The symbol panel',
    'docs.symbols.body': 'Click any identifier in the diff. The left panel lists every place that word appears and jumps there when you pick a row.',
    'docs.symbols.scopeTitle': 'Scope.',
    'docs.symbols.scopeBody': 'Every changed file in the current comparison, both sides. This is not a repository index, and it is not a language server: nothing is resolved, indexed or installed.',
    'docs.symbols.usageTitle': 'How to use it',
    'docs.symbols.step1': 'Click a word in the code. The panel opens with the word it picked up.',
    'docs.symbols.step2': 'Rows are grouped by file. Each row shows a line number and one of three colours: added, removed or context.',
    'docs.symbols.step3': 'Click a row to move the diff view to that line.',
    'docs.symbols.step4': 'Whole-word matching is on by default, so `hit` does not match `hits`. Toggle the case switch when the case matters.',
    'docs.symbols.scale': 'The list is not truncated to one screen: the workbench screenshot shows `$hit` returning 1457 references inside a single comparison. Large counts are exactly what this panel is for, because a plain-text match over the changed files needs no symbol resolution.',
    'docs.symbols.note': 'The same search engine backs `Ctrl`+`F`, so the rows and colours match the global search exactly.',
    'docs.export.title': '5. Export',
    'docs.export.body': 'The submit menu has two rows. Each one copies to the clipboard or saves a file.',
    'docs.export.markdown': 'Markdown: comments with path, side, line numbers, and the quoted code under each one.',
    'docs.export.json': 'JSON: the full document, for tools that read it.',
    'docs.export.shortcut': '`Ctrl`+`Enter` or `Cmd`+`Enter` copies Markdown without opening the menu. It stays quiet while the focus is in an input or a dialog.',
    'docs.export.usage': 'Paste the result into Claude Code, Codex or pi. Nothing is submitted automatically.',
    'docs.export.sample': '## Review\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\nUser input is concatenated into SQL. Use a parameterised query: WHERE name LIKE ?, and pass the wildcard as a parameter.\n\n### 2. Overall\nThis change replaces parameterised queries with string concatenation. I would revert it.',
    'docs.data.title': '6. Where reviews live',
    'docs.data.body': 'The server keeps no review state. Everything below is written by the browser.',
    'data.reviews': 'Reviews live in browser localStorage, under the key `intentflow.review.<comparison_id>`.',
    'data.images': 'Comment images are inline data URLs, up to 1.5MB each, stored with the review.',
    'data.layout': 'Layout preferences use the `intentflow.` prefix in localStorage.',
    'data.server': 'The server writes no files. Closing it loses nothing.',
    'docs.build.title': '7. Build from source',
    'docs.build.body': 'Build needs Go 1.24 or later, pnpm and git. `schema/openapi.yaml` is the only data contract; the Go and TypeScript type files are both generated from it.',
    'docs.build.cmd': 'make tools          # oapi-codegen and frontend deps, once\nmake schema         # schema/openapi.yaml -> Go and TypeScript types\nmake check          # go vet, Go tests, tsc, Vitest\nmake build          # frontend build and static binary\nmake release-check  # cross-compile the six release targets',
    'docs.build.site': 'The website is plain files: `make site` serves it on port 8131, `make site-check` validates it.',
    'docs.design.title': '8. Design documents',
    'docs.design.body': 'The thesis, the layer model, the contract rules and the review platform notes live in `docs/`.',
    'docs.design.thesis': 'code cannot express intent',
    'docs.design.layers': 'the three layers and their identity keys',
    'docs.design.frontend': 'workbench layout and interaction',
    'docs.design.behavior': 'behaviour view and diff rules',
    'docs.design.contract': 'one OpenAPI definition, generated on both sides',
    'docs.design.release': 'version, artifacts and checksums',
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
    'hero.lead': '打开本地仓库，在改动上写意见，一次复制成 Markdown 交给 Claude Code、Codex 或 pi。',
    'hero.fact1': '单个静态二进制',
    'hero.fact2': '运行只依赖 git',
    'hero.fact3': '评审只存在浏览器里',
    'hero.download': '下载 v0.1.0',
    'hero.docs': '查看文档',
    'copy.title': '一键复制，直接交给代理',
    'copy.claim': '一次按键就把整份评审复制成 Markdown，评论自带引用原文。',
    'copy.d1': '不打开菜单，直接复制',
    'copy.d2': '每条评论都带上它引用的代码行',
    'copy.d3': '同一个菜单可复制或保存 Markdown 与 JSON',
    'copy.fig': '提交菜单：Markdown 与 JSON。',
    'copy.figAlt': '评审面板上打开的提交菜单，含 Markdown 与 JSON 两行。',
    'git.title': '范围来自 Git，不是文件选择器',
    'git.claim': '重命名仍是一张卡片。内容一变，已查看标记就失效。',
    'git.d1': '任意分支、标签、提交或工作区',
    'git.d2': '就近取祖先；绝不退回 `HEAD~1`',
    'git.d3': '重命名读作一张卡片，不是删除加新增',
    'git.fig': '分栏视图：hunk 头、已查看勾选、行级评论。',
    'git.figAlt': '分栏视图的一张 diff 卡片，带 hunk 头、已查看勾选与一条行内评论。',
    'local.title': '本地优先，只有一个二进制',
    'local.claim': '一个可执行文件内嵌前端。不起服务、不登录、不落盘。',
    'local.d1': '运行时只需要 `git`',
    'local.d2': '草稿、标记与图片都留在浏览器',
    'local.d3': '服务端不写任何文件',
    'local.fig': '评审面板：评论留在这个浏览器里。',
    'local.figAlt': '窄窗口下的工作台，左右两栏都收成抽屉。',
    'symbols.title': '不用语言服务器，也能列出每处引用',
    'symbols.claim': '点任意标识符，列出它在本次比较里的每一处出现。',
    'symbols.d1': '只覆盖改动文件的前后两侧；不建索引，不用 LSP',
    'symbols.d2': '默认整词：`hit` 不会命中 `hits`',
    'symbols.d3': '一次比较里一个标识符的全部行',
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
    'install.note': '运行时只需要 git。',
    'install.releases': '全部发布与校验和',
    'install.table.caption': '平台产物',
    'install.table.platform': '平台',
    'install.table.file': '文件',
    'status.title': '当前发布范围',
    'status.lead': '第一阶段已发布。第二到第四阶段是目标结构。',
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
    'status.note': 'AI 与 SyntaxFlow 页签会说明自己尚未启用。',
    'footer.tagline': '本地 diff 工作台。评审只存在浏览器里。',
    'footer.docs': '文档',
    'footer.github': 'GitHub',
    'footer.releases': '发布',
    'footer.license': 'Apache-2.0',
    'footer.note': '纯静态站点：无构建步骤、无统计、无第三方请求。',
    'docs.pageTitle': '文档 — intentflow',
    'docs.pageDescription': '启动工作台、选择 Git 范围、评审 diff、使用符号面板、导出结果，以及从源码构建。',
    'docs.head.kicker': '参考',
    'docs.head.title': 'intentflow 文档',
    'docs.head.lead': '启动、选范围、评审、导出。符号面板与构建命令在后面。',
    'docs.toc': '目录',
    'docs.group.start': '开始使用',
    'docs.group.review': '评审',
    'docs.group.reference': '参考',
    'docs.nav.start': '启动工作台',
    'docs.nav.range': '选比较范围',
    'docs.nav.rangeCommands': '常用范围',
    'docs.nav.rangeFlags': '命令行参数',
    'docs.nav.review': '评审 diff',
    'docs.nav.reviewMarks': '已查看标记',
    'docs.nav.symbols': '符号面板',
    'docs.nav.symbolsUsage': '怎么用',
    'docs.nav.export': '导出',
    'docs.nav.data': '评审存在哪',
    'docs.nav.build': '从源码构建',
    'docs.nav.design': '设计文档',
    'docs.start.title': '1. 启动工作台',
    'docs.start.body': '在要评审的仓库里运行。终端打印地址并打开浏览器；加 `--no-open` 只打印地址。',
    'docs.start.cmd': 'cd /path/to/your/repo\nintentflow --base main\nintentflow --no-open --base main',
    'docs.start.note': '还没有二进制？先跑 `./scripts/build.sh`，或用 `make serve` 启动 `examples/demo-go` 里的 demo。',
    'docs.range.title': '2. 选比较范围',
    'docs.range.body': '比较范围只来自 Git 历史或两个目录。没有文件选择器，也没有暂存区。',
    'docs.range.commandsTitle': '常用范围',
    'docs.range.flagsTitle': '命令行参数',
    'docs.range.table.caption': '常用范围',
    'docs.range.table.command': '命令',
    'docs.range.table.meaning': '含义',
    'docs.range.all': 'main → HEAD',
    'docs.range.worktree': 'main → 工作区，含未跟踪文件',
    'docs.range.commits': '指定提交或 tag 范围',
    'docs.range.folders': '两个目录比较，不需要 Git',
    'docs.range.note': '不给 `--base` 时，只在当前 HEAD 历史里的 main、master、origin/main、origin/master 中按祖先距离取最近的一个。都不在历史里就停下要求显式指定，不会退回 `HEAD~1`。',
    'docs.params.caption': '命令行参数',
    'docs.params.flag': '参数',
    'docs.params.meaning': '含义',
    'params.target': '仓库目录，默认 `.`；指向子目录时路径自动相对化',
    'params.base': '基线；默认在 main、master、origin/main、origin/master 中取最近的',
    'params.head': '终点，默认 `HEAD`；`WORKTREE` 表示含未提交与未跟踪文件',
    'params.beforeAfter': '比较两个目录，而不是 Git 范围',
    'params.host': '监听地址，默认 `0.0.0.0`；仅本机可设 `127.0.0.1`',
    'params.port': '端口；`0` 表示由系统分配空闲端口',
    'params.out': '`intentflow diff` 写 `review.json` 的目录',
    'params.dist': '覆盖内嵌前端，仅调试用',
    'params.noOpen': '不自动打开浏览器',
    'params.verbose': '打印进度',
    'docs.review.title': '3. 评审 diff',
    'docs.review.body': '每个标记与每条评论都属于当前比较范围的评审文档，服务端不写任何东西。',
    'docs.review.line': '点行左侧的加号加行级评论，或拖动选中多行加跨行评论。',
    'docs.review.hunk': 'hunk 可以折起来，可以一次展开 5 行，也可以从卡片头打开整个文件。',
    'docs.review.tree': '文件树按目录折叠，显示增删行数与每个文件的评论数。',
    'docs.review.search': '按 `Ctrl`+`F` 或 macOS 上的 `Cmd`+`F` 跨全部 diff 文件搜索，可切区分大小写与整词匹配。',
    'docs.review.rename': '重命名显示为一张卡片：旧路径带删除线，箭头，然后是新名字。',
    'docs.review.marksTitle': '已查看标记',
    'docs.review.marksBody': 'hunk 头右侧有已查看勾选。键是文件、行号与 hunk 摘要，文件内容一变旧标记就失效，不会把新 hunk 误当成看过的。',
    'docs.review.marksFile': '标记一个文件会一次标记它所有 hunk；取消也一样清空。',
    'docs.review.marksTree': '文件的全部 hunk 都标记后，文件在树里变灰、卡片自动折叠；一个目录下全部文件都看完时目录显示勾。',
    'docs.review.marksKeep': '再次展开卡片不会撤销已查看。',
    'docs.symbols.title': '4. 符号面板',
    'docs.symbols.body': '点 diff 里的任意标识符，左栏列出这个词出现的每一处，点一行就跳过去。',
    'docs.symbols.scopeTitle': '范围。',
    'docs.symbols.scopeBody': '本轮比较内的所有改动文件、前后两侧。这不是整仓索引，也不是语言服务器：不解析、不建索引、不安装任何东西。',
    'docs.symbols.usageTitle': '怎么用',
    'docs.symbols.step1': '在代码里点一个词，面板带这个词打开。',
    'docs.symbols.step2': '结果按文件分组，每条带行号，用新增、删除、上下文三色标记。',
    'docs.symbols.step3': '点一行，diff 视图跳到那一行。',
    'docs.symbols.step4': '默认整词匹配，`hit` 不会命中 `hits`；需要区分大小写时打开大小写开关。',
    'docs.symbols.scale': '列表不会被截成屏幕那么大：工作台截图里 `$hit` 在一次比较中返回 1457 条引用。这种量正是这个面板存在的理由——在改动文件上做纯文本匹配，不需要任何符号解析。',
    'docs.symbols.note': '`Ctrl`+`F` 的全局搜索用的是同一个引擎，所以结果行与配色完全一致。',
    'docs.export.title': '5. 导出',
    'docs.export.body': '提交菜单有 Markdown 与 JSON 两行，每行都能复制到剪贴板或保存成文件。',
    'docs.export.markdown': 'Markdown：评论带路径、左右侧、行号，下面跟引用的代码。',
    'docs.export.json': 'JSON：完整结构，适合程序读取。',
    'docs.export.shortcut': '按 `Ctrl`+`Enter` 或 `Cmd`+`Enter` 直接复制 Markdown，不打开菜单。焦点在输入框或对话框里时不触发。',
    'docs.export.usage': '把结果粘进 Claude Code、Codex 或 pi。不会自动提交给任何模型。',
    'docs.export.sample': '## 评审\n\n### 1. internal/store/store.go · R15\n> query = fmt.Sprintf("SELECT id FROM users WHERE name LIKE \'%%%s%%\'", name)\n\n用户输入直接拼进了 SQL。改成参数化查询：WHERE name LIKE ?，通配符放进参数。\n\n### 2. 整体意见\n这次改动把参数化查询换成字符串拼接，建议整体退回。',
    'docs.data.title': '6. 评审存在哪',
    'docs.data.body': '服务端不保存评审状态。以下全部由浏览器写入。',
    'data.reviews': '评审存在浏览器 localStorage，键为 `intentflow.review.<comparison_id>`。',
    'data.images': '评论图片用内联 data URL，单张上限 1.5MB，随评审一起存。',
    'data.layout': '布局偏好也用 localStorage，前缀是 `intentflow.`。',
    'data.server': '服务端不写任何文件。关掉服务不会丢东西。',
    'docs.build.title': '7. 从源码构建',
    'docs.build.body': '构建需要 Go 1.24 以上、pnpm 与 git。`schema/openapi.yaml` 是唯一数据契约，Go 与 TypeScript 两侧的类型文件都由它生成。',
    'docs.build.cmd': 'make tools          # 安装 oapi-codegen 与前端依赖，一次即可\nmake schema         # schema/openapi.yaml -> Go 与 TypeScript 类型\nmake check          # go vet、Go 测试、tsc、Vitest\nmake build          # 前端构建 + 静态二进制\nmake release-check  # 六个发布目标交叉编译验证',
    'docs.build.site': '官网是纯静态文件：`make site` 在 8131 端口预览，`make site-check` 做校验。',
    'docs.design.title': '8. 设计文档',
    'docs.design.body': '论题、三层模型、契约规则与评审平台说明都在 `docs/` 里。',
    'docs.design.thesis': '代码不能表达意图',
    'docs.design.layers': '三层模型与身份键',
    'docs.design.frontend': '工作台布局与交互',
    'docs.design.behavior': '行为视图定义与 diff 规则',
    'docs.design.contract': 'OpenAPI 单一定义，两侧生成',
    'docs.design.release': '版本号、产物与校验',
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

    const sync = () => {
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