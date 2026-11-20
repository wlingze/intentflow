// 文件树跳转与跨行着色的真实浏览器检查：脚本用固定夹具自己起工作台。
// 夹具里的 store.go 有两段相距很远的改动，raw.go 的 Go 原始字符串跨多行。
// 用法：NODE_PATH=<playwright 全局包> node scripts/e2e/ui.mjs [binary]
// 截图：设置 SCREENSHOT_DIR=<目录> 时额外保存两张整页截图。
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = resolve(root, process.argv[2] || 'bin/intentflow');
const fixture = join(root, 'scripts/e2e/fixtures/ui');

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(browsers)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(browsers)) {
    if (!entry.startsWith('chromium-')) continue;
    candidates.push(
      join(browsers, entry, 'chrome-linux64', 'chrome'),
      join(browsers, entry, 'chrome-linux', 'chrome'),
      join(browsers, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    );
  }
  return candidates.find((path) => existsSync(path));
}

function startServer() {
  if (!existsSync(binary)) throw new Error(`${binary} 不存在，先运行 make build`);
  const child = spawn(binary, [
    '--before', join(fixture, 'before'),
    '--after', join(fixture, 'after'),
    '--host', '127.0.0.1',
    '--port', '0',
    '--no-open',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  let settled = false;
  return new Promise((resolveStart, rejectStart) => {
    const finish = (error, port) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) rejectStart(error);
      else resolveStart({ child, port, output: () => output });
    };
    const timer = setTimeout(() => finish(new Error(`工作台启动超时:\n${output}`)), 60000);
    const read = (chunk) => {
      output += chunk;
      const match = output.match(/端口:\s*(\d+)/);
      if (match) finish(null, Number(match[1]));
    };
    child.stdout.on('data', (chunk) => read(String(chunk)));
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('exit', (code) => finish(new Error(`工作台退出 (${code}):\n${output}`)));
  });
}

const cardState = (page, path) => page.evaluate((path) => {
  const card = document.querySelector(`[data-file="${path}"]`);
  if (!card) return { found: false };
  const scroller = document.querySelector('[data-review-scroll]');
  const view = scroller.getBoundingClientRect();
  const head = card.querySelector('header');
  const hunk = card.querySelector('[data-hunk-head]');
  const gaps = [...card.querySelectorAll('[data-virtual-row]')].filter((row) => row.textContent.includes('已折叠'));
  const lines = [...card.querySelectorAll('[data-line]')];
  const first = lines.find((line) => line.getBoundingClientRect().bottom > view.top);
  const text = hunk?.textContent ?? '';
  const start = text.match(/−(\d+)/)?.[1];
  return {
    found: true,
    open: card.querySelector('button[aria-expanded]')?.getAttribute('aria-expanded'),
    gaps: gaps.length,
    rows: card.querySelectorAll('[data-virtual-row]').length,
    cardHeight: Math.round(card.getBoundingClientRect().height),
    hunkTop: hunk ? Math.round(hunk.getBoundingClientRect().top - view.top) : null,
    headBottom: Math.round(head.getBoundingClientRect().bottom - view.top),
    hunkText: text,
    hunkStart: start ? Number(start) : null,
    firstLine: first?.dataset.line ?? null,
  };
}, path);

const sourceHtml = (page, path, line, side = 'after') => page.evaluate(({ path, line, side }) => {
  const card = document.querySelector(`[data-file="${path}"]`);
  return card?.querySelector(`[data-line="${line}"][data-side="${side}"] [data-source]`)?.innerHTML ?? null;
}, { path, line, side });

async function clickTree(page, path) {
  const row = page.locator(`button[data-tree-path="${path}"]`);
  await row.scrollIntoViewIfNeeded();
  await row.click();
  await page.waitForTimeout(900);
}

async function expandAll(page, path) {
  const button = page.locator(`[data-file="${path}"] button`, { hasText: '展开全部' });
  assert.equal(await button.count(), 1, `${path}: 没有「展开全部」按钮`);
  await button.click();
  await page.waitForTimeout(500);
}

function checkFirstHunk(state, label) {
  assert(state.found, `${label}: 找不到目标卡片`);
  assert.equal(state.open, 'true', `${label}: 卡片没有展开`);
  assert(state.gaps >= 2, `${label}: 折叠区没有收回，仍显示整份文件`);
  assert(state.hunkStart, `${label}: 找不到 hunk 头`);
  assert(
    state.hunkTop >= state.headBottom - 1 && state.hunkTop <= state.headBottom + 24,
    `${label}: 第一个 hunk 没有对齐到卡片头部下方 (${state.hunkTop} vs ${state.headBottom})`,
  );
  assert.equal(String(state.firstLine), String(state.hunkStart), `${label}: 视口第一行不是第一个 hunk 的起始行`);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  const screenshotDir = process.env.SCREENSHOT_DIR ? resolve(process.env.SCREENSHOT_DIR) : '';
  if (screenshotDir) mkdirSync(screenshotDir, { recursive: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await page.goto(`http://127.0.0.1:${server.port}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForFunction(() => document.querySelectorAll('[data-tree-path]').length > 0, { timeout: 60000 });
    await page.waitForTimeout(600);

    // 文件树跳转：只显示 diff，并把第一段 hunk 顶到卡片头下面。
    await clickTree(page, 'store.go');
    const first = await cardState(page, 'store.go');
    checkFirstHunk(first, '首次点击文件树');
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'ui-jump-first-hunk.png') });

    // 用户展开全文后再次点击文件树：折叠区必须收回，回到第一段 hunk。
    await expandAll(page, 'store.go');
    const expanded = await cardState(page, 'store.go');
    assert.equal(expanded.gaps, 0, '「展开全部」后仍有折叠区');
    assert(expanded.cardHeight > first.cardHeight + 1000, '「展开全部」没有露出整份文件');
    await clickTree(page, 'store.go');
    const again = await cardState(page, 'store.go');
    checkFirstHunk(again, '展开全文后再次点击文件树');

    // 跨行原始字符串：diff 里的上下文行已经是字符串颜色。
    await clickTree(page, 'raw.go');
    const context = await sourceHtml(page, 'raw.go', 6);
    assert(context, 'raw.go 第 6 行没有渲染');
    assert(context.includes('tok-string'), `raw.go 第 6 行缺少字符串颜色: ${context}`);
    assert(!context.includes('tok-keyword'), `raw.go 第 6 行仍按 Go 关键字着色: ${context}`);
    for (const line of [7, 9, 10]) {
      const html = await sourceHtml(page, 'raw.go', line);
      assert(html?.includes('tok-string'), `raw.go 第 ${line} 行缺少字符串颜色: ${html}`);
      assert(!html?.includes('tok-keyword'), `raw.go 第 ${line} 行仍按 Go 关键字着色: ${html}`);
    }

    // 全文视图与 diff 视图对同一行给出完全相同的 HTML。
    await expandAll(page, 'raw.go');
    const full = await sourceHtml(page, 'raw.go', 6);
    assert.equal(full, context, 'raw.go 第 6 行在 diff 与全文视图中的着色不一致');
    const close = await sourceHtml(page, 'raw.go', 12);
    assert(close?.includes('tok-string'), `raw.go 第 12 行的结束反引号不是字符串: ${close}`);
    const after = await sourceHtml(page, 'raw.go', 14);
    assert(after?.includes('<span class="tok-keyword">func</span>'), `raw.go 第 14 行没有恢复 Go 关键字: ${after}`);
    assert(!after?.includes('tok-string'), `raw.go 第 14 行仍被当成字符串: ${after}`);
    if (screenshotDir) await page.screenshot({ path: join(screenshotDir, 'ui-raw-string.png') });

    assert.equal(errors.length, 0, `console errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ first, expanded, again, context, full, close, after, errors }, null, 1));
    console.log('E2E OK');
  } finally {
    await browser.close();
    server.child.kill('SIGTERM');
  }
})().catch((error) => { console.error(error); process.exit(1); });