import { createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../../frontend/src/App';
import { AppProvider } from '../../frontend/src/state/AppProvider';
import { buildPayload } from './payload.js';
import { askToken, fetchComments, fetchDiff, fetchPull, importComments, mapReview, parsePrUrl, setToken, submitReview } from './github.js';
import '../../frontend/src/styles/tokens.css';
import '../../frontend/src/styles/global.css';

const APP_CSS = __INTENTFLOW_CSS__;
const HOST_ID = 'intentflow-userscript-root';
const BUTTON_ID = 'intentflow-launch';
const EVENTS = { comment: 'COMMENT', approve: 'APPROVE', 'request-changes': 'REQUEST_CHANGES' };

let mountedRoot = null;
let restoreFetch = null;
let activePayload = null;
let activePr = null;
let busy = false;

function shadowQuery(selector) {
  return document.getElementById(HOST_ID)?.shadowRoot?.querySelector(selector) ?? null;
}

function setStatus(text, kind = '') {
  const node = shadowQuery('[data-if-status]');
  if (!node) return;
  node.textContent = text || '';
  node.dataset.kind = kind;
  node.title = text || '';
}

function button(label, onClick, className = 'if-button') {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  node.textContent = label;
  node.addEventListener('click', onClick);
  return node;
}

function installApi(payload, revisions) {
  const original = window.fetch;
  restoreFetch = () => { window.fetch = original; };
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    if (url.includes('/api/payload.json') || url.endsWith('api/payload.json')) {
      return Promise.resolve(new Response(JSON.stringify(payload), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('/api/revisions.json') || url.endsWith('api/revisions.json')) {
      return Promise.resolve(new Response(JSON.stringify(revisions), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return original.call(window, input, init);
  };
}

function mountApp(root, payload, revisions) {
  installApi(payload, revisions);
  mountedRoot = createRoot(root);
  mountedRoot.render(createElement(StrictMode, null, createElement(AppProvider, null, createElement(App))));
}

function closeOverlay() {
  if (mountedRoot) {
    try { mountedRoot.unmount(); } catch { /* already gone */ }
    mountedRoot = null;
  }
  if (restoreFetch) { restoreFetch(); restoreFetch = null; }
  document.getElementById(HOST_ID)?.remove();
  activePayload = null;
  activePr = null;
  busy = false;
}

function readLocalReview(payload) {
  try {
    const key = `intentflow.review.${payload.session.context.comparison_id}`;
    const raw = localStorage.getItem(key);
    if (!raw) return payload.session;
    const doc = JSON.parse(raw);
    return doc?.version === 1 ? doc : payload.session;
  } catch {
    return payload.session;
  }
}

async function submit(event) {
  if (busy || !activePayload || !activePr) return;
  const select = shadowQuery('[data-if-event]');
  const selected = select?.value || event;
  if (selected !== 'comment' && !window.confirm(selected === 'approve' ? '通过这个 PR？' : '请求修改这个 PR？')) return;
  busy = true;
  const buttons = [...(document.getElementById(HOST_ID)?.shadowRoot?.querySelectorAll('.if-button') || [])];
  buttons.forEach((node) => { node.disabled = true; });
  setStatus('读取本地评论…');
  try {
    await new Promise((resolve) => setTimeout(resolve, 700));
    const doc = readLocalReview(activePayload);
    const diff = await fetchDiff(activePr.owner, activePr.repo, activePr.number);
    const mapped = mapReview(doc, diff);
    if (!mapped.comments.length && !mapped.body) throw new Error('没有可提交的评论（导入了的 gh- 评论不会重复提交）');
    const result = await submitReview(activePr.owner, activePr.repo, activePr.number, {
      body: mapped.body || 'intentflow review',
      event: EVENTS[selected],
      comments: mapped.comments,
    });
    const link = result.html_url ? ` ${result.html_url}` : '';
    setStatus(`已提交 review${mapped.skipped ? `；${mapped.skipped} 条放入正文` : ''}${link}`, 'ok');
    if (result.html_url) window.open(result.html_url, '_blank', 'noopener');
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    busy = false;
    buttons.forEach((node) => { node.disabled = false; });
  }
}

function barElement() {
  const bar = document.createElement('div');
  bar.className = 'if-bar';
  const title = document.createElement('span');
  title.className = 'if-title';
  title.textContent = activePr ? `intentflow · ${activePr.owner}/${activePr.repo}#${activePr.number}` : 'intentflow';
  bar.append(title);

  const event = document.createElement('select');
  event.className = 'if-select';
  event.dataset.ifEvent = '';
  event.innerHTML = '<option value="comment">评论</option><option value="approve">通过</option><option value="request-changes">请求修改</option>';
  bar.append(event);
  bar.append(button('提交到 GitHub', () => void submit(event.value)));
  bar.append(button('刷新', () => { closeOverlay(); setTimeout(() => void openOverlay(), 60); }, 'if-button if-quiet'));
  bar.append(button('token', () => { askToken(true); setStatus('token 已保存'); }, 'if-button if-quiet'));
  const status = document.createElement('span');
  status.className = 'if-status';
  status.dataset.ifStatus = '';
  bar.append(status);
  bar.append(button('×', closeOverlay, 'if-button if-close'));
  return bar;
}

function shellWithBar() {
  const host = document.createElement('div');
  host.id = HOST_ID;
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `${APP_CSS}\n${OVERLAY_CSS}`;
  const shell = document.createElement('div');
  shell.className = 'if-shell';
  shell.append(barElement());
  const body = document.createElement('div');
  body.className = 'if-body';
  const root = document.createElement('div');
  root.id = 'root';
  root.className = 'if-root';
  body.append(root);
  shell.append(body);
  shadow.append(style, shell);
  document.body.append(host);
  return { host, body, root };
}

async function loadData() {
  const pr = parsePrUrl();
  if (!pr) throw new Error('当前页面不是 GitHub PR');
  activePr = pr;
  const [diff, pull, comments] = await Promise.all([
    fetchDiff(pr.owner, pr.repo, pr.number),
    fetchPull(pr.owner, pr.repo, pr.number),
    fetchComments(pr.owner, pr.repo, pr.number),
  ]);
  if (!diff.trim()) throw new Error('PR diff 为空');
  const { parsePatch } = await import('./patch.js');
  const files = parsePatch(diff).files;
  const title = pull.title || document.title.split(' · ')[0] || `PR #${pr.number}`;
  const base = pull.base?.ref || 'base';
  const head = pull.head?.ref || 'head';
  const built = await buildPayload(files, {
    repository: `github.com/${pr.owner}/${pr.repo}`,
    branch: `pull/${pr.number}`,
    before: base,
    after: head,
    baseRef: pull.base?.sha || '',
    headRef: pull.head?.sha || '',
    title,
    note: `GitHub PR #${pr.number}：diff 由浏览器脚本在本地解析；展开的未改区间是空占位行。`,
  });
  const imported = importComments(comments);
  built.payload.session.comments = imported;
  if (imported.length) built.payload.review.notes.push(`已导入 ${imported.length} 条 GitHub review 评论。`);
  return built;
}

async function openOverlay() {
  if (!parsePrUrl()) return;
  if (document.getElementById(HOST_ID)) return;
  const { body, root } = shellWithBar();
  body.innerHTML = '<div class="if-loading">正在读取 PR diff…</div>';
  try {
    const built = await loadData();
    activePayload = built.payload;
    body.innerHTML = '';
    body.append(root);
    mountApp(root, built.payload, built.revisions);
  } catch (error) {
    body.innerHTML = '';
    const message = document.createElement('div');
    message.className = 'if-error';
    message.textContent = error instanceof Error ? error.message : String(error);
    const retry = button('重试', () => { closeOverlay(); setTimeout(() => void openOverlay(), 60); });
    const close = button('关闭', closeOverlay);
    const actions = document.createElement('div');
    actions.className = 'if-error-actions';
    actions.append(retry, close);
    body.append(message, actions);
  }
}

const OVERLAY_CSS = `
  :host { display: block; height: 100%; }
  .if-shell { height: 100%; display: flex; flex-direction: column; background: #080b10; color: #e8eef7; font: 12px/1.4 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
  .if-bar { flex: none; display: flex; align-items: center; gap: 7px; min-height: 36px; padding: 0 10px; background: #0f141c; border-bottom: 1px solid #2a3646; }
  .if-title { font-weight: 650; color: #e8eef7; white-space: nowrap; }
  .if-select { height: 24px; padding: 0 5px; border: 1px solid #2a3646; border-radius: 5px; background: #0b1017; color: #e8eef7; font: inherit; }
  .if-button { height: 24px; padding: 0 8px; border: 1px solid #2a3646; border-radius: 5px; background: #131a24; color: #e8eef7; font: inherit; cursor: pointer; white-space: nowrap; }
  .if-button:hover { border-color: #5a687b; background: #1c2532; }
  .if-button:disabled { opacity: .5; cursor: default; }
  .if-quiet { background: transparent; color: #8a99ad; }
  .if-close { margin-left: 2px; width: 26px; padding: 0; font-size: 16px; line-height: 1; }
  .if-status { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #8a99ad; }
  .if-status[data-kind="ok"] { color: #3ddc97; }
  .if-status[data-kind="error"] { color: #ff6b81; }
  .if-body { flex: 1; min-height: 0; position: relative; }
  .if-root { height: 100%; }
  .if-root > div { height: 100% !important; }
  .if-loading, .if-error { height: 100%; display: grid; place-content: center; padding: 24px; color: #8a99ad; text-align: center; }
  .if-error { color: #ff6b81; max-width: 900px; margin: 0 auto; }
  .if-error-actions { display: flex; gap: 8px; justify-content: center; margin-top: 14px; }
`;

function makeLauncher() {
  let node = document.getElementById(BUTTON_ID);
  if (node) return node;
  node = document.createElement('button');
  node.id = BUTTON_ID;
  node.type = 'button';
  node.textContent = 'intentflow';
  node.title = '打开 intentflow PR review';
  node.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482000;height:34px;padding:0 13px;border:1px solid #2a3646;border-radius:18px;background:#0f141c;color:#e8eef7;font:600 12px ui-sans-serif,system-ui,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.35);cursor:pointer;';
  node.addEventListener('click', () => void openOverlay());
  document.body.append(node);
  return node;
}

function syncLauncher() {
  if (!parsePrUrl()) {
    document.getElementById(BUTTON_ID)?.remove();
    if (document.getElementById(HOST_ID)) closeOverlay();
    return;
  }
  makeLauncher();
}

if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand('设置 GitHub token', () => { askToken(true); });
  GM_registerMenuCommand('清除 GitHub token', () => { setToken(''); });
}

window.addEventListener('turbo:load', syncLauncher);
window.addEventListener('popstate', syncLauncher);
setInterval(syncLauncher, 2000);
syncLauncher();
