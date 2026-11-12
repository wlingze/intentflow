export interface PanelPrefs {
  files: boolean;
  right: boolean;
  wrap: boolean;
}

// v2 resets the old default that opened the Review panel on first load.
const KEY = 'intentflow.prefs-2';
const LEGACY_KEY = 'intentflow.prefs';

const DEFAULTS: PanelPrefs = { files: true, right: false, wrap: false };

function parse(raw: string | null): Partial<PanelPrefs> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Partial<PanelPrefs>;
  } catch {
    return {};
  }
}

export function loadPrefs(): PanelPrefs {
  try {
    const current = localStorage.getItem(KEY);
    if (current) {
      const parsed = parse(current);
      return {
        files: typeof parsed.files === 'boolean' ? parsed.files : DEFAULTS.files,
        right: typeof parsed.right === 'boolean' ? parsed.right : DEFAULTS.right,
        wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : DEFAULTS.wrap,
      };
    }
    // Keep the old file/wrap choices once, but force the new closed default.
    const legacy = parse(localStorage.getItem(LEGACY_KEY));
    return {
      files: typeof legacy.files === 'boolean' ? legacy.files : DEFAULTS.files,
      right: false,
      wrap: typeof legacy.wrap === 'boolean' ? legacy.wrap : DEFAULTS.wrap,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePrefs(prefs: PanelPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    // 隐私模式 / 配额满时静默降级。
  }
}
