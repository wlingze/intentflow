import type { DiffRow } from './diff';

/**
 * 一个改动块：连续若干行改动，加上前后 context 行。
 * gapBefore / gapAfter 是被折叠掉的未改行数，UI 用「展开」按钮显示。
 */
export interface Hunk {
  index: number;
  /** 该块第一行在整份逐行 diff 中的下标。 */
  start: number;
  rows: DiffRow[];
  /** 起始行在 before 文件的 1 起行号；新增文件为 0。 */
  beforeStart: number;
  /** 起始行在 after 文件的 1 起行号；删除文件为 0。 */
  afterStart: number;
  beforeLines: number;
  afterLines: number;
  /** 这个块之前的未改行数。 */
  gapBefore: number;
  /** 这个块之后、下一块之前的未改行数。 */
  gapAfter: number;
  adds: number;
  dels: number;
}

export interface HunkOptions {
  /** 每块上下保留的未改行数，默认 3，与 GitHub 一致。 */
  context?: number;
  /** 超过这个改动行数就分段，避免一个块渲染上万行。 */
  maxLines?: number;
}

const DEFAULT_CONTEXT = 3;
const DEFAULT_MAX_LINES = 400;

/**
 * 把逐行 diff 切成「只含改动 + context」的块。
 * 大文件里未被修改的部分不会进入结果，这是默认视图能快起来的原因。
 */
export function buildHunks(rows: DiffRow[], options: HunkOptions = {}): Hunk[] {
  const context = Math.max(0, options.context ?? DEFAULT_CONTEXT);
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES);
  const isChange = (row: DiffRow) => row.type !== 'equal';

  const hunks: Hunk[] = [];
  const changeStarts: number[] = [];
  const changeEnds: number[] = [];

  let index = 0;
  while (index < rows.length) {
    if (!isChange(rows[index])) {
      index++;
      continue;
    }
    const start = index;
    while (index < rows.length && isChange(rows[index])) index++;
    changeStarts.push(start);
    changeEnds.push(index);
  }
  if (changeStarts.length === 0) return [];

  // 合并间距小于 2*context 的改动块：中间那点未改行没必要单独折叠。
  const blocks: { start: number; end: number }[] = [{ start: changeStarts[0], end: changeEnds[0] }];
  for (let i = 1; i < changeStarts.length; i++) {
    const previous = blocks[blocks.length - 1];
    if (changeStarts[i] - previous.end <= context * 2) {
      previous.end = changeEnds[i];
    } else {
      blocks.push({ start: changeStarts[i], end: changeEnds[i] });
    }
  }

  let cursor = 0;
  for (const block of blocks) {
    const from = Math.max(0, block.start - context);
    const to = Math.min(rows.length, block.end + context);
    const gapBefore = Math.max(0, from - cursor);
    cursor = to;

    // 单个块太大的时候按 maxLines 拆开，保证每块都有限。
    for (let start = from; start < to; start += maxLines) {
      const end = Math.min(to, start + maxLines);
      const slice: DiffRow[] = rows.slice(start, end);
      const beforeLines = slice.reduce(
        (sum, row) => sum + (row.type === 'add' ? 0 : 1),
        0,
      );
      const afterLines = slice.reduce(
        (sum, row) => sum + (row.type === 'del' ? 0 : 1),
        0,
      );
      hunks.push({
        index: hunks.length,
        rows: slice,
        start,
        beforeStart: firstLine(slice, 'a'),
        afterStart: firstLine(slice, 'b'),
        beforeLines,
        afterLines,
        gapBefore: hunks.length === 0 ? gapBefore : 0,
        gapAfter: 0,
        adds: slice.filter((row) => row.type === 'add').length,
        dels: slice.filter((row) => row.type === 'del').length,
      });
    }
  }

  for (let i = 0; i < hunks.length; i++) {
    const next = hunks[i + 1];
    const endIndex = hunks[i].start + hunks[i].rows.length;
    const nextStart = next ? next.start : rows.length;
    hunks[i].gapAfter = Math.max(0, nextStart - endIndex);
  }
  return hunks;
}

function firstLine(rows: DiffRow[], side: 'a' | 'b'): number {
  for (const row of rows) {
    if (side === 'a' && 'a' in row) return row.a.n;
    if (side === 'b' && 'b' in row) return row.b.n;
  }
  return 0;
}

/** 整份 diff 的统计，用于文件头。 */
export function hunkStats(hunks: Hunk[]): { adds: number; dels: number } {
  return hunks.reduce(
    (acc, hunk) => ({ adds: acc.adds + hunk.adds, dels: acc.dels + hunk.dels }),
    { adds: 0, dels: 0 },
  );
}
