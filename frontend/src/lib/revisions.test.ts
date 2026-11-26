import { describe, expect, it } from 'vitest';
import { pickRevision } from './revisions';
import type { RevisionList } from '../types';

function list(current: string, ids: string[]): RevisionList {
  return {
    base: 'main', head: 'HEAD', current, dirty: ids.includes('worktree'),
    revisions: ids.map((id) => ({ id, kind: id === 'worktree' ? 'worktree' : 'range', label: id, short: id, subject: '' })),
  } as RevisionList;
}

describe('pickRevision', () => {
  it('keeps the current worktree revision while it still exists', () => {
    expect(pickRevision('worktree', list('worktree', ['worktree', 'range']))).toBe('worktree');
  });

  it('falls back to the server current revision when the worktree is gone', () => {
    // 改动被撤销：列表里没有 worktree，服务端 current 仍指向 worktree。
    const gone = list('worktree', ['range', 'commit:abc']);
    expect(pickRevision('worktree', gone)).toBe('range');
  });

  it('falls back to the first revision when current is stale too', () => {
    expect(pickRevision('worktree', list('commit:gone', ['range', 'commit:abc']))).toBe('range');
  });

  it('keeps the id when the list is empty', () => {
    expect(pickRevision('worktree', list('worktree', []))).toBe('worktree');
  });
});
