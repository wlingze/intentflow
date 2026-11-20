import hljs from 'highlight.js/lib/core';
import c from 'highlight.js/lib/languages/c';
import cmake from 'highlight.js/lib/languages/cmake';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import groovy from 'highlight.js/lib/languages/groovy';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import lua from 'highlight.js/lib/languages/lua';
import makefile from 'highlight.js/lib/languages/makefile';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import protobuf from 'highlight.js/lib/languages/protobuf';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scala from 'highlight.js/lib/languages/scala';
import scss from 'highlight.js/lib/languages/scss';
import shell from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import swift from 'highlight.js/lib/languages/swift';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import type { LanguageFn } from 'highlight.js';

export interface EmphasisRange { start: number; end: number }

// Only these grammars are ever registered, so the bundle stays proportional to
// the languages the diff can actually show. A missing id renders as plain text.
const GRAMMARS: Record<string, LanguageFn> = {
  // XML must exist before the JS/TS grammars compile their JSX sub-language.
  xml,
  c,
  cpp,
  csharp,
  go,
  rust,
  java,
  kotlin,
  scala,
  python,
  javascript,
  typescript,
  php,
  ruby,
  swift,
  lua,
  shell,
  sql,
  yaml,
  json,
  toml: ini,
  css,
  scss,
  markdown,
  docker: dockerfile,
  makefile,
  cmake,
  groovy,
  protobuf,
};

// Backend language ids win; these aliases only smooth over extension-like ids.
const ALIASES: Record<string, string> = {
  'c++': 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  'c#': 'csharp',
  cs: 'csharp',
  golang: 'go',
  rs: 'rust',
  kt: 'kotlin',
  kts: 'kotlin',
  py: 'python',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  shellscript: 'shell',
  yml: 'yaml',
  md: 'markdown',
  dockerfile: 'docker',
  make: 'makefile',
  mk: 'makefile',
  cmakelists: 'cmake',
  proto: 'protobuf',
  htm: 'xml',
  html: 'xml',
  xhtml: 'xml',
  sass: 'scss',
  gradle: 'groovy',
  'gradle-kts': 'kotlin',
};

function normalizeLanguage(language?: string): string {
  const key = language?.trim().toLowerCase() ?? '';
  return ALIASES[key] ?? key;
}

type TokenClass = 'tok-comment' | 'tok-string' | 'tok-number' | 'tok-keyword' | 'tok-literal';

interface Span { start: number; end: number; cls: TokenClass }

// Map highlight.js scopes onto the five colours already defined in global.css.
// Containers (function, class, params, punctuation) stay unstyled; the text
// inside them is painted by the inner scope.
const SCOPES: Record<string, TokenClass | undefined> = {
  'hljs-keyword': 'tok-keyword',
  'hljs-built_in': 'tok-keyword',
  'hljs-type': 'tok-keyword',
  'hljs-title': 'tok-keyword',
  'hljs-section': 'tok-keyword',
  'hljs-tag': 'tok-keyword',
  'hljs-name': 'tok-keyword',
  'hljs-selector-tag': 'tok-keyword',
  'hljs-attribute': 'tok-keyword',
  'hljs-meta-keyword': 'tok-keyword',
  'hljs-string': 'tok-string',
  'hljs-regexp': 'tok-string',
  'hljs-code': 'tok-string',
  'hljs-formula': 'tok-string',
  'hljs-comment': 'tok-comment',
  'hljs-quote': 'tok-comment',
  'hljs-doctag': 'tok-comment',
  'hljs-meta': 'tok-comment',
  'hljs-number': 'tok-number',
  'hljs-literal': 'tok-literal',
  'hljs-symbol': 'tok-literal',
  'hljs-bullet': 'tok-literal',
  'hljs-link': 'tok-literal',
  'hljs-attr': 'tok-literal',
  'hljs-property': 'tok-literal',
  'hljs-variable': 'tok-literal',
  'hljs-template-variable': 'tok-literal',
  'hljs-selector-class': 'tok-literal',
  'hljs-selector-id': 'tok-literal',
  'hljs-emphasis': 'tok-literal',
  'hljs-strong': 'tok-literal',
  'hljs-addition': 'tok-literal',
  'hljs-deletion': 'tok-comment',
};

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#x27;': "'",
  '&#39;': "'",
};

function decode(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#x27|#39);/g, (entity) => ENTITIES[entity] ?? entity);
}

function scopeClass(attribute: string): TokenClass | undefined {
  for (const name of attribute.split(/\s+/)) {
    const cls = SCOPES[name];
    if (cls) return cls;
  }
  return undefined;
}

/**
 * highlight.js returns flat text plus nested <span class="hljs-..."> nodes.
 * Walk it once to recover character offsets, then paint with our own colours.
 * If the shape is unexpected, return null so the caller can fall back to text.
 */
function readSpans(html: string, code: string): Span[] | null {
  const spans: Span[] = [];
  const stack: Array<TokenClass | undefined> = [];
  let offset = 0;
  for (const match of html.matchAll(/<span class="([^"]*)">|<\/span>|([^<]+)/g)) {
    if (match[1] !== undefined) {
      stack.push(scopeClass(match[1]));
      continue;
    }
    if (match[0] === '</span>') {
      stack.pop();
      continue;
    }
    const text = decode(match[2]);
    if (text) {
      const lead = text.length - text.trimStart().length;
      const trail = text.length - text.trimEnd().length;
      const start = offset + lead;
      const end = offset + text.length - trail;
      const cls = [...stack].reverse().find(Boolean);
      if (cls && end > start) {
        const last = spans.at(-1);
        // Adjacent scopes (tag < + name project) read as one token.
        if (last && last.end === start && last.cls === cls) last.end = end;
        else spans.push({ start, end, cls });
      }
      offset += text.length;
    }
  }
  return offset === code.length ? spans : null;
}

const CACHE_LIMIT = 4000;
const cache = new Map<string, Span[]>();

// Importing is on demand; registering is cheap and must be complete before the
// first highlight so JSX can resolve its XML sub-language.
for (const [id, grammar] of Object.entries(GRAMMARS)) hljs.registerLanguage(id, grammar);

function spansFor(code: string, language?: string): Span[] {
  const id = normalizeLanguage(language);
  const grammar = GRAMMARS[id];
  if (!grammar || !code) return [];
  const key = `${id}\u0000${code}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  let spans: Span[] = [];
  try {
    const result = hljs.highlight(code, { language: id, ignoreIllegals: true });
    spans = readSpans(result.value, code) ?? [];
  } catch {
    spans = [];
  }
  cache.set(key, spans);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return spans;
}

function escapeHtml(text: string): string {
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const WORD = /[\p{L}\p{N}_$]+/gu;

function ranges(text: string, word: string): EmphasisRange[] {
  const out: EmphasisRange[] = [];
  if (!word) return out;
  for (const match of text.matchAll(WORD)) {
    if (match[0] !== word) continue;
    const start = match.index ?? 0;
    out.push({ start, end: start + match[0].length });
  }
  return out;
}

function clip(code: string, rangesToClip: EmphasisRange[]): EmphasisRange[] {
  const out: EmphasisRange[] = [];
  for (const range of rangesToClip) {
    const start = Math.max(0, Math.min(code.length, range.start));
    const end = Math.max(0, Math.min(code.length, range.end));
    if (end > start) out.push({ start, end });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Paint token spans, the selected word, and the changed characters in one pass. */
function paint(code: string, spans: Span[], word: string, emphasis: EmphasisRange[]): string {
  const changes = clip(code, emphasis);
  const words = ranges(code, word);
  const points = new Set<number>([0, code.length]);
  const add = (value: number) => {
    if (value > 0 && value < code.length) points.add(value);
  };
  for (const span of spans) {
    add(span.start);
    add(span.end);
  }
  for (const range of [...changes, ...words]) {
    add(range.start);
    add(range.end);
  }
  const marks = [...points].sort((a, b) => a - b);
  let spanIndex = 0;
  let changeIndex = 0;
  let wordIndex = 0;
  let out = '';
  for (let i = 0; i < marks.length - 1; i++) {
    const start = marks[i];
    const end = marks[i + 1];
    while (spanIndex < spans.length && spans[spanIndex].end <= start) spanIndex++;
    const cls = spanIndex < spans.length && spans[spanIndex].start <= start ? spans[spanIndex].cls : undefined;
    while (changeIndex < changes.length && changes[changeIndex].end <= start) changeIndex++;
    const changed = changeIndex < changes.length && changes[changeIndex].start <= start && changes[changeIndex].end >= end;
    while (wordIndex < words.length && words[wordIndex].end <= start) wordIndex++;
    const marked = wordIndex < words.length && words[wordIndex].start <= start && words[wordIndex].end >= end;
    let chunk = escapeHtml(code.slice(start, end));
    if (marked) chunk = `<mark>${chunk}</mark>`;
    if (changed) chunk = `<span class="chg">${chunk}</span>`;
    if (cls) chunk = `<span class="${cls}">${chunk}</span>`;
    out += chunk;
  }
  return out;
}

/**
 * 语法着色使用 highlight.js；只注册需要的语言，未注册的 id 退化为纯文本。
 * 选词 <mark> 与行内改动的 .chg 在同一遍里叠加，转义始终发生在注入之前。
 */
export function highlight(code: string, language?: string, word = '', emphasis: EmphasisRange[] = []): string {
  return paint(code, spansFor(code, language), word, emphasis);
}

interface DocumentSpans { starts: Int32Array; spans: Span[] | null }

// Go 的原始字符串、多行注释和模板字符串都跨行。逐行调用 highlight.js 会把
// 每一行当成新文档，反引号里的内容因此按代码着色。整份文件只解析一次，再
// 按行裁剪 token，diff 行与文件全文自然得到同一结果。
const DOCUMENT_LIMIT = 32;
const documents = new Map<string, DocumentSpans>();

function spansForDocument(code: string, id: string): DocumentSpans {
  const key = `${id}\u0000${code}`;
  const hit = documents.get(key);
  if (hit) {
    documents.delete(key);
    documents.set(key, hit);
    return hit;
  }
  const starts = [0];
  for (let index = 0; index < code.length; index++) {
    if (code.charCodeAt(index) === 10) starts.push(index + 1);
  }
  const document: DocumentSpans = { starts: Int32Array.from(starts), spans: null };
  try {
    const result = hljs.highlight(code, { language: id, ignoreIllegals: true });
    document.spans = readSpans(result.value, code);
  } catch {
    document.spans = null;
  }
  documents.set(key, document);
  if (documents.size > DOCUMENT_LIMIT) {
    const oldest = documents.keys().next().value;
    if (oldest !== undefined) documents.delete(oldest);
  }
  return document;
}

function clipSpans(spans: Span[], start: number, end: number): Span[] {
  let low = 0;
  let high = spans.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (spans[middle].end <= start) low = middle + 1;
    else high = middle;
  }
  const out: Span[] = [];
  for (let index = low; index < spans.length && spans[index].start < end; index++) {
    const from = Math.max(spans[index].start, start);
    const to = Math.min(spans[index].end, end);
    if (to > from) out.push({ start: from - start, end: to - start, cls: spans[index].cls });
  }
  return out;
}

export interface LinePainter {
  /** 按整份文档的 token 状态给一行着色。text 必须与原文该行完全一致。 */
  paint(line: number, text: string, word?: string, emphasis?: EmphasisRange[]): string;
}

/**
 * 返回按行着色器：整份 code 只解析一次，跨行字符串在每一行都保持同一状态。
 * 调用方给出的行号或文本与原文不符时退回单行着色，不影响旧调用。
 */
export function linePainter(code: string, language?: string): LinePainter {
  const id = normalizeLanguage(language);
  if (!GRAMMARS[id] || !code) {
    return { paint: (_line, text, word = '', emphasis = []) => highlight(text, language, word, emphasis) };
  }
  const document = spansForDocument(code, id);
  const spans = document.spans;
  if (!spans) {
    return { paint: (_line, text, word = '', emphasis = []) => highlight(text, language, word, emphasis) };
  }
  return {
    paint(line, text, word = '', emphasis = []) {
      const index = line - 1;
      const start = index >= 0 && index < document.starts.length ? document.starts[index] : -1;
      if (start < 0 || code.slice(start, start + text.length) !== text) return highlight(text, language, word, emphasis);
      return paint(text, clipSpans(spans, start, start + text.length), word, emphasis);
    },
  };
}
