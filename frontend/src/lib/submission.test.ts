import { describe, expect, it } from 'vitest';
import { buildCancel, buildSubmission } from './submission';
import type { Comment, ReviewContext } from '../types';

const context: ReviewContext = {
  session_id: 'session', comparison_id: 'comparison', repository: '/repo', branch: 'feat',
  base: 'a', head: 'b', revision: 'range', subdir: '', diff_digest: 'd',
};

const comments: Comment[] = [
  {
    id: 'c-1', text: 'parameterize it', title: '', source: 'manual', signalId: '', createdAt: 1, resolved: false,
    quote: { file: 'store.go', side: 'after', start: 15, end: 17, snippet: 'query = ...' },
  },
  { id: 'c-2', text: 'overall note', title: '', source: 'manual', signalId: '', createdAt: 2, resolved: true },
];

describe('buildSubmission', () => {
  it('maps anchored and general comments', () => {
    const request = buildSubmission(context, comments, 'request-changes', 'fix it');
    expect(request).toEqual({
      action: 'submit', comparison_id: 'comparison', verdict: 'request-changes', summary: 'fix it',
      comments: [
        { id: 'c-1', body: 'parameterize it', resolved: false, file: 'store.go', line: 15, end_line: 17, side: 'after', quote: 'query = ...' },
        { id: 'c-2', body: 'overall note', resolved: true },
      ],
    });
  });

  it('keeps an empty summary and comment list', () => {
    expect(buildSubmission(context, [], 'comment', '')).toEqual({
      action: 'submit', comparison_id: 'comparison', verdict: 'comment', summary: '', comments: [],
    });
  });
});

describe('buildCancel', () => {
  it('sends only action and comparison', () => {
    expect(buildCancel(context)).toEqual({ action: 'cancel', comparison_id: 'comparison' });
  });
});
