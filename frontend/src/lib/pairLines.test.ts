import { describe, expect, it } from 'vitest';
import { pairBlock } from './pairLines';
import type { DiffLine } from './diffSections';

const line = (n: number, text: string): DiffLine => ({ n, text });

describe('pairBlock', () => {
  it('pairs similar lines instead of pairing by position', () => {
    const left = [line(2, '\ttitle: "Audit C Format String Vulnerability"'), line(3, '\ttitle_zh: "审计C语言中的格式化字符串漏洞"')];
    const right = [line(2, '\tmode: "ssa"'), line(3, '\ttitle: "数据流: Audit C Format String Vulnerability"'), line(4, '\ttitle_zh: "数据流: 审计C语言中的格式化字符串漏洞"')];
    const pairs = pairBlock(left, right);
    expect(pairs.map((pair) => [pair.left?.n, pair.right?.n])).toEqual([
      [undefined, 2],
      [2, 3],
      [3, 4],
    ]);
  });

  it('pairs by position when no line is similar', () => {
    const pairs = pairBlock([line(1, 'b')], [line(1, 'X'), line(2, 'Y')]);
    expect(pairs.map((pair) => [pair.left?.n, pair.right?.n])).toEqual([
      [1, 1],
      [undefined, 2],
    ]);
  });

  it('keeps a single replaced line on one row', () => {
    const pairs = pairBlock([line(7, '  level: high')], [line(7, '  level: ""')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].left?.text).toContain('high');
  });

  it('never loses a line', () => {
    const left = Array.from({ length: 12 }, (_, index) => line(index + 1, `value ${index}`));
    const right = Array.from({ length: 20 }, (_, index) => line(index + 1, `other ${index}`));
    const pairs = pairBlock(left, right);
    expect(pairs.filter((pair) => pair.left)).toHaveLength(12);
    expect(pairs.filter((pair) => pair.right)).toHaveLength(20);
  });
});
