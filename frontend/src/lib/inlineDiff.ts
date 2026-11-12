import type { SplitPair } from './diffSections';
import type { Side } from '../types';

export interface InlineRange {
  start: number;
  end: number;
}

// Words, runs of whitespace and punctuation. Keeping whitespace as its own
// token lets an inserted space stay invisible instead of widening the mark.
const TOKEN = /([\p{L}\p{N}_]+|\s+|[^\s\p{L}\p{N}_]+)/gu;
// Line pairs longer than this skip the quadratic token LCS and only trim the
// common prefix and suffix; the result is coarser but never blocks a render.
const MAX_TOKENS = 320;
const MAX_CHARS = 4000;
// A single marked token longer than this is too coarse to be useful, so the
// pair falls back to prefix/suffix trimming.
const MAX_TOKEN = 40;

interface Token {
  text: string;
  start: number;
  end: number;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  for (const match of text.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    tokens.push({ text: match[0], start, end: start + match[0].length });
  }
  return tokens;
}

// Longest common subsequence over tokens; returns the matched index pairs.
function lcsPairs(a: string[], b: string[]): [number, number][] {
  const n = a.length;
  const m = b.length;
  const width = m + 1;
  const dp = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i * width + j] = a[i] === b[j]
        ? dp[(i + 1) * width + j + 1] + 1
        : Math.max(dp[(i + 1) * width + j], dp[i * width + j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { pairs.push([i, j]); i++; j++; continue; }
    if (dp[(i + 1) * width + j] >= dp[i * width + j + 1]) i++;
    else j++;
  }
  return pairs;
}

function merge(ranges: InlineRange[], text: string): InlineRange[] {
  const out: InlineRange[] = [];
  for (const range of ranges) {
    if (range.end <= range.start) continue;
    // Whitespace-only differences are invisible; marking them adds noise.
    if (!text.slice(range.start, range.end).trim()) continue;
    const last = out.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else out.push({ ...range });
  }
  return out;
}

function unmatched(tokens: Token[], matched: Set<number>): InlineRange[] {
  return tokens.filter((_, index) => !matched.has(index)).map((token) => ({ start: token.start, end: token.end }));
}

// Common prefix and suffix are equal by definition, so the middle is the only
// part worth marking. Used directly for very long lines.
function trimMiddle(before: string, after: string): { before: InlineRange[]; after: InlineRange[] } {
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) suffix++;
  return {
    before: prefix < before.length - suffix ? [{ start: prefix, end: before.length - suffix }] : [],
    after: prefix < after.length - suffix ? [{ start: prefix, end: after.length - suffix }] : [],
  };
}

/** Character ranges to highlight on each side of a modified line pair. */
export function inlineDiff(before: string, after: string): { before: InlineRange[]; after: InlineRange[] } {
  if (before === after) return { before: [], after: [] };
  const left = tokenize(before);
  const right = tokenize(after);
  if (!left.length || !right.length) return trimMiddle(before, after);
  if (before.length > MAX_CHARS || after.length > MAX_CHARS) return trimMiddle(before, after);
  if (left.length > MAX_TOKENS || right.length > MAX_TOKENS) return trimMiddle(before, after);

  const pairs = lcsPairs(left.map((token) => token.text), right.map((token) => token.text));
  const leftMatched = new Set(pairs.map(([i]) => i));
  const rightMatched = new Set(pairs.map(([, j]) => j));
  const beforeRanges = merge(unmatched(left, leftMatched), before);
  const afterRanges = merge(unmatched(right, rightMatched), after);
  const tooWide = [...beforeRanges, ...afterRanges].some((range) => range.end - range.start > MAX_TOKEN);
  if (tooWide) return trimMiddle(before, after);
  return { before: beforeRanges, after: afterRanges };
}

export interface InlineMarks {
  before: Map<number, InlineRange[]>;
  after: Map<number, InlineRange[]>;
}

/**
 * Inline ranges for every paired line of a file, keyed by line number per side.
 * Unified and split views share the same pairs, so both show the same marks.
 */
export function inlineMarks(pairs: SplitPair[]): InlineMarks {
  const marks: InlineMarks = { before: new Map(), after: new Map() };
  for (const pair of pairs) {
    if (!pair.changed || !pair.left || !pair.right) continue;
    const ranges = inlineDiff(pair.left.text, pair.right.text);
    if (ranges.before.length) marks.before.set(pair.left.n, ranges.before);
    if (ranges.after.length) marks.after.set(pair.right.n, ranges.after);
  }
  return marks;
}

export function sideKey(side: Side, line: number): string {
  return `${side}:${line}`;
}
