import { describe, expect, it } from 'vitest';
import { diffLines } from './diff';
import { buildHunks } from './hunks';
import { diffSections, growExpansion, splitPairs } from './diffSections';

/** Two changes far apart: one middle gap, plus leading and trailing gaps. */
const lines = Array.from({ length: 30 }, (_, index) => `line ${index + 1}`);
const after = [...lines];
after[3] = 'line 4 changed';
after[24] = 'line 25 changed';
const rows = diffLines(lines.join('\n'), after.join('\n'));
const hunks = buildHunks(rows, { context: 2 });
const middleGap = (expanded: Record<number, { top: number; bottom: number }> = {}) =>
  diffSections(rows, hunks, expanded).find(
    (section) => section.type === 'gap' && !section.leading && !section.trailing,
  );

describe('diffSections', () => {
  it('keeps every row exactly once', () => {
    const sections = diffSections(rows, hunks, {});
    const covered = sections.reduce((sum, section) => sum + (section.end - section.start), 0);
    expect(covered).toBe(rows.length);
    expect(sections.filter((section) => section.type === 'gap')).toHaveLength(3);
  });

  it('reveals five lines per click and clamps at the gap ends', () => {
    const gap = middleGap()!;
    const opened = middleGap({ [gap.key]: { top: 5, bottom: 0 } })!;
    expect(opened.start).toBe(gap.start + 5);
    expect(opened.end).toBe(gap.end);
    const all = middleGap({ [gap.key]: { top: gap.end - gap.start, bottom: 0 } });
    expect(all).toBeUndefined();
  });

  it('expands the two ends independently', () => {
    const gap = middleGap()!;
    expect(middleGap({ [gap.key]: { top: 3, bottom: 0 } })!.start).toBe(gap.start + 3);
    expect(middleGap({ [gap.key]: { top: 0, bottom: 4 } })!.end).toBe(gap.end - 4);
    const both = middleGap({ [gap.key]: { top: 3, bottom: 4 } })!;
    expect(both.start).toBe(gap.start + 3);
    expect(both.end).toBe(gap.end - 4);
  });

  it('marks whether a gap touches the file edges', () => {
    const gaps = diffSections(rows, hunks, {}).filter((section) => section.type === 'gap');
    expect(gaps[0].leading).toBe(true);
    expect(gaps.at(-1)!.trailing).toBe(true);
    expect(gaps.filter((section) => !section.leading && !section.trailing)).toHaveLength(1);
  });
});

describe('splitPairs', () => {
  it('pairs a replacement block row by row', () => {
    const pairs = splitPairs(diffLines('a\nb\nc', 'a\nX\nY\nc'));
    expect(pairs.map((pair) => [pair.left?.text, pair.right?.text])).toEqual([
      ['a', 'a'],
      ['b', 'X'],
      [undefined, 'Y'],
      ['c', 'c'],
    ]);
    expect(pairs[1].changed).toBe(true);
    expect(pairs[0].changed).toBe(false);
  });

  it('leaves the shorter side empty', () => {
    const pairs = splitPairs(diffLines('a\nb', 'a\nb\nc'));
    expect(pairs.map((pair) => [pair.left?.text, pair.right?.text])).toEqual([
      ['a', 'a'],
      ['b', 'b'],
      [undefined, 'c'],
    ]);
  });

  it('keeps revealing until the gap closes', () => {
    // 交替从两端展开：剩下最后 5 行时，再点一次仍必须能展开。
    const gap = middleGap()!;
    const length = gap.end - gap.start;
    const openAllButFive = { top: Math.floor((length - 5) / 2), bottom: Math.ceil((length - 5) / 2) };
    const left = middleGap({ [gap.key]: openAllButFive })!;
    expect(left.end - left.start).toBe(5);
    const next = growExpansion(left, openAllButFive, 'top');
    expect(next).not.toBeNull();
    expect(middleGap({ [gap.key]: next! })).toBeUndefined();
  });
});
