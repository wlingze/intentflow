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

/**
 * 轻量 Go 高亮。只做词法级着色，不追求完整语法树。
 * 输入先分词再转义，避免把代码注入 HTML。
 */
export function highlight(code: string, language?: string, word = ''): string {
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
