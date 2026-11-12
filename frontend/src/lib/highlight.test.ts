import { describe, expect, it } from 'vitest';
import { highlight } from './highlight';

describe('highlight', () => {
  it('escapes unknown languages', () => {
    expect(highlight('<b>', 'text')).toBe('&lt;b&gt;');
  });
  it('marks whole words only', () => {
    expect(highlight('user users user', 'text', 'user')).toBe('<mark>user</mark> users <mark>user</mark>');
  });
  it('marks inside highlighted tokens and keeps escaping', () => {
    const html = highlight('var user = "user<"', 'go', 'user');
    expect(html).toContain('<mark>user</mark>');
    expect(html).toContain('&quot;');
    expect(html).not.toContain('<b>');
  });
  it('returns plain escaped html without a word', () => {
    expect(highlight('package main', 'go')).toContain('package');
  });
});

describe('highlight with emphasis ranges', () => {
  it('wraps only the changed characters', () => {
    const html = highlight('  level: high', 'go', '', [{ start: 9, end: 13 }]);
    expect(html).toContain('<span class="chg">high</span>');
    expect(html.match(/class="chg"/g)).toHaveLength(1);
  });

  it('keeps syntax colours alongside the mark', () => {
    const html = highlight('const name = "old"', 'go', '', [{ start: 14, end: 17 }]);
    expect(html).toContain('class="tok-keyword"');
    expect(html).toContain('class="tok-string"');
    expect(html).toContain('<span class="chg">old</span>');
  });

  it('escapes markup inside a marked range', () => {
    const html = highlight('a < b && c', 'text', '', [{ start: 2, end: 7 }]);
    expect(html).toContain('<span class="chg">&lt; b &amp;</span>');
    expect(html).not.toContain('< b');
  });

  it('still marks the selected word inside a changed range', () => {
    const html = highlight('title: "new title"', 'go', 'title', [{ start: 8, end: 17 }]);
    expect(html).toContain('<mark>title</mark>');
    expect(html).toContain('<span class="chg">');
  });

  it('does nothing extra without ranges', () => {
    expect(highlight('let a = 1', 'go', '')).not.toContain('class="chg"');
  });
});
