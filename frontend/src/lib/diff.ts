export type DiffRow =
  | { type: 'equal'; a: { n: number; text: string }; b: { n: number; text: string } }
  | { type: 'del'; a: { n: number; text: string } }
  | { type: 'add'; b: { n: number; text: string } };

export interface DiffStats {
  adds: number;
  dels: number;
}

interface Occurrence {
  count: number;
  index: number;
}

interface EditOp {
  type: 'equal' | 'del' | 'add';
  a: number;
  b: number;
}

// 没有唯一锚点的区域最多展开这么多编辑距离；超过就把整段视为替换。
const MAX_EDIT_DISTANCE = 2000;

export function diffLines(before: string, after: string): DiffRow[] {
  const a = before === '' ? [] : before.split('\n');
  const b = after === '' ? [] : after.split('\n');
  const rows: DiffRow[] = [];
  diffRange(a, 0, a.length, b, 0, b.length, rows);
  return rows;
}

function diffRange(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
  out: DiffRow[],
): void {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    pushEqual(out, a, aLo, b, bLo);
    aLo++;
    bLo++;
  }

  let suffix = 0;
  while (
    aHi - suffix > aLo &&
    bHi - suffix > bLo &&
    a[aHi - suffix - 1] === b[bHi - suffix - 1]
  ) {
    suffix++;
  }

  diffMiddle(a, aLo, aHi - suffix, b, bLo, bHi - suffix, out);

  const aSuffix = aHi - suffix;
  const bSuffix = bHi - suffix;
  for (let offset = 0; offset < suffix; offset++) {
    pushEqual(out, a, aSuffix + offset, b, bSuffix + offset);
  }
}

function diffMiddle(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
  out: DiffRow[],
): void {
  if (aLo === aHi) {
    for (let j = bLo; j < bHi; j++) pushAdd(out, b, j);
    return;
  }
  if (bLo === bHi) {
    for (let i = aLo; i < aHi; i++) pushDel(out, a, i);
    return;
  }

  const anchors = patienceAnchors(a, aLo, aHi, b, bLo, bHi);
  if (anchors.a.length === 0) {
    const ops = boundedMyers(a, aLo, aHi, b, bLo, bHi, MAX_EDIT_DISTANCE);
    if (!ops) {
      for (let i = aLo; i < aHi; i++) pushDel(out, a, i);
      for (let j = bLo; j < bHi; j++) pushAdd(out, b, j);
      return;
    }
    for (const op of ops) {
      if (op.type === 'equal') pushEqual(out, a, aLo + op.a, b, bLo + op.b);
      else if (op.type === 'del') pushDel(out, a, aLo + op.a);
      else pushAdd(out, b, bLo + op.b);
    }
    return;
  }

  let aCursor = aLo;
  let bCursor = bLo;
  for (let anchor = 0; anchor < anchors.a.length; anchor++) {
    const ai = anchors.a[anchor];
    const bi = anchors.b[anchor];
    diffRange(a, aCursor, ai, b, bCursor, bi, out);
    pushEqual(out, a, ai, b, bi);
    aCursor = ai + 1;
    bCursor = bi + 1;
  }
  diffRange(a, aCursor, aHi, b, bCursor, bHi, out);
}

function pushEqual(out: DiffRow[], a: string[], ai: number, b: string[], bi: number): void {
  out.push({ type: 'equal', a: { n: ai + 1, text: a[ai] }, b: { n: bi + 1, text: b[bi] } });
}

function pushDel(out: DiffRow[], a: string[], ai: number): void {
  out.push({ type: 'del', a: { n: ai + 1, text: a[ai] } });
}

function pushAdd(out: DiffRow[], b: string[], bi: number): void {
  out.push({ type: 'add', b: { n: bi + 1, text: b[bi] } });
}

/**
 * patience/histogram 锚点：只保留两侧都恰好出现一次的行，再对匹配位置求 LIS。
 * 返回的两个数组按下标一一对应且严格递增。
 */
function patienceAnchors(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
): { a: number[]; b: number[] } {
  const aCounts = countOccurrences(a, aLo, aHi);
  const bCounts = countOccurrences(b, bLo, bHi);
  const aIndexes: number[] = [];
  const bIndexes: number[] = [];

  for (let i = aLo; i < aHi; i++) {
    const text = a[i];
    if (aCounts.get(text)?.count !== 1) continue;
    const other = bCounts.get(text);
    if (other?.count !== 1) continue;
    aIndexes.push(i);
    bIndexes.push(other.index);
  }

  if (aIndexes.length === 0) return { a: [], b: [] };

  const keep = longestIncreasingSubsequence(bIndexes);
  return {
    a: keep.map((index) => aIndexes[index]),
    b: keep.map((index) => bIndexes[index]),
  };
}

function countOccurrences(lines: string[], lo: number, hi: number): Map<string, Occurrence> {
  const counts = new Map<string, Occurrence>();
  for (let i = lo; i < hi; i++) {
    const text = lines[i];
    const found = counts.get(text);
    if (found) found.count++;
    else counts.set(text, { count: 1, index: i });
  }
  return counts;
}

/** 返回 values 中一个最长严格递增子序列的下标。 */
function longestIncreasingSubsequence(values: number[]): number[] {
  const tails: number[] = [];
  const previous = new Int32Array(values.length).fill(-1);

  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    let lo = 0;
    let hi = tails.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (values[tails[mid]] < value) lo = mid + 1;
      else hi = mid;
    }
    if (lo > 0) previous[i] = tails[lo - 1];
    tails[lo] = i;
  }

  const keep: number[] = [];
  let cursor = tails.length > 0 ? tails[tails.length - 1] : -1;
  while (cursor >= 0) {
    keep.push(cursor);
    cursor = previous[cursor];
  }
  keep.reverse();
  return keep;
}

/**
 * 有界 Myers：编辑距离超过 maxD 时返回 null，由调用方整体降级为删除块+新增块。
 * 回溯所需的历史 V 向量按 d 保存；索引以区域起点为 0。
 */
function boundedMyers(
  a: string[],
  aLo: number,
  aHi: number,
  b: string[],
  bLo: number,
  bHi: number,
  maxD: number,
): EditOp[] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const limit = Math.min(maxD, n + m);
  const offset = limit + 1;
  const v = new Int32Array(2 * limit + 3).fill(-1);
  v[offset + 1] = 0;
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1];
      } else {
        x = v[offset + k - 1] + 1;
      }
      let y = x - k;
      while (x < n && y < m && a[aLo + x] === b[bLo + y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        return backtrack(trace, d, n, m, offset);
      }
    }
  }
  return null;
}

function backtrack(
  trace: Int32Array[],
  found: number,
  n: number,
  m: number,
  offset: number,
): EditOp[] {
  const ops: EditOp[] = [];
  let x = n;
  let y = m;

  for (let d = found; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    let previousK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      previousK = k + 1;
    } else {
      previousK = k - 1;
    }
    const previousX = v[offset + previousK];
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      ops.push({ type: 'equal', a: x - 1, b: y - 1 });
      x--;
      y--;
    }
    if (x === previousX) {
      ops.push({ type: 'add', a: x, b: y - 1 });
      y--;
    } else {
      ops.push({ type: 'del', a: x - 1, b: y });
      x--;
    }
  }

  while (x > 0 && y > 0) {
    ops.push({ type: 'equal', a: x - 1, b: y - 1 });
    x--;
    y--;
  }
  while (x > 0) {
    ops.push({ type: 'del', a: x - 1, b: 0 });
    x--;
  }
  while (y > 0) {
    ops.push({ type: 'add', a: 0, b: y - 1 });
    y--;
  }

  ops.reverse();
  return ops;
}

export function diffStats(rows: DiffRow[]): DiffStats {
  let adds = 0;
  let dels = 0;
  for (const row of rows) {
    if (row.type === 'add') adds++;
    else if (row.type === 'del') dels++;
  }
  return { adds, dels };
}
