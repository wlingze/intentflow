import { describe, expect, it } from 'vitest';
import { inlineDiff, inlineMarks } from './inlineDiff';
import { splitPairs } from './diffSections';
import { diffLines } from './diff';

const slice = (text: string, ranges: { start: number; end: number }[]) =>
  ranges.map((range) => text.slice(range.start, range.end));

describe('inlineDiff', () => {
  it('marks only the inserted words', () => {
    const before = 'title: "format string"';
    const after = 'title: "数据流: format string"';
    const ranges = inlineDiff(before, after);
    expect(slice(before, ranges.before)).toEqual([]);
    // The inserted space is dropped: nothing visible changes there.
    expect(slice(after, ranges.after)).toEqual(['数据流:']);
  });

  it('marks only the removed value', () => {
    const before = '  level: high';
    const after = '  level: ';
    const ranges = inlineDiff(before, after);
    expect(slice(before, ranges.before)).toEqual(['high']);
    expect(slice(after, ranges.after)).toEqual([]);
  });

  it('keeps marks narrow when one token is very long', () => {
    const before = `func ${'a'.repeat(400)}OldName() {}`;
    const after = `func ${'a'.repeat(400)}NewName() {}`;
    const ranges = inlineDiff(before, after);
    const marked = [...slice(before, ranges.before), ...slice(after, ranges.after)];
    expect(marked.length).toBe(2);
    for (const text of marked) expect(text.length).toBeLessThan(10);
    expect(slice(after, ranges.after)[0].length).toBeGreaterThan(0);
  });

  it('ignores whitespace-only differences and identical lines', () => {
    expect(inlineDiff('a  b', 'a b').after).toEqual([]);
    expect(inlineDiff('same', 'same')).toEqual({ before: [], after: [] });
  });

  it('keys marks by line for both sides', () => {
    const rows = diffLines('one\nlevel: high\nend', 'one\nlevel: low\nend');
    const marks = inlineMarks(splitPairs(rows));
    expect(slice('level: high', marks.before.get(2) ?? [])).toEqual(['high']);
    expect(slice('level: low', marks.after.get(2) ?? [])).toEqual(['low']);
  });
});

describe('inlineDiff with content pairing', () => {
  it('marks a moved title, not the whole line', () => {
    // 与 GitHub 一致：标题行对上标题行，只有前缀算新增。
    const rows = diffLines(
      'title: "Audit C Format String Vulnerability"\ntitle_zh: "审计漏洞"\nlevel: high',
      'mode: "ssa"\ntitle: "数据流: Audit C Format String Vulnerability"\ntitle_zh: "数据流: 审计漏洞"\nlevel: ""',
    );
    const marks = inlineMarks(splitPairs(rows));
    const after = [...marks.after.values()].map((ranges) => ranges.map((range) => range.end - range.start));
    // 每处标记都只覆盖新增的词，不会把整行涂满。
    for (const widths of after) expect(Math.max(...widths)).toBeLessThan(24);
  });
});
