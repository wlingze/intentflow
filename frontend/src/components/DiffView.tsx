import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { diffLines, type DiffRow } from '../lib/diff';
import { highlight } from '../lib/highlight';
import type { CodeFile, Quote, Side } from '../types';
import styles from './DiffView.module.css';

type Layout = 'split' | 'unified';

interface Line {
  n: number;
  text: string;
}

interface Pair {
  left?: Line;
  right?: Line;
  leftType?: 'del';
  rightType?: 'add';
}

interface SelectionState {
  quote: Quote;
  x: number;
  y: number;
}

interface Props {
  file: CodeFile;
  layout: Layout;
  targetLine?: number;
  targetSide?: Side;
  onQuote: (quote: Quote) => void;
}

function lineContent(text: string, language?: string): string {
  return highlight(text, language) || '&nbsp;';
}

function elementOf(node: Node): Element | null {
  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function lineElement(element: Element | null): { side: Side; line: number } | null {
  const target = element?.closest('[data-line]');
  if (!target) return null;
  const side = target.getAttribute('data-side');
  const line = Number(target.getAttribute('data-line'));
  if ((side !== 'before' && side !== 'after') || !Number.isFinite(line)) return null;
  return { side, line };
}

function pairRows(rows: DiffRow[]): Pair[] {
  const out: Pair[] = [];
  let index = 0;
  while (index < rows.length) {
    const row = rows[index];
    if (row.type === 'equal') {
      out.push({ left: row.a, right: row.b });
      index++;
      continue;
    }
    const dels: Line[] = [];
    const adds: Line[] = [];
    while (index < rows.length && rows[index].type !== 'equal') {
      const inner = rows[index];
      if (inner.type === 'del') dels.push(inner.a);
      else adds.push(inner.b);
      index++;
    }
    const max = Math.max(dels.length, adds.length);
    for (let offset = 0; offset < max; offset++) {
      out.push({
        left: dels[offset],
        right: adds[offset],
        leftType: dels[offset] ? 'del' : undefined,
        rightType: adds[offset] ? 'add' : undefined,
      });
    }
  }
  return out;
}

export function DiffView({ file, layout, targetLine, targetSide, onQuote }: Props) {
  const rows = useMemo(() => diffLines(file.before ?? '', file.after ?? ''), [file]);
  const pairs = useMemo(() => pairRows(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<SelectionState | null>(null);

  const codeWidth = useMemo(() => {
    let max = 0;
    for (const row of rows) {
      const left = 'a' in row ? row.a.text.length : 0;
      const right = 'b' in row ? row.b.text.length : 0;
      max = Math.max(max, left, right);
    }
    return Math.max(340, Math.min(1200, Math.ceil(max * 7.2)));
  }, [rows]);

  const vars = {
    '--split-cols': `46px ${codeWidth}px 46px ${codeWidth}px`,
    '--unified-cols': `44px 44px 20px ${codeWidth}px`,
  } as CSSProperties;

  useEffect(() => {
    if (!targetLine) return;
    const container = scrollRef.current;
    const side = targetSide ?? 'after';
    const target = container?.querySelector(
      `[data-side="${side}"][data-line="${targetLine}"]`,
    );
    if (!container || !target) return;
    // 只纵向滚动。scrollIntoView 会为了露出目标行而横向平移，
    // 把 split 视图的 before 半栏推出可视区。
    const box = container.getBoundingClientRect();
    const rect = target.getBoundingClientRect();
    const top = container.scrollTop + rect.top - box.top - container.clientHeight / 2 + rect.height / 2;
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [file.path, targetLine, targetSide, layout]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const hide = () => setSelection(null);
    element.addEventListener('scroll', hide);
    return () => element.removeEventListener('scroll', hide);
  }, []);

  useEffect(() => {
    if (!selection) return;
    const hide = () => setSelection(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') hide();
    };
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [selection]);

  const handleMouseUp = () => {
    const browserSelection = window.getSelection();
    if (!browserSelection || browserSelection.isCollapsed) return;
    const range = browserSelection.getRangeAt(0);
    const anchor = lineElement(elementOf(range.startContainer));
    const focus = lineElement(elementOf(range.endContainer));
    if (!anchor && !focus) return;

    const start = anchor ?? focus!;
    const end = focus ?? anchor!;
    const side = start.side;
    const startLine = Math.min(start.line, end.line);
    const endLine = Math.max(start.line, end.line);
    const snippet = browserSelection.toString().trim().slice(0, 700);
    if (!snippet) return;
    const rect = range.getBoundingClientRect();
    setSelection({
      quote: { file: file.path, side, start: startLine, end: endLine, snippet },
      x: rect.left + rect.width / 2,
      y: rect.top,
    });
  };

  const addQuote = () => {
    if (!selection) return;
    onQuote(selection.quote);
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  const isTarget = (side: Side, line: number) =>
    Boolean(targetLine && line === targetLine && side === (targetSide ?? 'after'));

  return (
    <div className={styles.wrapper} onMouseUp={handleMouseUp}>
      {file.status === 'unchanged' && (
        <div className={styles.notice}>文件未变更，下面是两侧相同的内容。</div>
      )}

      <div className={styles.scroll} ref={scrollRef} style={vars}>
        {layout === 'split' ? (
          <div className={styles.split}>
            <div className={styles.splitHead}>
              <span />
              <span>before</span>
              <span />
              <span>after</span>
            </div>
            {pairs.map((pair, index) => (
              <div className={styles.row} key={`${index}-${pair.left?.n ?? 'x'}-${pair.right?.n ?? 'x'}`}>
                <div className={`${styles.gutter} ${pair.leftType === 'del' ? styles.gutterDel : ''}`}>
                  {pair.left?.n ?? ''}
                </div>
                <div
                  className={`${styles.cell} ${pair.leftType === 'del' ? styles.del : ''} ${
                    !pair.left ? (pair.rightType === 'add' ? styles.blankAdd : styles.blank) : ''
                  }`}
                >
                  {pair.left && (
                    <span
                      className={`${styles.code} ${isTarget('before', pair.left.n) ? styles.target : ''}`}
                      data-side="before"
                      data-line={pair.left.n}
                      dangerouslySetInnerHTML={{ __html: lineContent(pair.left.text, file.language) }}
                    />
                  )}
                </div>
                <div className={`${styles.gutter} ${pair.rightType === 'add' ? styles.gutterAdd : ''}`}>
                  {pair.right?.n ?? ''}
                </div>
                <div
                  className={`${styles.cell} ${pair.rightType === 'add' ? styles.add : ''} ${
                    !pair.right ? (pair.leftType === 'del' ? styles.blankDel : styles.blank) : ''
                  }`}
                >
                  {pair.right && (
                    <span
                      className={`${styles.code} ${isTarget('after', pair.right.n) ? styles.target : ''}`}
                      data-side="after"
                      data-line={pair.right.n}
                      dangerouslySetInnerHTML={{ __html: lineContent(pair.right.text, file.language) }}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className={styles.unified}>
            <div className={styles.unifiedHead}>
              <span>old</span>
              <span>new</span>
              <span />
              <span>code</span>
            </div>
            {rows.map((row, index) => {
              const oldLine = row.type === 'add' ? undefined : row.a;
              const newLine = row.type === 'del' ? undefined : row.b;
              const side: Side = row.type === 'del' ? 'before' : 'after';
              const line = row.type === 'del' ? oldLine?.n : newLine?.n;
              return (
                <div className={styles.row} key={`${index}-${row.type}`}>
                  <div className={styles.gutter}>{oldLine?.n ?? ''}</div>
                  <div className={styles.gutter}>{newLine?.n ?? ''}</div>
                  <div className={`${styles.sign} ${row.type === 'add' ? styles.signAdd : row.type === 'del' ? styles.signDel : ''}`}>
                    {row.type === 'add' ? '+' : row.type === 'del' ? '−' : ''}
                  </div>
                  <div className={`${styles.cell} ${row.type === 'add' ? styles.add : row.type === 'del' ? styles.del : ''}`}>
                    <span
                      className={`${styles.code} ${line && isTarget(side, line) ? styles.target : ''}`}
                      data-side={side}
                      data-line={line ?? 0}
                      dangerouslySetInnerHTML={{
                        __html: lineContent(newLine?.text ?? oldLine?.text ?? '', file.language),
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {selection && (
        <div
          className={styles.selectionBar}
          style={{ left: selection.x, top: selection.y - 42 }}
          onMouseDown={(event) => event.stopPropagation()}
          onMouseUp={(event) => event.stopPropagation()}
        >
          <button type="button" className="btn btnSmall btnPrimary" onClick={addQuote}>
            添加评论
          </button>
        </div>
      )}
    </div>
  );
}
