import { describe, expect, it } from 'vitest';
import { codeColumns } from './codeColumns';
import { parseReviewJSON, sameReviewContext } from './review';
import type { ReviewContext, ReviewSession } from '../types';

const context: ReviewContext = {
  session_id: 'session-a', comparison_id: 'range-a', repository: '/repo', branch: 'feature/review',
  base: 'base', head: 'head', revision: 'range', subdir: '', diff_digest: 'digest',
};
const doc: ReviewSession = { version: 1, context, comments: [], viewed: [], reviewed_hunks: ['a.go@0#h'], updated_at: '' };

describe('review import', () => {
  it('restores an exact match even if JSON keys are reordered', () => {
    const reversed = Object.fromEntries(Object.entries(context).reverse());
    expect(parseReviewJSON(JSON.stringify({ ...doc, context: reversed }), context).reviewed_hunks).toEqual(['a.go@0#h']);
  });
  it.each(Object.keys(context))('rejects a different %s', (field) => {
    const other = { ...context, [field]: 'other' };
    expect(sameReviewContext(other, context)).toBe(false);
    expect(() => parseReviewJSON(JSON.stringify({ ...doc, context: other }), context)).toThrow('不匹配');
  });
  it('strips legacy summary/decision and keeps only hashed marks', () => {
    const imported = parseReviewJSON(JSON.stringify({
      ...doc, summary: 'old', decision: 'approve', viewed: ['a.go', 'a.go#h'],
      comments: [{ id: 'c1', text: 'hi', createdAt: 1 }],
    }), context);
    expect(imported).not.toHaveProperty('summary');
    expect(imported).not.toHaveProperty('decision');
    expect(imported.viewed).toEqual(['a.go#h']);
    expect(imported.comments[0]).toMatchObject({ id: 'c1', source: 'manual', title: '', text: 'hi' });
  });
  it('rejects unsupported versions and malformed state', () => {
    expect(() => parseReviewJSON('{', context)).toThrow();
    expect(() => parseReviewJSON(JSON.stringify({ ...doc, version: 2 }), context)).toThrow('版本 1');
    expect(() => parseReviewJSON(JSON.stringify({ ...doc, viewed: null }), context)).toThrow();
  });
});

describe('source tab stops', () => {
  it.each([
    ['', 0], ['\t', 4], ['\tif', 6], ['\t\treturn', 14], ['a\tb', 5], ['abcd\tx', 9], ['中文\t', 8],
  ])('counts %j as %i columns', (source, expected) => expect(codeColumns(source)).toBe(expected));
});
