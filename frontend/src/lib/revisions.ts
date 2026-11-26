import type { RevisionList } from '../types';

/**
 * Keep the current revision after a refresh. When the worktree entry is gone
 * (all changes reverted or committed), fall back to the server's current entry
 * and finally to the first available revision.
 */
export function pickRevision(id: string, list: RevisionList): string {
  if (list.revisions.some((revision) => revision.id === id)) return id;
  if (list.revisions.some((revision) => revision.id === list.current)) return list.current;
  return list.revisions[0]?.id ?? id;
}
