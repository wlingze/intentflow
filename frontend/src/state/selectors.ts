import { useMemo } from 'react';
import { fileDiff } from '../lib/fileDiff';
import { fileDigest } from '../lib/hash';
import { buildTree, flattenTree } from '../lib/tree';
import { useApp } from './AppProvider';

export function useReviewData() {
  const { payload } = useApp();
  return useMemo(() => {
    const changed = payload?.code.files.filter((file) => file.status !== 'unchanged') ?? [];
    // Sidebar and diff cards must share one order. The sidebar's tree order wins.
    const rank = new Map(flattenTree(buildTree(changed, true)).map((path, index) => [path, index]));
    const files = [...changed].sort((left, right) => (rank.get(left.path) ?? 0) - (rank.get(right.path) ?? 0));
    const stats = new Map(files.map((file) => [file.path, fileDiff(file).stats]));
    const digests = new Map(files.map((file) => [file.path, fileDigest(file.path, file.before, file.after)]));
    return { files, stats, digests, truncated: payload?.code.truncated ?? false, skipped: payload?.code.skipped.length ?? 0 };
  }, [payload?.code]);
}
