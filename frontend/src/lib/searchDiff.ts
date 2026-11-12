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
  /** Match whole words and case exactly instead of a plain substring. */
  exact?: boolean;
}

const WORD = /[\p{L}\p{N}_$]/u;

function isWordChar(char: string | undefined): boolean {
  return !!char && WORD.test(char);
}

// Exact mode compares whole identifiers: `name` finds `name` but not `username`
// and not `Name`. Plain mode stays case-insensitive substring.
function matchAt(text: string, needle: string, exact: boolean): number {
  if (!exact) return text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase());
  let from = 0;
  while (from <= text.length) {
    const index = text.indexOf(needle, from);
    if (index < 0) return -1;
    if (!isWordChar(text[index - 1]) && !isWordChar(text[index + needle.length])) return index;
    from = index + 1;
  }
  return -1;
}

// Search every line the diff can reveal, including unchanged context inside
// collapsed gaps. One hit per line: jumping is line-level, so duplicate
// occurrences on the same line add noise without adding targets.
export function searchDiff(files: CodeFile[], query: string, options: SearchOptions = {}): SearchHit[] {
  const exact = !!options.exact;
  if (!query.trim()) return [];
  const hits: SearchHit[] = [];
  for (const file of files) {
    for (const row of fileDiff(file).rows) {
      if (row.type === 'del') {
        const start = matchAt(row.a.text, query, exact);
        if (start >= 0) hits.push({ path: file.path, side: 'before', line: row.a.n, text: row.a.text, start, end: start + query.length, kind: row.type });
        continue;
      }
      const text = row.b.text;
      const start = matchAt(text, query, exact);
      if (start >= 0) hits.push({ path: file.path, side: 'after', line: row.b.n, text, start, end: start + query.length, kind: row.type });
    }
  }
  return hits;
}
