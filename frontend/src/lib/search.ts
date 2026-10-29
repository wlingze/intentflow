import type { CodeFile } from '../types';

export type SearchSide = 'before' | 'after';

export interface SearchHit {
  file: string;
  side: SearchSide;
  line: number;
  text: string;
  start: number;
  end: number;
}

export interface SearchGroup {
  file: string;
  status: CodeFile['status'];
  hits: SearchHit[];
}

/**
 * 在 before / after 两侧做大小写不敏感的子串搜索。
 * 同一行只返回第一次命中，避免结果列表被单行刷屏。
 */
export function searchCode(files: CodeFile[], query: string, limit = 80): SearchGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const groups: SearchGroup[] = [];
  let total = 0;

  for (const file of files) {
    const hits: SearchHit[] = [];
    for (const side of ['before', 'after'] as const) {
      const text = file[side];
      if (!text) continue;
      const lines = text.split('\n');
      for (let index = 0; index < lines.length; index++) {
        const line = lines[index];
        const at = line.toLowerCase().indexOf(needle);
        if (at < 0) continue;
        hits.push({ file: file.path, side, line: index + 1, text: line, start: at, end: at + needle.length });
        total++;
        if (total >= limit) break;
      }
      if (total >= limit) break;
    }
    if (hits.length) groups.push({ file: file.path, status: file.status, hits });
    if (total >= limit) break;
  }

  return groups;
}

export function highlightMatch(text: string, start: number, end: number): string {
  const before = escapeHtml(text.slice(0, start));
  const middle = escapeHtml(text.slice(start, end));
  const after = escapeHtml(text.slice(end));
  return `${before}<mark>${middle}</mark>${after}`;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
