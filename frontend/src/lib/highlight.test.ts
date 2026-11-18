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

// Each case checks the rendered source, not just the language registry.
const samples = [
  ['c', '#include <stdio.h>', 'keyword', 'include'],
  ['cpp', 'template<class T> struct Box {};', 'keyword', 'template'],
  ['csharp', 'public record Point(int X);', 'keyword', 'record'],
  ['go', 'package main', 'keyword', 'package'],
  ['rust', 'fn main() {}', 'keyword', 'fn'],
  ['java', 'public interface Task {}', 'keyword', 'interface'],
  ['kotlin', 'fun answer() = 42', 'keyword', 'fun'],
  ['scala', 'case class Point(x: Int)', 'keyword', 'case'],
  ['python', 'def answer():', 'keyword', 'def'],
  ['javascript', 'export const answer = 42;', 'keyword', 'export'],
  ['typescript', 'interface Point { x: number }', 'keyword', 'interface'],
  ['jsx', 'return <Button />;', 'keyword', '&lt;Button'],
  ['tsx', 'const el: JSX.Element = <Button />;', 'keyword', '&lt;Button'],
  ['php', 'function answer(): int {', 'keyword', 'function'],
  ['ruby', 'unless ready?', 'keyword', 'unless'],
  ['swift', 'guard let value = input else {', 'keyword', 'guard'],
  ['lua', 'local answer = 42 -- value', 'keyword', 'local'],
  ['shell', 'if test -f "$file"; then', 'keyword', 'then'],
  ['sql', 'Select count(*) FROM events;', 'keyword', 'Select'],
  ['yaml', 'enabled: true', 'literal', 'enabled:'],
  ['json', '{"enabled": true}', 'literal', '&quot;enabled&quot;'],
  ['toml', '[server.http]', 'keyword', '[server.http]'],
  ['xml', '<project id="x"/>', 'keyword', '&lt;project'],
  ['html', '<section>Text</section>', 'keyword', '&lt;section&gt;'],
  ['css', '.card { color: red; }', 'keyword', 'color'],
  ['scss', '$accent: #fff;', 'literal', '$accent'],
  ['markdown', '## Heading', 'keyword', '## Heading'],
  ['docker', 'FROM alpine AS build', 'keyword', 'FROM'],
  ['makefile', 'all: app', 'keyword', 'all: app'],
  ['cmake', 'add_library(app main.c)', 'keyword', 'add_library'],
  ['groovy', 'def modules = []', 'keyword', 'def'],
  ['protobuf', 'message Event {}', 'keyword', 'Event'],
];

it.each(samples)('colours %s source', (language, code, kind, token) => {
  expect(highlight(code, language)).toContain(`<span class="tok-${kind}">${token}</span>`);
});

it('keeps C strings, character literals, comments and numbers distinct', () => {
  const html = highlight(`char c = '<'; puts("return &"); /* return */ return 0x2Au;`, 'c');
  expect(html).toContain('<span class="tok-string">&#39;&lt;&#39;</span>');
  expect(html).toContain('<span class="tok-string">&quot;return &amp;&quot;</span>');
  expect(html).toContain('<span class="tok-comment">/* return */</span>');
  expect(html).toContain('<span class="tok-keyword">return</span>');
  expect(html).toContain('<span class="tok-number">0x2Au</span>');
});

it('resolves extension-like aliases to the same grammar', () => {
  expect(highlight('package main', 'golang')).toContain('<span class="tok-keyword">package</span>');
  expect(highlight('if true; then', 'bash')).toContain('<span class="tok-keyword">then</span>');
  expect(highlight('interface Point { x: number }', 'tsx')).toContain('<span class="tok-keyword">interface</span>');
});

it('composes C syntax, selected words and changed ranges on the same text', () => {
  expect(highlight('return n;', 'c', 'return', [{ start: 0, end: 6 }])).toBe(
    '<span class="tok-keyword"><span class="chg"><mark>return</mark></span></span> n;',
  );
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
