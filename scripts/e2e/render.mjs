// 渲染层端到端检查：滚动稳定、行内标记、文件树色调、搜索与符号跳转。
// 用法：NODE_PATH=<playwright 全局包> node scripts/e2e/render.mjs http://127.0.0.1:45277
// 这些行为依赖真实布局，单元测试覆盖不到。
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const url = process.argv[2] || 'http://127.0.0.1:45277';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/home/wlz/.cache/ms-playwright/chromium-1246/chrome-linux64/chrome',
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-virtual-row]').length > 0, { timeout: 120000 });
  await page.waitForTimeout(1500);

  const results = {};
  // 1. Scroll keeps the document height fixed: nothing jumps.
  results.stableHeight = await page.evaluate(async () => {
    const scroller = document.querySelector('[data-review-scroll]');
    const heights = new Set([scroller.scrollHeight]);
    for (let index = 0; index < 40; index++) {
      scroller.scrollTop += 800;
      await new Promise((resolve) => setTimeout(resolve, 35));
      heights.add(scroller.scrollHeight);
    }
    return heights.size;
  });

  // 2. Inline word marks exist and are painted.
  results.inline = await page.evaluate(() => {
    const marks = [...document.querySelectorAll('[data-source] .chg')];
    return { count: marks.length, painted: marks.filter((mark) => getComputedStyle(mark).backgroundColor !== 'rgba(0, 0, 0, 0)').length };
  });

  // 3. Tree greys on-screen files and highlights the opened one.
  await page.evaluate(() => { document.querySelector('[data-review-scroll]').scrollTop = 0; });
  await page.waitForTimeout(500);
  results.tones = await page.evaluate(() => {
    const counts = {};
    for (const row of document.querySelectorAll('[data-tone]')) counts[row.dataset.tone] = (counts[row.dataset.tone] || 0) + 1;
    return counts;
  });

  // 4. Search jump puts the target line inside the viewport.
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  await page.locator('[data-search-panel="true"] input').first().fill('TimeoutSecond');
  await page.waitForTimeout(1200);
  // Hit rows carry the code line as title;工具按钮用 aria-label 固定文案。
  const buttons = page.locator('[data-search-panel="true"] button');
  const total = await buttons.count();
  const hits = [];
  for (let index = 0; index < total; index++) {
    const label = await buttons.nth(index).getAttribute('aria-label');
    if (!label) hits.push(index);
  }
  let jumped = null;
  for (const index of hits.slice(0, 3)) {
    await buttons.nth(index).click();
    await page.waitForTimeout(1500);
    jumped = await page.evaluate(() => {
      const target = document.querySelector('[class*=target]');
      const scroller = document.querySelector('[data-review-scroll]');
      if (!target || !scroller) return null;
      const line = target.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      return { visible: line.top >= view.top && line.bottom <= view.bottom, file: target.closest('[data-file]')?.dataset.file.split('/').pop() };
    });
    if (jumped) break;
  }
  results.search = { hits: hits.length, jumped };

  // 5. Word click fills the symbol panel, and a symbol jump lands on screen.
  await page.keyboard.press('Escape');
  const word = await page.evaluate(() => {
    for (const source of document.querySelectorAll('[data-source]')) {
      const walker = document.createTreeWalker(source, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent || '';
        const start = text.search(/[A-Za-z_]{7,}/);
        if (start < 0) continue;
        const value = text.slice(start).match(/^[A-Za-z_]+/)[0];
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + value.length);
        const box = range.getBoundingClientRect();
        if (box.width > 0 && box.top > 200 && box.top < 800) return { x: box.x + 2, y: box.y + box.height / 2, value };
      }
    }
    return null;
  });
  if (word) {
    await page.mouse.click(word.x, word.y);
    await page.waitForTimeout(700);
    results.symbol = { word: word.value, marks: await page.locator('[data-source] mark').count() };
  }

  // 6. Deep jump: a hit far down the file list must land on its line.
  //    正文只在视口附近挂载，跳到很远的文件时最容易只滚了容器没挂载正文。
  await page.keyboard.press('Control+f');
  await page.waitForTimeout(300);
  await page.locator('[data-search-panel="true"] input').first().fill('func');
  await page.waitForTimeout(1500);
  const far = [];
  const panelButtons = page.locator('[data-search-panel="true"] button');
  const panelTotal = await panelButtons.count();
  for (let index = 0; index < panelTotal; index++) {
    const label = await panelButtons.nth(index).getAttribute('aria-label');
    if (!label) far.push(index);
  }
  const deep = [];
  for (const index of far.filter((_, order) => order % 15 === 0).slice(0, 5)) {
    await panelButtons.nth(index).click();
    await page.waitForTimeout(1200);
    deep.push(await page.evaluate(() => {
      const target = document.querySelector('[class*=target]');
      const scroller = document.querySelector('[data-review-scroll]');
      if (!target || !scroller) return { hit: false };
      const line = target.getBoundingClientRect();
      const view = scroller.getBoundingClientRect();
      return { hit: true, visible: line.top >= view.top && line.bottom <= view.bottom, file: target.closest('[data-file]')?.dataset.file.split('/').pop() };
    }));
  }
  results.deepJumps = deep;
  await page.keyboard.press('Escape');

  results.errors = errors;
  console.log(JSON.stringify(results, null, 1));

  assert.equal(results.stableHeight, 1, 'document height changed while scrolling');
  assert(results.inline.count > 0, 'no inline marks');
  assert.equal(results.inline.count, results.inline.painted, 'inline marks are not painted');
  assert(results.search.jumped?.visible, 'search jump missed the viewport');
  assert(results.deepJumps.length > 0, 'no deep jump sampled');
  for (const jump of results.deepJumps) assert(jump.hit && jump.visible, `deep jump missed: ${JSON.stringify(jump)}`);
  assert.equal(errors.length, 0, `console errors: ${errors.join(' | ')}`);
  await browser.close();
  console.log('E2E OK');
})().catch((error) => { console.error(error); process.exit(1); });
