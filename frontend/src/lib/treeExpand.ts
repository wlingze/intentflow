import { autoExpanded, type TreeNode } from './tree';

// One entry per comparison: what is open in one diff must not follow the user
// into the next one.
const PREFIX = 'intentflow.tree-open.';

export function loadTreeOpen(comparison: string): Set<string> | null {
  if (!comparison) return null;
  try {
    const raw = localStorage.getItem(PREFIX + comparison);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    return new Set(parsed.filter((entry): entry is string => typeof entry === 'string'));
  } catch {
    return null;
  }
}

export function saveTreeOpen(comparison: string, open: Iterable<string>): void {
  if (!comparison) return;
  try {
    localStorage.setItem(PREFIX + comparison, JSON.stringify([...open]));
  } catch {
    // 隐私模式 / 配额满时静默降级。
  }
}

/** Directories to show on first open: the last manual choice wins over the default rule. */
export function initialExpanded(comparison: string, nodes: TreeNode[]): Set<string> {
  return loadTreeOpen(comparison) ?? autoExpanded(nodes);
}

/** Apply one manual toggle; the same set comes back when nothing changes. */
export function toggleDir(open: Set<string>, path: string, isOpen: boolean): Set<string> {
  if (open.has(path) === isOpen) return open;
  const next = new Set(open);
  if (isOpen) next.add(path);
  else next.delete(path);
  return next;
}