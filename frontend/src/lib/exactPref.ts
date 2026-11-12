// The search popup and the symbol panel keep separate exact-match preferences;
// their defaults differ on purpose (popup off, symbols on).
export function loadExact(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : raw === '1';
  } catch {
    return fallback;
  }
}

export function saveExact(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 隐私模式 / 配额满时静默降级。
  }
}
