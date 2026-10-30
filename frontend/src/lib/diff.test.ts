import { describe, expect, it } from 'vitest';
import { diffLines, diffStats, type DiffRow } from './diff';

function text(lines: string[]): string {
  return lines.join('\n');
}

function numbered(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

function equalAt(rows: DiffRow[], aLine: number): DiffRow | undefined {
  return rows.find((row) => row.type === 'equal' && row.a.n === aLine);
}

describe('diffLines', () => {
  it('handles empty inputs', () => {
    expect(diffLines('', 'new')).toEqual([{ type: 'add', b: { n: 1, text: 'new' } }]);
    expect(diffLines('old', '')).toEqual([{ type: 'del', a: { n: 1, text: 'old' } }]);
    expect(diffLines('', '')).toEqual([]);
  });

  it('finds one insertion in 20,000 unchanged lines', () => {
    const before = numbered(20_000);
    const after = [...before.slice(0, 40), 'inserted line', ...before.slice(40)];

    const rows = diffLines(text(before), text(after));

    expect(diffStats(rows)).toEqual({ adds: 1, dels: 0 });
    const last = rows[rows.length - 1];
    expect(last.type).toBe('equal');
    if (last.type === 'equal') {
      expect(last.a.n).toBe(20_000);
      expect(last.b.n).toBe(20_001);
    }
  });

  it('keeps line alignment after a deletion and an insertion', () => {
    const before = numbered(8_000);
    const after = [...before];
    after.splice(6_999, 1);
    after.splice(99, 0, 'inserted line');

    const rows = diffLines(text(before), text(after));

    expect(diffStats(rows)).toEqual({ adds: 1, dels: 1 });
    const row = equalAt(rows, 4_000);
    expect(row?.type).toBe('equal');
    if (row?.type === 'equal') expect(row.b.n).toBe(4_001);
  });

  it('counts 50 scattered replacements exactly', () => {
    const before = numbered(20_000);
    const after = [...before];
    for (let edit = 0; edit < 50; edit++) {
      const index = 200 + edit * 400;
      after[index] = `edited line ${index + 1}`;
    }

    const rows = diffLines(text(before), text(after));

    expect(diffStats(rows)).toEqual({ adds: 50, dels: 50 });
  });

  it('diffs two 20,000-line files with 200 edits quickly', () => {
    const before = numbered(20_000);
    const after = [...before];
    for (let edit = 0; edit < 200; edit++) {
      const index = 50 + edit * 97;
      after[index] = `edited line ${index + 1}`;
    }

    const started = performance.now();
    const rows = diffLines(text(before), text(after));
    const elapsed = performance.now() - started;

    expect(diffStats(rows)).toEqual({ adds: 200, dels: 200 });
    expect(elapsed).toBeLessThan(400);
  });

  it('marks identical inputs as all equal', () => {
    const lines = numbered(20_000);
    const rows = diffLines(text(lines), text(lines));

    expect(rows).toHaveLength(20_000);
    expect(rows.every((row) => row.type === 'equal')).toBe(true);
    expect(diffStats(rows)).toEqual({ adds: 0, dels: 0 });
  });
});
