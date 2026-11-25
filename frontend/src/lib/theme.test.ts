import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyTheme, loadThemeMode, resolveTheme, saveThemeMode, themeLabel } from './theme';

function storage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe('theme preference', () => {
  it('defaults to the system mode', () => {
    vi.stubGlobal('localStorage', storage());
    expect(loadThemeMode()).toBe('system');
    expect(themeLabel('system')).toBe('跟随系统');
  });

  it('keeps only known modes', () => {
    vi.stubGlobal('localStorage', storage({ 'intentflow.theme': 'dark' }));
    expect(loadThemeMode()).toBe('dark');
    saveThemeMode('light');
    expect(loadThemeMode()).toBe('light');
    vi.stubGlobal('localStorage', storage({ 'intentflow.theme': 'sepia' }));
    expect(loadThemeMode()).toBe('system');
  });

  it('resolves the system preference from the media query', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
    expect(resolveTheme('system')).toBe('light');
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(resolveTheme('system')).toBe('dark');
    expect(resolveTheme('light')).toBe('light');
    expect(resolveTheme('dark')).toBe('dark');
  });

  it('writes the resolved theme on the style root', () => {
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    const target = { dataset: {} as Record<string, string>, style: {} as Record<string, string> } as unknown as HTMLElement;
    expect(applyTheme(target, 'light')).toBe('light');
    expect(target.dataset.theme).toBe('light');
    expect(target.style.colorScheme).toBe('light');
    expect(applyTheme(target, 'system')).toBe('dark');
    expect(target.dataset.theme).toBe('dark');
  });
});
