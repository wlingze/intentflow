import { describe, expect, it } from 'vitest';
import { GAP_HEIGHT, HUNK_HEIGHT, LINE_HEIGHT, estimateItem } from './cardHeights';

const widths = [420, 700, 900, 1400];

describe('estimateItem', () => {
  it('returns exact heights for non-wrapped rows', () => {
    for (const width of widths) {
      expect(estimateItem({ type: 'line' }, false, width)).toBe(LINE_HEIGHT);
      expect(estimateItem({ type: 'header' }, false, width)).toBe(HUNK_HEIGHT);
      expect(estimateItem({ type: 'gap' }, false, width)).toBe(GAP_HEIGHT);
    }
  });

  it('keeps header and gap heights when wrapping', () => {
    expect(estimateItem({ type: 'header' }, true, 400)).toBe(HUNK_HEIGHT);
    expect(estimateItem({ type: 'gap' }, true, 400)).toBe(GAP_HEIGHT);
  });

  it('grows with the number of visual lines', () => {
    const text = 'x'.repeat(300);
    const narrow = estimateItem({ type: 'line' }, true, 420, text);
    const wide = estimateItem({ type: 'line' }, true, 1400, text);
    expect(narrow).toBeGreaterThan(wide);
    expect(wide % LINE_HEIGHT).toBe(0);
    expect(narrow % LINE_HEIGHT).toBe(0);
  });

  it('counts a tab as four columns', () => {
    const tabbed = estimateItem({ type: 'line' }, true, 900, '\t'.repeat(200));
    const plain = estimateItem({ type: 'line' }, true, 900, 'x'.repeat(200));
    expect(tabbed).toBeGreaterThan(plain);
  });

  it('always reserves at least one line', () => {
    expect(estimateItem({ type: 'line' }, true, 1400, '')).toBe(LINE_HEIGHT);
  });
});
