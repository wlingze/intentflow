import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = process.argv[2] ?? fileURLToPath(new URL('../dist/', import.meta.url));
const js = readFileSync(join(dist, 'app.js'), 'utf8');
const css = readFileSync(join(dist, 'assets/app.css'), 'utf8');
if (!js.includes('__INTENTFLOW_CSS__')) throw new Error('构建缺少工作台样式占位符');
const body = js.replace('__INTENTFLOW_CSS__', () => JSON.stringify(css));
const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const header = `// ==UserScript==
// @name         intentflow PR review
// @namespace    https://github.com/wlingze/intentflow
// @version      ${version}
// @description  在 GitHub PR 页面打开 intentflow，diff 在浏览器本地解析，评论走登录会话提交。
// @match        https://github.com/*/*/pull/*
// @grant        GM_xmlhttpRequest
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
