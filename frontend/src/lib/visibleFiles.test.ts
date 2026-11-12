import { describe, expect, it } from 'vitest';
import { sameList, sortedPaths } from './visibleFiles';

describe('sortedPaths', () => {
  it('sorts so the same set always yields the same array', () => {
    expect(sortedPaths(new Set(['b.go', 'a.go']))).toEqual(['a.go', 'b.go']);
    expect(sortedPaths(['b.go', 'a.go'])).toEqual(['a.go', 'b.go']);
  });

  it('returns an empty array for an empty set', () => {
    expect(sortedPaths([])).toEqual([]);
  });
});

describe('sameList', () => {
  it('compares by order and value', () => {
    expect(sameList(['a', 'b'], ['a', 'b'])).toBe(true);
    expect(sameList(['b', 'a'], ['a', 'b'])).toBe(false);
    expect(sameList(['a'], ['a', 'b'])).toBe(false);
  });
});
