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
