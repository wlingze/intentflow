import test from 'node:test';
import assert from 'node:assert/strict';
import { findAuthenticityToken, importComments, mapReview, parsePrUrl, reviewCommentFields, reviewFields, webReviewPaths } from './github.js';

const diff = `--- a/a.txt
+++ b/a.txt
@@ -1,4 +1,4 @@
 one
-two
+TWO
 three
 four
@@ -10,2 +10,3 @@
 ten
+eleven
 twelve
`;

const doc = {
  comments: [
    { id: 'c1', text: 'after 2', quote: { file: 'a.txt', side: 'after', start: 2, end: 2 } },
    { id: 'c2', text: 'before 2', quote: { file: 'a.txt', side: 'before', start: 2, end: 2 } },
    { id: 'c3', text: 'multi', quote: { file: 'a.txt', side: 'after', start: 11, end: 12 } },
    { id: 'c4', text: 'old line', quote: { file: 'a.txt', side: 'after', start: 6, end: 6 } },
    { id: 'c5', text: 'general' },
    { id: 'gh-1', text: 'imported' },
    { id: 'c6', text: 'resolved', resolved: true, quote: { file: 'a.txt', side: 'after', start: 2, end: 2 } },
  ],
};

test('parsePrUrl accepts files and conversation pages', () => {
  assert.deepEqual(parsePrUrl('https://github.com/o/r/pull/3'), { owner: 'o', repo: 'r', number: 3 });
  assert.deepEqual(parsePrUrl('https://github.com/o/r/pull/3/files'), { owner: 'o', repo: 'r', number: 3 });
  assert.equal(parsePrUrl('https://github.com/o/r/issues/3'), null);
});

test('mapReview separates inline, general and unmapped comments', () => {
  const mapped = mapReview(doc, diff);
  assert.equal(mapped.comments.length, 3);
  assert.deepEqual(mapped.comments[0], { path: 'a.txt', body: 'after 2', line: 2, side: 'RIGHT' });
  assert.deepEqual(mapped.comments[1], { path: 'a.txt', body: 'before 2', line: 2, side: 'LEFT' });
  assert.deepEqual(mapped.comments[2], { path: 'a.txt', body: 'multi', start_line: 11, start_side: 'RIGHT', line: 12, side: 'RIGHT' });
  assert.equal(mapped.skipped, 1);
  assert.match(mapped.body, /整体意见/);
  assert.match(mapped.body, /general/);
  assert.match(mapped.body, /未映射/);
  assert.match(mapped.body, /old line/);
});

test('importComments keeps LEFT and RIGHT anchors', () => {
  const imported = importComments([
    { id: 1, body: 'hi', path: 'a.txt', line: 4, side: 'RIGHT', created_at: '2026-01-02T03:04:05Z' },
    { id: 2, body: 'old', path: 'a.txt', line: 2, side: 'LEFT', start_line: 1, created_at: '2026-01-02T03:04:05Z' },
    { id: 3, body: 'outdated', path: 'a.txt', line: null, original_line: 8, side: 'RIGHT', created_at: '2026-01-02T03:04:05Z' },
  ]);
  assert.equal(imported[0].id, 'gh-1');
  assert.deepEqual(imported[0].quote, { file: 'a.txt', side: 'after', start: 4, end: 4, snippet: '' });
  assert.deepEqual(imported[1].quote, { file: 'a.txt', side: 'before', start: 1, end: 2, snippet: '' });
  assert.equal(imported[2].quote.end, 8);
  assert.equal(imported[0].createdAt, Date.parse('2026-01-02T03:04:05Z'));
});

test('native form helpers target the logged-in review endpoints', () => {
  assert.deepEqual(webReviewPaths('o', 'r', 7), {
    page: '/o/r/pull/7',
    comment: '/o/r/pull/7/review_comments',
    review: '/o/r/pull/7/reviews',
  });
  assert.deepEqual(reviewCommentFields({ path: 'a.txt', body: 'hi', line: 12, side: 'RIGHT' }), {
    'pull_request_review_comment[body]': 'hi',
    'pull_request_review_comment[path]': 'a.txt',
    'pull_request_review_comment[line]': '12',
    'pull_request_review_comment[side]': 'RIGHT',
  });
  assert.deepEqual(reviewCommentFields({ path: 'a.txt', body: 'multi', line: 12, side: 'RIGHT', start_line: 10 }), {
    'pull_request_review_comment[body]': 'multi',
    'pull_request_review_comment[path]': 'a.txt',
    'pull_request_review_comment[line]': '12',
    'pull_request_review_comment[side]': 'RIGHT',
    'pull_request_review_comment[start_line]': '10',
    'pull_request_review_comment[start_side]': 'RIGHT',
  });
  assert.deepEqual(reviewFields({ body: 'summary', event: 'APPROVE' }), {
    'pull_request_review[body]': 'summary',
    'pull_request_review[event]': 'APPROVE',
  });
});

test('findAuthenticityToken reads form and meta tokens', () => {
  const form = { querySelector: (selector) => selector.includes('authenticity_token') ? { value: 'form-token' } : null };
  assert.equal(findAuthenticityToken(form), 'form-token');
  const meta = { querySelector: (selector) => selector.includes('csrf-token') ? { getAttribute: () => 'meta-token' } : null };
  assert.equal(findAuthenticityToken(meta), 'meta-token');
});
