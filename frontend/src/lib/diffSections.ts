import type { DiffRow } from './diff';
import type { Hunk } from './hunks';

export interface Expansion { top: number; bottom: number }
export interface DiffSection { type: 'code' | 'gap'; start: number; end: number; key: number; leading?: boolean; trailing?: boolean }

/**
 * Every unchanged interval becomes one gap. A gap has two independent ends:
 * `top` lines revealed next to the hunk above, `bottom` lines revealed next
 * to the hunk below. Both counters only grow, and the gap closes when the
 * two ends meet.
 */
export function diffSections(rows: DiffRow[], hunks: Hunk[], expanded: Record<number, Expansion>): DiffSection[] {
  if (!hunks.length) return rows.length ? [{ type: 'code', start: 0, end: rows.length, key: 0 }] : [];
  const result: DiffSection[] = [];
  let cursor = 0;
  const gap = (start: number, end: number) => {
    if (start >= end) return;
    const extra = expanded[start] ?? { top: 0, bottom: 0 };
    const top = Math.min(end, start + extra.top);
    const bottom = Math.max(top, end - extra.bottom);
    if (start < top) result.push({ type: 'code', start, end: top, key: start });
    if (top < bottom) result.push({ type: 'gap', start: top, end: bottom, key: start, leading: start === 0, trailing: end === rows.length });
    if (bottom < end) result.push({ type: 'code', start: bottom, end, key: bottom });
  };
  for (const hunk of hunks) {
    gap(cursor, hunk.start);
    result.push({ type: 'code', start: hunk.start, end: hunk.start + hunk.rows.length, key: hunk.start });
    cursor = hunk.start + hunk.rows.length;
  }
  gap(cursor, rows.length);
  // Join adjacent ranges so a replacement block cannot be paired across a fake boundary.
  return result.reduce<DiffSection[]>((out, item) => {
    const previous = out.at(-1);
    if (previous?.type === 'code' && item.type === 'code' && previous.end === item.start) previous.end = item.end;
    else out.push({ ...item });
    return out;
  }, []);
}

export interface DiffLine { n: number; text: string }
export interface SplitPair { left?: DiffLine; right?: DiffLine; changed: boolean }
export function splitPairs(rows: DiffRow[]): SplitPair[] {
  const pairs: SplitPair[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row.type === 'equal') { pairs.push({ left: row.a, right: row.b, changed: false }); index++; continue; }
    const left: DiffLine[] = []; const right: DiffLine[] = [];
    while (index < rows.length && rows[index].type !== 'equal') {
      const next = rows[index++];
      if (next.type === 'del') left.push(next.a);
      else if (next.type === 'add') right.push(next.b);
    }
    for (let i = 0; i < Math.max(left.length, right.length); i++) pairs.push({ left: left[i], right: right[i], changed: true });
  }
  return pairs;
}
