/** Row heights used by the virtualizer, in CSS pixels. */
export const LINE_HEIGHT = 22;
export const HUNK_HEIGHT = 26;
export const GAP_HEIGHT = 32;
/** Average glyph width for a 12px monospace face; only used for wrap estimates. */
const CHARS_PER_EM = 0.6;

export interface HeightableItem {
  type: 'gap' | 'header' | 'line';
  text?: string;
}

/**
 * Height estimate for one rendered item. Non-wrapped rows are exact, so the
 * card height never changes while rows mount; that keeps the scroll position
 * still. Wrapped rows are estimated from the character count.
 */
export function estimateItem(item: HeightableItem, wrap: boolean, widthPx: number, text = ''): number {
  if (item.type === 'gap') return GAP_HEIGHT;
  if (item.type === 'header') return HUNK_HEIGHT;
  if (!wrap) return LINE_HEIGHT;
  const charactersPerLine = Math.max(20, Math.floor(widthPx / (12 * CHARS_PER_EM)));
  const visualLines = Math.max(1, Math.ceil(text.replaceAll('\t', '    ').length / charactersPerLine));
  return LINE_HEIGHT * visualLines;
}