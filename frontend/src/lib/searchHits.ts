import type { SearchHit } from './searchDiff';

// Snippet window shared by the global search popup and the symbol panel.
export function snippet(hit: SearchHit) {
  const start = Math.max(0, hit.start - 36);
  const end = Math.min(hit.text.length, hit.end + 96);
  return {
    before: `${start > 0 ? '…' : ''}${hit.text.slice(start, hit.start)}`,
    match: hit.text.slice(hit.start, hit.end),
    after: `${hit.text.slice(hit.end, end)}${end < hit.text.length ? '…' : ''}`,
  };
}

export function kindLabel(kind: SearchHit['kind']): string {
  return kind === 'add' ? '新增' : kind === 'del' ? '删除' : '上下文';
}

export function groupTotals(results: SearchHit[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const hit of results) totals.set(hit.path, (totals.get(hit.path) ?? 0) + 1);
  return totals;
}
