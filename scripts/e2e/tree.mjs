// 文件树默认展开的真实布局检查：脚本自己用固定夹具起一个工作台，跑完关闭。
// 夹具照参考图搭：common/yak/reify 单链，reify 下有直接改动文件与 5 个子目录。
// 用法：NODE_PATH=<playwright 全局包> node scripts/e2e/tree.mjs [binary]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = resolve(root, process.argv[2] || 'bin/intentflow');
const fixture = join(root, 'scripts/e2e/fixtures/tree');

// 找到已安装的 Chromium：先看 CHROME_PATH，再找 Playwright 的缓存目录。
function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache', 'ms-playwright');
  if (!existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium-')) continue;
    candidates.push(
      join(root, entry, 'chrome-linux64', 'chrome'),
      join(root, entry, 'chrome-linux', 'chrome'),
      join(root, entry, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
    );
  }
  return candidates.find((path) => existsSync(path));
}

// 工作台监听 0 端口，从 stdout 读出实际端口。
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

const treeState = (page) => page.evaluate(() => {
  // A closed <details> hides everything but its own summary.
  const visible = (element) => {
    for (let node = element; node; node = node.parentElement) {
      if (node.tagName !== 'DETAILS' || node.open) continue;
      const summary = node.querySelector(':scope > summary');
      if (!summary || !summary.contains(element)) return false;
    }
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  const dirs = {};
  for (const row of document.querySelectorAll('[data-tree-dir]')) {
    dirs[row.dataset.treeDir] = { visible: visible(row), open: row.closest('details').open };
  }
  const files = {};
  for (const row of document.querySelectorAll('button[data-tree-path]')) files[row.dataset.treePath] = visible(row);
  return { dirs, files, stored: Object.keys(localStorage).filter((key) => key.startsWith('intentflow.tree-open.')) };
});

async function openPage(page, port) {
  await page.goto(`http://127.0.0.1:${port}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-tree-dir]').length > 0, { timeout: 60000 });
  await page.waitForTimeout(600);
}

function checkDefault(state, label) {
  for (const path of ['common', 'common/yak', 'common/yak/reify']) {
    assert(state.dirs[path]?.visible, `${label}: ${path} row is not visible`);
    assert(state.dirs[path]?.open, `${label}: ${path} is not expanded`);
  }
  for (const path of ['cmd', 'core', 'docs', 'test', 'ssa']) {
    const row = state.dirs[`common/yak/reify/${path}`];
    assert(row?.visible, `${label}: common/yak/reify/${path} row is not visible`);
    assert.equal(row.open, false, `${label}: common/yak/reify/${path} must stay collapsed`);
  }
  assert(state.files['common/yak/reify/README.md'], `${label}: README.md is not visible`);
  assert(state.files['common/yak/reify/reify.go'], `${label}: reify.go is not visible`);
  assert.equal(state.files['common/yak/reify/cmd/reify/main.go'], false, `${label}: files of a collapsed folder are visible`);
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

    await openPage(page, server.port);
    const opened = await treeState(page);
    checkDefault(opened, '首次打开');
    assert.equal(opened.stored.length, 0, 'default layout must not write a stored choice');

    // 目录行保留增删统计与计数徽标。
    const reifyRow = await page.locator('[data-tree-dir="common/yak/reify"]').innerText();
    assert.match(reifyRow, /\+\d+/, 'directory row lost its added lines');
    assert.match(reifyRow, /−\d+/, 'directory row lost its removed lines');
    assert.match(reifyRow, /\b7\b/, 'directory row lost its changed file count');

    // 手动折叠后刷新：记住用户的布局，而不是重新套用默认规则。
    await page.locator('[data-tree-dir="common/yak/reify"]').click();
    await page.waitForTimeout(300);
    const collapsed = await treeState(page);
    assert.equal(collapsed.dirs['common/yak/reify'].open, false, 'reify did not collapse');
    assert.equal(collapsed.files['common/yak/reify/README.md'], false, 'README.md stayed visible after collapse');
    assert.equal(collapsed.stored.length, 1, 'manual layout was not stored');

    await openPage(page, server.port);
    const restored = await treeState(page);
    assert.equal(restored.dirs['common/yak/reify'].open, false, 'reload did not restore the manual collapse');
    assert(restored.dirs['common/yak'].open, 'reload collapsed the ancestor chain');

    // 清掉偏好后刷新：回到默认规则。
    await page.evaluate(() => localStorage.clear());
    await openPage(page, server.port);
    checkDefault(await treeState(page), '清空偏好后');

    // 过滤时按结果展开；清空过滤后回到默认规则。
    const filterBox = page.locator('input[aria-label="过滤文件"]');
    await filterBox.fill('README');
    await page.waitForTimeout(300);
    const filtered = await treeState(page);
    assert(filtered.dirs['common/yak/reify'].open, 'filter did not open the matching path');
    assert(filtered.files['common/yak/reify/README.md'], 'filtered file is not visible');
    assert(!filtered.files['common/yak/reify/reify.go'], 'filter kept an unrelated file');
    await filterBox.fill('');
    await page.waitForTimeout(300);
    checkDefault(await treeState(page), '清空过滤后');

    assert.equal(errors.length, 0, `console errors: ${errors.join(' | ')}`);
    console.log(JSON.stringify({ opened, collapsed, restored, filtered, reifyRow, errors }, null, 1));
    console.log('E2E OK');
  } finally {
    await browser.close();
    server.child.kill('SIGTERM');
  }
})().catch((error) => { console.error(error); process.exit(1); });