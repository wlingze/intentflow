// 真实浏览器提交检查：起一个 review --wait 服务，点「提交并关闭」，
// 校验 CLI 的 JSON 与退出码。用固定 patch 夹具，不需要 Git 仓库。
// 用法：NODE_PATH=<playwright 全局包> node scripts/e2e/review.mjs [binary]
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const binary = resolve(root, process.argv[2] || 'bin/intentflow');
const work = process.env.INTENTFLOW_E2E_DIR || '/mnt/data/cache/intentflow-e2e';

const PATCH = `diff --git a/store.go b/store.go
index 1111111..2222222 100644
--- a/store.go
+++ b/store.go
@@ -1,3 +1,3 @@
 package store
 
-func Find(name string) string { return name }
+func Find(name string) string { return "SELECT * FROM users WHERE name = '" + name + "'" }
`;

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const browsers = process.env.PLAYWRIGHT_BROWSERS_PATH || join(homedir(), '.cache/ms-playwright');
  if (!existsSync(browsers)) return undefined;
  const { readdirSync } = require('node:fs');
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

function startReview(dir) {
  const patch = join(dir, 'change.patch');
  const ready = join(dir, 'ready.json');
  writeFileSync(patch, PATCH);
  const child = spawn(binary, [
    'review', '--wait', '--json', '--diff', patch,
    '--ready-file', ready, '--timeout', '2m', '--no-open', '--host', '127.0.0.1',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const exit = new Promise((resolveExit) => child.on('exit', (code) => resolveExit(code)));
  return { child, ready, exit, stdout: () => stdout, stderr: () => stderr };
}

async function waitReady(server) {
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    try {
      return JSON.parse(readFileSync(server.ready, 'utf8'));
    } catch {
      await new Promise((resolveWait) => setTimeout(resolveWait, 100));
    }
  }
  throw new Error(`ready 文件未出现:\n${server.stderr()}`);
}

(async () => {
  if (!existsSync(binary)) throw new Error(`${binary} 不存在，先构建二进制`);
  mkdirSync(work, { recursive: true });
  const dir = mkdtempSync(join(work, 'review-'));
  const server = startReview(dir);
  try {
    const ready = await waitReady(server);
    const browser = await chromium.launch({ executablePath: findChrome(), args: ['--no-sandbox'] });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors = [];
      page.on('pageerror', (error) => errors.push(String(error)));
      page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
      await page.goto(ready.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.locator('[data-file="store.go"] [data-line]').first().waitFor({ state: 'visible', timeout: 60000 });
      assert.ok(await page.locator('[data-file="store.go"] [data-line]').count() >= 3, 'diff 行没有渲染');
      await page.getByRole('button', { name: '提交 Review' }).click();
      const menu = page.getByRole('dialog', { name: '提交评审' });
      await menu.waitFor({ state: 'visible', timeout: 60000 });
      assert.equal(await menu.getByRole('button', { name: '提交并关闭' }).count(), 1, '缺少「提交并关闭」按钮');
      await menu.getByRole('button', { name: '要求修改' }).click();
      await menu.getByLabel('审阅总结').fill('e2e：改成参数化查询');
      if (process.env.SCREENSHOT_DIR) {
        mkdirSync(process.env.SCREENSHOT_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'review-submit.png'), fullPage: false });
      }
      await menu.getByRole('button', { name: '提交并关闭' }).click();
      // The page may close itself; when the browser blocks that, a goodbye
      // screen is shown instead.
      const outcome = await Promise.race([
        page.waitForEvent('close').then(() => 'closed'),
        page.getByRole('heading', { name: '审阅已提交' }).waitFor({ timeout: 30000 }).then(() => 'visible').catch(() => 'closed'),
      ]);
      assert.ok(outcome === 'closed' || outcome === 'visible', `unexpected page state ${outcome}`);
      if (outcome === 'visible' && process.env.SCREENSHOT_DIR) {
        await page.screenshot({ path: join(process.env.SCREENSHOT_DIR, 'review-done.png'), fullPage: false });
      }
      // Shutting the server down races the EventSource reconnect. That and a
      // blocked window.close() are expected; any other page error is not.
      const relevant = errors.filter((message) => !message.includes('ERR_CONNECTION_REFUSED') && !message.includes('Scripts may close only'));
      assert.deepEqual(relevant, [], `页面报错: ${relevant.join('; ')}`);
    } finally {
      await browser.close();
    }

    const code = await Promise.race([
      server.exit,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`CLI 未退出:\n${server.stderr()}`)), 30000)),
    ]);
    const raw = server.stdout().trim();
    assert.equal(code, 0, `CLI 退出码 ${code}:\n${server.stderr()}`);
    const result = JSON.parse(raw);
    assert.equal(result.schema_version, 1);
    assert.equal(result.status, 'submitted');
    assert.equal(result.verdict, 'request-changes');
    assert.equal(result.summary, 'e2e：改成参数化查询');
    assert.deepEqual(result.comments, []);
    assert.equal(result.revision.id, 'patch');
    assert.deepEqual(Object.keys(result.revision).sort(), ['base', 'head', 'id']);
    assert.match(raw, /^\{"schema_version":1,/, 'stdout 必须从 JSON 开头');
    console.log('ok review submit menu → JSON', JSON.stringify({ status: result.status, verdict: result.verdict }));
  } catch (error) {
    console.error('--- stderr ---\n' + server.stderr());
    console.error('--- stdout ---\n' + server.stdout());
    throw error;
  } finally {
    if (server.child.exitCode === null) server.child.kill('SIGTERM');
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
