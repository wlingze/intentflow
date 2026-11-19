import { describe, expect, it } from 'vitest';
import { baseSummary } from './baseStatus';

describe('baseSummary', () => {
  it('names the upstream and count when the base is behind', () => {
    expect(baseSummary({
      baseLabel: 'merge-base(origin/main@abc1234)',
      baseBehind: 3,
      baseUpstream: 'origin/main',
      needsRebase: true,
    })).toBe('基线 merge-base(origin/main@abc1234) · 落后 origin/main 3 个提交，建议 rebase');
  });

  it('suggests a rebase even when no commit count is available', () => {
    expect(baseSummary({
      baseLabel: 'v1.0', baseBehind: 0, baseUpstream: 'origin/main', needsRebase: true,
    })).toBe('基线 v1.0 · 建议 rebase');
  });

  it('marks the base as current when HEAD contains the upstream tip', () => {
    expect(baseSummary({
      baseLabel: 'merge-base(origin/main@abc1234)',
      baseBehind: 0,
      baseUpstream: 'origin/main',
      needsRebase: false,
    })).toBe('基线 merge-base(origin/main@abc1234) · 已包含 origin/main');
  });

  it('keeps the label alone when no upstream is known', () => {
    expect(baseSummary({
      baseLabel: 'v1.0', baseBehind: 0, baseUpstream: '', needsRebase: false,
    })).toBe('基线 v1.0');
  });
});