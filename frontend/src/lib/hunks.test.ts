import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';
import { buildHunks } from './hunks';

const CONTEXT = 3;

function lines(count: number, prefix = 'line'): string {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

describe('hunk extraction', () => {
  it('keeps only changed lines plus context', () => {
    const before = lines(200);
    const after = before.split('\n');
    after[99] = 'changed 100';
    const hunks = buildHunks(diffLines(before, after.join('\n')), { context: CONTEXT });
    expect(hunks).toHaveLength(1);
    // 1 改行 = 1 del + 1 add，加上上下各 3 行 context。
    expect(hunks[0].rows).toHaveLength(3 + 2 + 3);
    expect(hunks[0].adds).toBe(1);
    expect(hunks[0].dels).toBe(1);
    expect(hunks[0].gapBefore).toBe(96);
    expect(hunks[0].gapAfter).toBe(97);
  });

  it('merges nearby changes and keeps distant ones apart', () => {
    const before = lines(300);
    const after = before.split('\n');
    after[49] = 'a';
    after[51] = 'b'; // 与上一处间隔 1 行，会被合并
    after[249] = 'c'; // 距离很远，独立成块
    const hunks = buildHunks(diffLines(before, after.join('\n')), { context: CONTEXT });
    expect(hunks).toHaveLength(2);
    expect(hunks[0].adds).toBe(2);
    expect(hunks[1].adds).toBe(1);
  });

  it('returns no hunks for identical input', () => {
    const text = lines(120);
    expect(buildHunks(diffLines(text, text))).toEqual([]);
  });

  it('reports a whole new file as one hunk with no leading gap', () => {
    const after = lines(10, 'new');
    const hunks = buildHunks(diffLines('', after));
    expect(hunks).toHaveLength(1);
    expect(hunks[0].adds).toBe(10);
    expect(hunks[0].gapBefore).toBe(0);
    expect(hunks[0].gapAfter).toBe(0);
  });

  it('splits an oversized hunk so one render stays bounded', () => {
    const before = lines(2000);
    const after = before.split('\n');
    for (let i = 0; i < 1200; i++) after[i] = `rewritten ${i}`;
    const hunks = buildHunks(diffLines(before, after.join('\n')), { context: CONTEXT, maxLines: 400 });
    expect(hunks.length).toBeGreaterThan(1);
    for (const hunk of hunks) expect(hunk.rows.length).toBeLessThanOrEqual(400);
  });

  it('keeps line numbers aligned after a sparse insertion', () => {
    const before = lines(50);
    const after = [...before.split('\n').slice(0, 20), 'inserted', ...before.split('\n').slice(20)];
    const hunks = buildHunks(diffLines(before, after.join('\n')), { context: CONTEXT });
    expect(hunks).toHaveLength(1);
    const added = hunks[0].rows.find((row) => row.type === 'add');
    expect(added && 'b' in added ? added.b.n : null).toBe(21);
    const equalAfter = hunks[0].rows.filter((row) => row.type === 'equal').at(-1);
    expect(equalAfter && 'a' in equalAfter ? equalAfter.a.n : null).toBe(23);
  });
});
