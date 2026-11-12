const KEYWORDS = new Set([
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else',
  'fallthrough', 'for', 'func', 'go', 'goto', 'if', 'import', 'interface',
  'map', 'package', 'range', 'return', 'select', 'struct', 'switch', 'type', 'var',
]);

const LITERALS = new Set(['nil', 'true', 'false', 'iota']);

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function markText(text: string, word: string): string {
  if (!word) return escapeHtml(text);
  const token = /[\p{L}\p{N}_$]+/gu;
  let out = '';
  let last = 0;
  for (const match of text.matchAll(token)) {
    if (match[0] !== word) continue;
    const index = match.index ?? 0;
    out += escapeHtml(text.slice(last, index));
    out += `<mark>${escapeHtml(match[0])}</mark>`;
    last = index + match[0].length;
  }
  return out + escapeHtml(text.slice(last));
}

export interface EmphasisRange { start: number; end: number }

const GO_TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
const WORD_TOKEN = /[\p{L}\p{N}_$]+/gu;

function tokenClass(text: string): string {
  if (text.startsWith('//') || text.startsWith('/*')) return 'tok-comment';
  if (text.startsWith('"') || text.startsWith('`')) return 'tok-string';
  if (KEYWORDS.has(text)) return 'tok-keyword';
  if (LITERALS.has(text)) return 'tok-literal';
  if (/^\d/.test(text)) return 'tok-number';
  return '';
}

function paint(text: string, flags: (index: number) => { token: string; changed: boolean; word: boolean }): string {
  let out = '';
  let index = 0;
  while (index < text.length) {
    const current = flags(index);
    let end = index + 1;
    while (end < text.length) {
      const next = flags(end);
      if (next.token !== current.token || next.changed !== current.changed || next.word !== current.word) break;
      end++;
    }
    let chunk = escapeHtml(text.slice(index, end));
    if (current.word) chunk = `<mark>${chunk}</mark>`;
    if (current.changed) chunk = `<span class="chg">${chunk}</span>`;
    if (current.token) chunk = `<span class="${current.token}">${chunk}</span>`;
    out += chunk;
    index = end;
  }
  return out;
}

/** Same shading, plus the exact characters that changed inside a line. */
function highlightChanged(code: string, language: string | undefined, word: string, emphasis: EmphasisRange[]): string {
  const tokens: string[] = new Array(code.length).fill('');
  if (language === 'go') {
    for (const match of code.matchAll(GO_TOKEN)) {
      const start = match.index ?? 0;
      const cls = tokenClass(match[0]);
      if (!cls) continue;
      for (let i = start; i < start + match[0].length; i++) tokens[i] = cls;
    }
  }
  const changed: boolean[] = new Array(code.length).fill(false);
  for (const range of emphasis) {
    for (let i = Math.max(0, range.start); i < Math.min(code.length, range.end); i++) changed[i] = true;
  }
  const marked: boolean[] = new Array(code.length).fill(false);
  if (word) {
    for (const match of code.matchAll(WORD_TOKEN)) {
      if (match[0] !== word) continue;
      const start = match.index ?? 0;
      for (let i = start; i < start + match[0].length; i++) marked[i] = true;
    }
  }
  return paint(code, (index) => ({ token: tokens[index], changed: changed[index], word: marked[index] }));
}

/**
 * 轻量 Go 高亮。只做词法级着色，不追求完整语法树。
 * 输入先分词再转义，避免把代码注入 HTML。
 */
export function highlight(code: string, language?: string, word = '', emphasis: EmphasisRange[] = []): string {
  if (emphasis.length) return highlightChanged(code, language, word, emphasis);
  if (language !== 'go') return markText(code, word);

  const token = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let out = '';
  let last = 0;
  for (const match of code.matchAll(token)) {
    const index = match.index ?? 0;
    out += markText(code.slice(last, index), word);
    const text = match[0];
    if (text.startsWith('//') || text.startsWith('/*')) {
      out += `<span class="tok-comment">${markText(text, word)}</span>`;
    } else if (text.startsWith('"') || text.startsWith('`')) {
      out += `<span class="tok-string">${markText(text, word)}</span>`;
    } else if (KEYWORDS.has(text)) {
      out += `<span class="tok-keyword">${markText(text, word)}</span>`;
    } else if (LITERALS.has(text)) {
      out += `<span class="tok-literal">${markText(text, word)}</span>`;
    } else if (/^\d/.test(text)) {
      out += `<span class="tok-number">${markText(text, word)}</span>`;
    } else {
      out += markText(text, word);
    }
    last = index + text.length;
  }
  out += markText(code.slice(last), word);
  return out;
}
