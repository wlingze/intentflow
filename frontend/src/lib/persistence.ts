import type { PersistedReview } from '../types';

const PREFIX = 'intentflow.review:';

export function reviewStorageKey(before: string, after: string): string {
  return `${PREFIX}${before}->${after}`;
}

export function loadPersisted(key: string): PersistedReview | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PersistedReview>;
    return {
      comments: Array.isArray(parsed.comments) ? parsed.comments : [],
      dismissed: Array.isArray(parsed.dismissed) ? parsed.dismissed : [],
      kept: Array.isArray(parsed.kept) ? parsed.kept : [],
    };
  } catch {
    return null;
  }
}

export function savePersisted(key: string, value: PersistedReview): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 隐私模式 / 配额满时静默降级。
  }
}
