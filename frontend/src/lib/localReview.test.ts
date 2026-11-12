import { beforeEach, describe, expect, it } from 'vitest';
import { listLocalDrafts, loadLocalReview, restoreLocalDraft, saveLocalReview } from './localReview';
import type { ReviewContext, ReviewSession } from '../types';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      get length() { return store.size; },
      key: (index: number) => [...store.keys()][index] ?? null,
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => store.clear(),
    },
  });
});

const context = (comparison: string, session = 's-1'): ReviewContext => ({
  session_id: session, comparison_id: comparison, repository: 'repo', branch: 'main',
  base: 'a', head: 'b', revision: 'HEAD', subdir: '', diff_digest: 'd',
});

const doc = (comparison: string, session = 's-1'): ReviewSession => ({
  version: 1, context: context(comparison, session),
  comments: [{ id: 'c-1', resolved: false, source: 'manual', title: '', signalId: '', text: '看这里', createdAt: 1 }],
  viewed: ['a.go#1'], reviewed_hunks: [], updated_at: '',
});

describe('localReview', () => {
  it('round-trips a review document', () => {
    saveLocalReview(doc('cmp-1'));
    const loaded = loadLocalReview(context('cmp-1'));
    expect(loaded?.comments[0].text).toBe('看这里');
    expect(loaded?.viewed).toEqual(['a.go#1']);
  });

  it('ignores a document from another comparison', () => {
    saveLocalReview(doc('cmp-1'));
    expect(loadLocalReview(context('cmp-2'))).toBeNull();
  });

  it('lists drafts of the same session only', () => {
    saveLocalReview(doc('cmp-1'));
    saveLocalReview(doc('cmp-2'));
    saveLocalReview(doc('cmp-3', 'other'));
    const drafts = listLocalDrafts(context('cmp-1'));
    expect(drafts.map((draft) => draft.comparison_id)).toEqual(['cmp-2']);
  });

  it('survives a quota error without throwing', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: { get length() { return 0; }, key: () => null, getItem: () => null, setItem: () => { throw new Error('quota'); }, removeItem: () => {}, clear: () => {} },
    });
    expect(() => saveLocalReview(doc('cmp-1'))).not.toThrow();
  });

  it('restores another comparison and drops stale line anchors', () => {
    const source = doc('cmp-2');
    source.comments[0].quote = { file: 'a.go', side: 'after', start: 1, end: 99, snippet: 'x' };
    saveLocalReview(source);
    const outcome = restoreLocalDraft(context('cmp-1'), [{ path: 'a.go', after: 'a\nb\n' }], 'cmp-2');
    expect(outcome?.document.comments[0].quote).toBeUndefined();
    expect(outcome?.adjusted).toBe(1);
    expect(outcome?.document.context.comparison_id).toBe('cmp-1');
    expect(outcome?.document.viewed).toEqual(['a.go#1']);
  });

  it('keeps anchors that still fit', () => {
    const source = doc('cmp-2');
    source.comments[0].quote = { file: 'a.go', side: 'after', start: 1, end: 2, snippet: 'x' };
    saveLocalReview(source);
    const outcome = restoreLocalDraft(context('cmp-1'), [{ path: 'a.go', after: 'a\nb\nc\n' }], 'cmp-2');
    expect(outcome?.document.comments[0].quote?.file).toBe('a.go');
    expect(outcome?.adjusted).toBe(0);
  });
});
