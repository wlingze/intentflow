import { describe, expect, it } from 'vitest';
import { groupTotals, kindLabel, snippet } from './searchHits';
import type { SearchHit } from './searchDiff';

function hit(overrides: Partial<SearchHit> = {}): SearchHit {
  return { path: 'a.go', side: 'after', line: 3, text: 'func main() {', start: 0, end: 4, kind: 'equal', ...overrides };
}

describe('search hit display', () => {
  it('labels the three diff kinds', () => {
    expect(kindLabel('equal')).toBe('上下文');
    expect(kindLabel('add')).toBe('新增');
    expect(kindLabel('del')).toBe('删除');
  });

  it('windows long lines around the match', () => {
    const result = snippet(hit({ text: `${'x'.repeat(80)}needle${'y'.repeat(200)}`, start: 80, end: 86 }));
    expect(result.before.length).toBeLessThanOrEqual(37);
    expect(result.before.startsWith('…')).toBe(true);
    expect(result.match).toBe('needle');
    expect(result.after.endsWith('…')).toBe(true);
  });

  it('counts hits per file', () => {
    const totals = groupTotals([hit(), hit({ line: 4 }), hit({ path: 'b.go' })]);
    expect(totals.get('a.go')).toBe(2);
    expect(totals.get('b.go')).toBe(1);
  });
});
