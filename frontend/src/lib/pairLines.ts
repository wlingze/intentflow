import type { DiffLine, SplitPair } from './diffSections';

// Words only: punctuation such as `: "` would make unrelated lines look alike.
const WORD = /[\p{L}\p{N}_$]+/gu;
/** Every pair earns this, so the alignment never leaves lines unpaired when
 *  the block has room; similarity only decides which lines go together. */
const PAIR = 1;
/** Blocks larger than this keep the cheap index pairing. */
const MAX_CELLS = 40000;

export interface BlockPairing {
  left?: DiffLine;
  right?: DiffLine;
}

function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().match(WORD) ?? []);
}

function dice(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared++;
  return (2 * shared) / (a.size + b.size);
}

/**
 * Pair deleted and added lines of one hunk block by content, not by position.
 * GitHub does the same: a whole-line replacement shows `title` next to `title`,
 * not next to whatever line happens to sit at the same offset.
 */
export function pairBlock(left: DiffLine[], right: DiffLine[]): BlockPairing[] {
  if (!left.length) return right.map((line) => ({ right: line }));
  if (!right.length) return left.map((line) => ({ left: line }));
  if (left.length * right.length > MAX_CELLS) {
    return Array.from({ length: Math.max(left.length, right.length) }, (_, index) => ({ left: left[index], right: right[index] }));
  }

  const leftTokens = left.map((line) => tokens(line.text));
  const rightTokens = right.map((line) => tokens(line.text));
  // best[i][j]: total similarity pairing left[i..] with right[j..].
  const width = right.length + 1;
  const best = new Float64Array((left.length + 1) * width);
  for (let i = left.length - 1; i >= 0; i--) {
    for (let j = right.length - 1; j >= 0; j--) {
      const take = PAIR + dice(leftTokens[i], rightTokens[j]) + best[(i + 1) * width + j + 1];
      best[i * width + j] = Math.max(best[(i + 1) * width + j], best[i * width + j + 1], take);
    }
  }

  const out: BlockPairing[] = [];
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const take = PAIR + dice(leftTokens[i], rightTokens[j]) + best[(i + 1) * width + j + 1];
    if (take >= best[(i + 1) * width + j] && take >= best[i * width + j + 1]) {
      out.push({ left: left[i++], right: right[j++] });
    } else if (best[(i + 1) * width + j] >= best[i * width + j + 1]) {
      out.push({ left: left[i++] });
    } else {
      out.push({ right: right[j++] });
    }
  }
  while (i < left.length) out.push({ left: left[i++] });
  while (j < right.length) out.push({ right: right[j++] });
  return out;
}

export function pairChangedBlock(left: DiffLine[], right: DiffLine[]): SplitPair[] {
  return pairBlock(left, right).map((pair) => ({ ...pair, changed: true }));
}
