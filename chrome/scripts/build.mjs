import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const dist = new URL('../dist/', import.meta.url).pathname;
const jsPath = join(dist, 'app.js');
function findCss(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) { const found = findCss(path); if (found) return found; }
    else if (name.endsWith('.css')) return path;
  }
  return null;
}
const cssPath = findCss(dist);
if (!cssPath) throw new Error('vite build did not emit css');

let css = readFileSync(cssPath, 'utf8');
css = css
  .replace(/:root/g, ':host')
  .replace(/\[data-theme="light"\]/g, ':host([data-theme="light"])')
  .replace(/html,\s*body,\s*#root/g, '#root')
  .replace(/\bhtml\s*\{/g, ':host {')
  .replace(/\bbody\s*\{/g, '#root {')
  .replace(/\[data-theme="light"\]\s*#root/g, '[data-theme="light"] #root');
css = `:host { display:block; height:100%; color:var(--ink); font:13px/1.5 var(--sans); }\n#root { height:100%; overflow:hidden; }\n${css}`;

const js = readFileSync(jsPath, 'utf8');
if (!js.includes('__INTENTFLOW_CSS__')) throw new Error('css placeholder missing');
const body = js.replace('__INTENTFLOW_CSS__', JSON.stringify(css));
const header = `// ==UserScript==
// @name         intentflow PR review
// @namespace    https://github.com/wlingze/intentflow
// @version      0.2.0
// @description  在 GitHub PR 页面打开 intentflow，diff 在浏览器本地解析，评论走登录会话提交。
// @match        https://github.com/*/*/pull/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setClipboard
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @connect      api.github.com
// @connect      github.com
// @connect      patch-diff.githubusercontent.com
// @run-at       document-idle
// ==/UserScript==

`;
writeFileSync(join(dist, 'intentflow.user.js'), header + body);
console.log('wrote', join(dist, 'intentflow.user.js'));
