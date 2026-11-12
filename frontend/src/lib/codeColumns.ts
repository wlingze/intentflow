/** Display columns, with tab stops relative to the source, not the +/- marker. */
export function codeColumns(text = ''): number {
  let column = 0;
  for (const char of text) {
    if (char === '\t') column += 4 - (column % 4);
    else column += char.codePointAt(0)! >= 0x1100 ? 2 : 1;
  }
  return column;
}
