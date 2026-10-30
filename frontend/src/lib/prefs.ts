export interface PanelPrefs {
  files: boolean;
  graph: boolean;
  wrap: boolean;
}

const KEY = 'intentflow.prefs';

const DEFAULTS: PanelPrefs = { files: true, graph: true, wrap: false };

export function loadPrefs(): PanelPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<PanelPrefs>;
    return {
      files: typeof parsed.files === 'boolean' ? parsed.files : DEFAULTS.files,
      graph: typeof parsed.graph === 'boolean' ? parsed.graph : DEFAULTS.graph,
      wrap: typeof parsed.wrap === 'boolean' ? parsed.wrap : DEFAULTS.wrap,
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
