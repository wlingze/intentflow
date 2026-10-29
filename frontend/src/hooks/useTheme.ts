import { useEffect, useState } from 'react';

export type ThemePref = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

const KEY = 'intentflow-ui-theme';
const PREFS: ThemePref[] = ['system', 'light', 'dark'];

function readPref(): ThemePref {
  const stored = localStorage.getItem(KEY);
  return PREFS.includes(stored as ThemePref) ? (stored as ThemePref) : 'system';
}

function resolve(pref: ThemePref): ResolvedTheme {
  if (pref !== 'system') return pref;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function useTheme() {
  const [pref, setPrefState] = useState<ThemePref>(readPref);
  const [theme, setTheme] = useState<ResolvedTheme>(() => resolve(readPref()));

  useEffect(() => {
    const next = resolve(pref);
    setTheme(next);
    document.documentElement.dataset.pref = pref;
    document.documentElement.dataset.theme = next;
    localStorage.setItem(KEY, pref);
  }, [pref]);

  useEffect(() => {
    if (pref !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const onChange = () => {
      const next = resolve('system');
      setTheme(next);
      document.documentElement.dataset.theme = next;
    };
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [pref]);

  return {
    pref,
    theme,
    setPref: setPrefState,
  };
}
