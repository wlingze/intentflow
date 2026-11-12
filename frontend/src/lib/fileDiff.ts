import { diffLines, diffStats } from './diff';
import { buildHunks } from './hunks';
import type { CodeFile } from '../types';

/** Payload files are immutable. Share line alignment across tree, cards and file view. */
const cache = new WeakMap<CodeFile, ReturnType<typeof compute>>();
function compute(file: CodeFile) {
  const rows = diffLines(file.before ?? '', file.after ?? '');
  return { rows, stats: diffStats(rows), hunks: buildHunks(rows, { maxLines: Number.MAX_SAFE_INTEGER }) };
}
export function fileDiff(file: CodeFile) {
  let value = cache.get(file);
  if (!value) {
    value = compute(file);
    cache.set(file, value);
  }
  return value;
}
