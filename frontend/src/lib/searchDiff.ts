import type { CodeFile, Side } from '../types';
import { fileDiff } from './fileDiff';

export interface SearchHit {
  path: string;
  side: Side;
  line: number;
  text: string;
  start: number;
  end: number;
  kind: 'add' | 'del' | 'equal';
}

export interface SearchOptions {
  /** Match whole identifiers only: `name` does not match `username`. */
  wholeWord?: boolean;
  /** Match letter case exactly. */
  caseSensitive?: boolean;
}

const WORD = /[\p{L}\p{N}_$]/u;

function isWordChar(char: string | undefined): boolean {
  return !!char && WORD.test(char);
}

function matchAt(text: string, needle: string, wholeWord: boolean, caseSensitive: boolean): number {
  const haystack = caseSensitive ? text : text.toLocaleLowerCase();
  const query = caseSensitive ? needle : needle.toLocaleLowerCase();
  if (!wholeWord) return haystack.indexOf(query);
  let from = 0;
  while (from <= haystack.length) {
    const index = haystack.indexOf(query, from);
    if (index < 0) return -1;
    if (!isWordChar(haystack[index - 1]) && !isWordChar(haystack[index + query.length])) return index;
    from = index + 1;
  }
  return -1;
}

// Search every line the diff can reveal, including unchanged context inside
// collapsed gaps. One hit per line: jumping is line-level, so duplicate
// occurrences on the same line add noise without adding targets.
export function searchDiff(files: CodeFile[], query: string, options: SearchOptions = {}): SearchHit[] {
  const wholeWord = !!options.wholeWord;
  const caseSensitive = !!options.caseSensitive;
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const file of files) {
    for (const row of fileDiff(file).rows) {
      if (row.type === 'del') {
        const start = matchAt(row.a.text, query, wholeWord, caseSensitive);
        if (start >= 0) hits.push({ path: file.path, side: 'before', line: row.a.n, text: row.a.text, start, end: start + query.length, kind: row.type });
        continue;
      }
      const text = row.b.text;
      const start = matchAt(text, query, wholeWord, caseSensitive);
      if (start >= 0) hits.push({ path: file.path, side: 'after', line: row.b.n, text, start, end: start + query.length, kind: row.type });
    }
  }
  return hits;
}
