// Match flags per surface. The popup and the symbol panel start from different
// defaults and keep independent choices.
export type MatchSurface = 'search' | 'symbol';

export interface MatchPrefs {
  caseSensitive: boolean;
  wholeWord: boolean;
}

const DEFAULTS: Record<MatchSurface, MatchPrefs> = {
  search: { caseSensitive: false, wholeWord: false },
  symbol: { caseSensitive: true, wholeWord: true },
};

function read(key: string): boolean | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : raw === '1';
  } catch {
    return null;
  }
}

function write(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 隐私模式 / 配额满时静默降级。
  }
}

export function loadMatch(surface: MatchSurface): MatchPrefs {
  const fallback = DEFAULTS[surface];
  // Older builds stored one combined "exact" flag; it meant both switches on.
  const legacy = read(`intentflow.${surface}-exact`);
  return {
    caseSensitive: read(`intentflow.${surface}-case`) ?? legacy ?? fallback.caseSensitive,
    wholeWord: read(`intentflow.${surface}-word`) ?? legacy ?? fallback.wholeWord,
  };
}

export function saveMatch(surface: MatchSurface, prefs: MatchPrefs): void {
  write(`intentflow.${surface}-case`, prefs.caseSensitive);
  write(`intentflow.${surface}-word`, prefs.wholeWord);
}
