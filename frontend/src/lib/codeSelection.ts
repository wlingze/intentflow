// Virtualized rows cannot hold a native selection while they scroll out of
// view, so the diff keeps its own line range. The last text is cached here for
// other widgets, e.g. Ctrl+F prefill.
let latest = '';

export function setCodeSelection(text: string): void {
  latest = text;
}

export function codeSelection(): string {
  return latest;
}

export function clearCodeSelection(): void {
  latest = '';
}
