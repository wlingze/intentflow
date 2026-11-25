import { mountWorkbench } from '../../frontend/src/workbench';
import { parsePrUrl } from './github.js';
import { createPrSource } from './prSource.js';

const FRAGMENT = '#intentflow';
const LAUNCHER = 'intentflow-launch';
let active = null;

function closeWorkbench() {
  if (!active) return;
  active.root.unmount();
  active.dialog.close();
  active.host.remove();
  active = null;
}

function showWorkbench(pr, key) {
  const host = document.createElement('div');
  host.id = 'intentflow-userscript-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = __INTENTFLOW_CSS__;
  const dialog = document.createElement('dialog');
  dialog.setAttribute('aria-label', 'intentflow 工作台');
  dialog.style.cssText = 'position:fixed;inset:0;margin:0;border:0;padding:0;width:100%;height:100%;max-width:none;max-height:none;overflow:hidden;background:var(--bg);';
  // Esc 仍由搜索框、菜单、抽屉等工作台组件处理；浏览器后退负责退出。
  dialog.addEventListener('cancel', (event) => event.preventDefault());
  const container = document.createElement('div');
  container.id = 'root';
  dialog.append(container);
  shadow.append(style, dialog);
  document.body.append(host);
  dialog.showModal();
  active = { key, host, dialog, root: mountWorkbench(container, createPrSource(pr)) };
}

function addLauncher() {
  if (document.getElementById(LAUNCHER)) return;
  const link = document.createElement('a');
  link.id = LAUNCHER;
  link.href = FRAGMENT;
  link.textContent = 'intentflow';
  link.title = '打开 intentflow 工作台（浏览器后退返回 GitHub）';
  link.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147482000;padding:8px 13px;border:1px solid ButtonBorder;border-radius:18px;background:ButtonFace;color:ButtonText;font:600 12px/18px system-ui;text-decoration:none;';
  document.body.append(link);
}

function syncPage() {
  const pr = parsePrUrl();
  const key = pr && `${pr.owner}/${pr.repo}#${pr.number}`;
  const open = !!pr && location.hash === FRAGMENT;
  if (active && (!open || active.key !== key || !active.host.isConnected)) closeWorkbench();
  if (pr) addLauncher();
  else document.getElementById(LAUNCHER)?.remove();
  if (open && !active) showWorkbench(pr, key);
}

if (typeof GM_registerMenuCommand === 'function') {
  GM_registerMenuCommand('打开 / 关闭 intentflow', () => {
    if (!parsePrUrl()) return;
    if (location.hash === FRAGMENT) {
      // 直接打开带片段的链接时也能退出，不依赖上一页存在。
      history.replaceState(history.state, '', location.pathname + location.search);
      syncPage();
    } else location.hash = FRAGMENT;
  });
}

// 清理旧版扩展存储，不读取值。
if (typeof GM_deleteValue === 'function') {
  try { GM_deleteValue('intentflow.github.token'); } catch { /* 存储不可用 */ }
}

window.addEventListener('hashchange', syncPage);
window.addEventListener('popstate', syncPage);
window.addEventListener('turbo:load', syncPage);
document.addEventListener('turbo:before-cache', closeWorkbench);
setInterval(syncPage, 2000); // GitHub 客户端导航不保证触发 turbo:load。
syncPage();
