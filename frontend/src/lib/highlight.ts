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

/**
 * 轻量 Go 高亮。只做词法级着色，不追求完整语法树。
 * 输入先分词再转义，避免把代码注入 HTML。
 */
export function highlight(code: string, language?: string): string {
  if (language !== 'go') return escapeHtml(code);

  const token = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|`[^`]*`|\b\d+(?:\.\d+)?\b|\b[A-Za-z_]\w*\b)/g;
  let out = '';
  let last = 0;
  for (const match of code.matchAll(token)) {
    const index = match.index ?? 0;
    out += escapeHtml(code.slice(last, index));
    const text = match[0];
    if (text.startsWith('//') || text.startsWith('/*')) {
      out += `<span class="tok-comment">${escapeHtml(text)}</span>`;
    } else if (text.startsWith('"') || text.startsWith('`')) {
      out += `<span class="tok-string">${escapeHtml(text)}</span>`;
    } else if (KEYWORDS.has(text)) {
      out += `<span class="tok-keyword">${escapeHtml(text)}</span>`;
    } else if (LITERALS.has(text)) {
      out += `<span class="tok-literal">${escapeHtml(text)}</span>`;
    } else if (/^\d/.test(text)) {
      out += `<span class="tok-number">${escapeHtml(text)}</span>`;
    } else {
      out += escapeHtml(text);
    }
    last = index + text.length;
  }
  out += escapeHtml(code.slice(last));
  return out;
}
