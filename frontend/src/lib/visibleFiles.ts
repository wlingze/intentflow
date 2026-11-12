/**
 * Diff pane bookkeeping: which cards are on screen, and which are close enough
 * to mount their rows. Both lists are sorted so a new array is only produced
 * when the set really changed; the tree re-renders on every store update.
 */
export function sortedPaths(paths: Iterable<string>): string[] {
  return [...paths].sort();
}

export function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}
