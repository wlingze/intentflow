export type ThemeMode = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'intentflow.theme';
const MODES: ThemeMode[] = ['system', 'light', 'dark'];

export function loadThemeMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // 隐私模式 / 配额满时按系统主题。
  }
  return 'system';
}

export function saveThemeMode(mode: ThemeMode): void {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    // 存不下就只在本次会话生效。
  }
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode !== 'system') return mode;
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function nextThemeMode(mode: ThemeMode): ThemeMode {
  return MODES[(MODES.indexOf(mode) + 1) % MODES.length];
}

export function themeLabel(mode: ThemeMode): string {
  return mode === 'system' ? '跟随系统' : mode === 'light' ? '浅色' : '深色';
}

// 工作台可能是独立页面，也可能挂在 GitHub 页的 Shadow DOM 里。两种入口都把
// 主题写在承载样式变量的元素上：独立页是 <html>，脚本是 :host。
export function themeTarget(): HTMLElement {
  const host = document.getElementById('intentflow-userscript-root');
  return host ?? document.documentElement;
}

export function applyTheme(target: HTMLElement | null = themeTarget(), mode: ThemeMode = loadThemeMode()): ResolvedTheme {
  const resolved = resolveTheme(mode);
  if (target) {
    target.dataset.theme = resolved;
    target.style.colorScheme = resolved;
  }
  return resolved;
}

export function watchSystemTheme(mode: ThemeMode, apply: () => void): () => void {
  if (mode !== 'system' || typeof window.matchMedia !== 'function') return () => undefined;
  const media = window.matchMedia('(prefers-color-scheme: light)');
  const onChange = () => apply();
  media.addEventListener?.('change', onChange);
  return () => media.removeEventListener?.('change', onChange);
}
