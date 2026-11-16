#!/usr/bin/env node
/**
 * Zero-dependency checks for website/.
 *
 * Run: node scripts/check-site.mjs   (or: make site-check)
 *
 * Guards what is easy to break by hand:
 *   1. every required file exists, and .nojekyll is allowed to be empty
 *   2. every screenshot stays under 600KB
 *   3. relative links and url() resolve inside website/; no absolute paths
 *   4. the only external links are GitHub ones, and no external resource loads
 *   5. every data-i18n key exists in both dictionaries, and the key sets match
 *   6. the English text in the HTML equals the English dictionary value
 *   7. every app.js key is used by a page, so the dictionaries stay small
 *   8. theme-init.js loads before the first stylesheet
 *   9. 404.html stays self-contained, because GitHub Pages serves it at any depth
 *  10. index.html has the four pillars, each with a heading and a screenshot
 *  11. docs.html has a sidebar whose anchors and the body ids match both ways
 *  12. the sidebar script exists: IntersectionObserver scroll-spy in app.js
 *  13. no copy claims "the whole repository", because the panel only sees the
 *      changed files of the current comparison
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const site = join(resolve(here, '..'), 'website');

// 404.html is served for every missing path, so it carries its own styles and
// its own dictionary, and it may only use absolute links.
const pages = ['index.html', 'docs.html'];
const standalone = ['404.html'];
const styles = ['assets/tokens.css', 'assets/base.css', 'assets/style.css'];
const required = [
  'index.html',
  'docs.html',
  '404.html',
  '.nojekyll',
  'README.md',
  'assets/app.js',
  'assets/theme-init.js',
  ...styles,
];
const imageBudget = 600 * 1024;
const allowedHosts = new Set(['github.com', 'www.github.com', 'wlingze.github.io']);

const problems = [];
const fail = (message) => problems.push(message);

const read = (file) => readFileSync(join(site, file), 'utf8');
const exists = (file) => existsSync(join(site, file));

// ── 1. Required files ────────────────────────────────────────────────

for (const file of new Set(required)) {
  if (!exists(file)) {
    fail(`missing file: website/${file}`);
    continue;
  }
  if (file !== '.nojekyll' && statSync(join(site, file)).size === 0) fail(`empty file: website/${file}`);
}

const pageSources = new Map(pages.filter(exists).map((page) => [page, read(page)]));

// ── 2. Screenshot budget ─────────────────────────────────────────────

const imgDir = join(site, 'assets/img');
if (existsSync(imgDir)) {
  for (const file of readdirSync(imgDir)) {
    const size = statSync(join(imgDir, file)).size;
    if (size > imageBudget) fail(`assets/img/${file} is ${Math.round(size / 1024)}KB, over the 600KB budget`);
  }
} else {
  fail('missing directory: website/assets/img');
}

// ── 3 and 4. Links and resources ─────────────────────────────────────

function checkTarget(value, from, isLink) {
  const clean = value.split('#')[0].split('?')[0].trim();
  if (!clean || clean.startsWith('data:')) return;
  if (/^(mailto|tel):/i.test(clean)) return;

  if (clean.startsWith('/')) {
    fail(`${from}: absolute path "${value}" breaks the /intentflow/ subpath`);
    return;
  }

  if (/^https?:\/\//i.test(clean)) {
    if (!isLink) {
      fail(`${from}: external resource "${value}"`);
      return;
    }
    let host = '';
    try {
      host = new URL(clean).hostname;
    } catch {
      fail(`${from}: unparsable URL "${value}"`);
      return;
    }
    if (!allowedHosts.has(host)) fail(`${from}: non-GitHub link "${value}"`);
    return;
  }

  const target = resolve(dirname(join(site, from)), clean);
  if (target !== site && !target.startsWith(site + sep)) {
    fail(`${from}: "${value}" points outside website/`);
    return;
  }
  if (!existsSync(target)) fail(`${from}: broken relative path "${value}"`);
}

for (const [page, source] of pageSources) {
  for (const match of source.matchAll(/\b(href|src)\s*=\s*"([^"]*)"/gi)) {
    checkTarget(match[2], page, match[1].toLowerCase() === 'href');
  }
  // No inline event handlers: behaviour lives in app.js.
  if (/\son[a-z]+\s*=/i.test(source)) fail(`${page}: inline event handler found`);
  if (!/<html[^>]*\blang=/i.test(source)) fail(`${page}: <html> has no lang attribute`);

  // Every copy button must point at an element on its own page.
  for (const match of source.matchAll(/data-copy="([^"]+)"/g)) {
    if (!new RegExp(`\\bid="${match[1]}"`).test(source)) {
      fail(`${page}: data-copy="${match[1]}" has no matching element`);
    }
  }
}

for (const style of styles) {
  if (!exists(style)) continue;
  for (const match of read(style).matchAll(/url\(\s*['"]?([^'")]+)/g)) {
    checkTarget(match[1], style, false);
  }
}

// ── 9. The standalone 404 page ───────────────────────────────────────

if (exists('404.html')) {
  const source = read('404.html');
  if (/<link[^>]+rel="stylesheet"/i.test(source)) fail('404.html: must stay self-contained (no stylesheet)');
  if (/<script[^>]+\bsrc=/i.test(source)) fail('404.html: must stay self-contained (no external script)');
  if (/<img\s/i.test(source)) fail('404.html: must stay self-contained (no image)');
  if (/(href|src)\s*=\s*"(\.\/|\.\.\/)/i.test(source)) fail('404.html: relative link breaks at a deep missing path');
  if (!/<html[^>]*\blang=/i.test(source)) fail('404.html: <html> has no lang attribute');

  const own = { en: dictionary(source, 'en', '404.html'), zh: dictionary(source, 'zh', '404.html') };
  compareDictionaries(own.en, own.zh, '404.html');
  checkPageKeys(source, own.en, '404.html');
  checkFallbackText(source, own.en, '404.html');
}

// ── 5, 6 and 7. The shared dictionaries ──────────────────────────────

if (!exists('assets/app.js')) {
  report();
} else {
  const app = read('assets/app.js');
  const dicts = { en: dictionary(app, 'en', 'app.js'), zh: dictionary(app, 'zh', 'app.js') };
  compareDictionaries(dicts.en, dicts.zh, 'app.js');

  // Keys the script reads itself, for example the theme button label.
  const used = new Set([...app.matchAll(/\[['"]([^'"]+)['"]\]/g)].map((match) => match[1]));
  for (const [page, source] of pageSources) {
    checkPageKeys(source, dicts.en, page, dicts.zh);
    for (const match of source.matchAll(/data-i18n(?:-alt|-label|-content)?="([^"]+)"/g)) used.add(match[1]);
    checkFallbackText(source, dicts.en, page);
  }
  for (const key of dicts.en.keys()) {
    if (!used.has(key)) fail(`app.js: key "${key}" is not used by any page`);
  }
}

// ── 8. Script order and palette wiring ───────────────────────────────

for (const [page, source] of pageSources) {
  const theme = source.indexOf('assets/theme-init.js');
  const firstStyle = source.search(/<link[^>]+rel="stylesheet"/i);
  if (theme < 0) fail(`${page}: theme-init.js is not loaded`);
  else if (firstStyle >= 0 && theme > firstStyle) fail(`${page}: theme-init.js must load before the first stylesheet`);
  if (!source.includes('assets/app.js')) fail(`${page}: app.js is not loaded`);
}

if (exists('assets/tokens.css')) {
  const tokens = read('assets/tokens.css');
  for (const selector of [':root', ':root[data-theme="light"]']) {
    if (!tokens.includes(selector)) fail(`assets/tokens.css: missing ${selector} palette`);
  }
}

// ── 10. The four pillars on the home page ────────────────────────────

const pillars = [
  { id: 'copy', shot: 'workbench-export.png' },
  { id: 'git', shot: 'workbench-diff.png' },
  { id: 'local', shot: 'workbench-review.png' },
  { id: 'symbols', shot: 'workbench-overview.png' },
];

if (pageSources.has('index.html')) {
  const home = pageSources.get('index.html');
  for (const pillar of pillars) {
    const block = sectionById(home, pillar.id);
    if (!block) {
      fail(`index.html: the "${pillar.id}" pillar section is missing`);
      continue;
    }
    if (!/class="[^"]*\bpillar\b/.test(block)) fail(`index.html: #${pillar.id} is not a pillar block`);
    if (!/<h[12]\b[^>]*\bdata-i18n="[^"]+"/i.test(block)) {
      fail(`index.html: #${pillar.id} has no translated heading`);
    }
    if (!block.includes(pillar.shot)) {
      fail(`index.html: #${pillar.id} does not show assets/img/${pillar.shot}`);
    }
    const numbered = /class="pillar__num"[^>]*>\s*0[1-4]\s*</.test(block);
    if (!numbered) fail(`index.html: #${pillar.id} has no 01-04 number`);
  }
}

// ── 11. The docs sidebar and the body ids ────────────────────────────

if (pageSources.has('docs.html')) {
  const docs = pageSources.get('docs.html');
  const nav = sectionByAttribute(docs, 'data-docnav-panel');
  if (!nav) {
    fail('docs.html: the sidebar nav (data-docnav-panel) is missing');
  } else {
    const navIds = [...nav.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
    const bodyIds = [...docs.matchAll(/(?:<h[23]|<section)\b[^>]*\bid="([^"]+)"/g)].map((match) => match[1]);

    if (!navIds.length) fail('docs.html: the sidebar has no in-page links');
    for (const id of navIds) {
      if (!new RegExp(`\\bid="${id}"`).test(docs)) fail(`docs.html: sidebar links to #${id}, but no element has that id`);
    }
    for (const id of bodyIds) {
      if (!navIds.includes(id)) fail(`docs.html: #${id} is not listed in the sidebar`);
    }
    if ([...docs.matchAll(/class="toc"/g)].length) fail('docs.html: the old horizontal table of contents is still there');
  }

  if (!/data-docnav-toggle/.test(docs)) fail('docs.html: the narrow-screen contents button is missing');
  if (!/aria-expanded="false"/.test(docs)) fail('docs.html: the contents button has no aria-expanded');
}

// ── 12. The scroll-spy implementation ───────────────────────────────

if (exists('assets/app.js')) {
  const app = read('assets/app.js');
  for (const [needle, label] of [
    ['data-docnav-panel', 'sidebar lookup'],
    ['new IntersectionObserver', 'scroll-spy observer'],
    ['.observe(', 'observed headings'],
    ['aria-current', 'current-section marker'],
    ['Escape', 'overlay escape key'],
  ]) {
    if (!app.includes(needle)) fail(`assets/app.js: the sidebar script has no ${label} (${needle})`);
  }
}

// ── 13. No claim that the symbol panel covers the whole repository ────

if (exists('assets/app.js')) {
  const source = read('assets/app.js');
  const banned = ['全仓', '整个仓库', 'entire repository', 'whole repository'];
  for (const lang of ['en', 'zh']) {
    for (const [key, value] of dictionary(source, lang, 'app.js')) {
      for (const word of banned) {
        if (value.includes(word)) {
          fail(`app.js: ${lang} value of "${key}" claims more coverage than the tool has (${word})`);
        }
      }
    }
  }
}

report();

// sectionById returns the markup of the element with that id, up to the next
// section or footer. It is deliberately crude: enough to prove a block exists
// and contains what it should.
function sectionById(html, id) {
  return sectionByAttribute(html, `id="${id}"`);
}

function sectionByAttribute(html, attribute) {
  const start = html.indexOf(attribute);
  if (start < 0) return '';
  const open = html.lastIndexOf('<', start);
  const tag = /^<([a-z0-9]+)/i.exec(html.slice(open));
  if (!tag) return '';
  const close = html.indexOf(`</${tag[1]}>`, start);
  return html.slice(open, close < 0 ? html.length : close + tag[1].length + 3);
}

// ── Helpers ──────────────────────────────────────────────────────────

/**
 * dictionary reads "key": "value" lines out of one language block.
 * Values are single-line by construction: an embedded brace is an error.
 */
function dictionary(source, lang, label) {
  const entries = new Map();
  const marker = new RegExp(`\\b${lang}\\s*:\\s*\\{`).exec(source);
  if (!marker) {
    fail(`${label}: no ${lang} dictionary`);
    return entries;
  }

  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', marker.index); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    else if (source[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) {
    fail(`${label}: the ${lang} dictionary is not closed`);
    return entries;
  }

  for (const line of source.slice(marker.index, end).split('\n')) {
    const match = /^\s*'([^']+)':\s*'((?:[^'\\]|\\.)*)',?\s*$/.exec(line);
    if (!match) continue;
    if (/[{}]/.test(match[2])) {
      fail(`${label}: braces inside ${lang} value "${match[1]}"`);
      continue;
    }
    entries.set(match[1], unescapeJs(match[2]));
  }
  if (entries.size === 0) fail(`${label}: the ${lang} dictionary has no readable entries`);
  return entries;
}

function compareDictionaries(en, zh, label) {
  for (const [key, value] of zh) {
    if (!en.has(key)) fail(`${label}: zh key "${key}" has no English counterpart`);
    if (!value.trim()) fail(`${label}: zh value for "${key}" is empty`);
  }
  for (const [key, value] of en) {
    if (!zh.has(key)) fail(`${label}: en key "${key}" has no Chinese counterpart`);
    if (!value.trim()) fail(`${label}: en value for "${key}" is empty`);
  }
}

function checkPageKeys(source, en, page, zh = en) {
  for (const match of source.matchAll(/data-i18n(?:-alt|-label|-content)?="([^"]+)"/g)) {
    const key = match[1];
    if (!en.has(key)) fail(`${page}: data-i18n key "${key}" is missing from the en dictionary`);
    if (!zh.has(key)) fail(`${page}: data-i18n key "${key}" is missing from the zh dictionary`);
  }
}

/** checkFallbackText: the HTML text is what a visitor without scripting sees. */
function checkFallbackText(source, en, page) {
  for (const match of source.matchAll(/<([a-z0-9]+)\b[^>]*\bdata-i18n="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/gi)) {
    const [, , key, inner] = match;
    if (inner.includes('<')) continue;
    if (normalize(decodeEntities(inner)) !== normalize(en.get(key) || '')) {
      fail(`${page}: text for "${key}" differs from the en dictionary`);
    }
  }
}

function unescapeJs(text) {
  const simple = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0' };
  return text.replace(/\\(u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, (all, code) => {
    if (code.length === 1) {
      return Object.prototype.hasOwnProperty.call(simple, code) ? simple[code] : code;
    }
    return String.fromCodePoint(parseInt(code.slice(1), 16));
  });
}

function decodeEntities(text) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (all, body) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : all;
    }
    return Object.prototype.hasOwnProperty.call(named, body) ? named[body] : all;
  });
}

function normalize(text) {
  return text.replace(/\s+/g, ' ').trim();
}

function report() {
  if (problems.length) {
    console.error(`check-site: ${problems.length} problem(s)`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }
  const images = existsSync(imgDir) ? readdirSync(imgDir).length : 0;
  console.log(`check-site: website/ ok — ${pageSources.size} pages, ${images} images, i18n keys in parity`);
}