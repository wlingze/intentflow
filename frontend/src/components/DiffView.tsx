import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import { diffLines, type DiffRow } from '../lib/diff';
import { highlight } from '../lib/highlight';
import { RowVirtualizer } from '../lib/virtual';
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
  wrap?: boolean;
  targetLine?: number;
  targetSide?: Side;
  onQuote: (quote: Quote) => void;
}

const OVERSCAN = 12;
const ROW_HEIGHT = 20;

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

export function DiffView({
  file,
  layout,
  wrap = false,
  targetLine,
  targetSide,
  onQuote,
}: Props) {
  const rows = useMemo(() => diffLines(file.before ?? '', file.after ?? ''), [file]);
  const pairs = useMemo(() => pairRows(rows), [rows]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const observedRows = useRef<Set<Element>>(new Set());
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [headerHeight, setHeaderHeight] = useState(0);
  const [measureVersion, setMeasureVersion] = useState(0);

  const rowCount = layout === 'split' ? pairs.length : rows.length;
  const virtual = useMemo(
    () => new RowVirtualizer(rowCount, ROW_HEIGHT),
    [rowCount, file.path, layout, wrap, rows, pairs],
  );

  // 只渲染滚动视口（含 overscan）内的行；固定行高时全部使用同一个估算值。
  const contentTop = Math.max(0, scrollTop - headerHeight);
  const visibleHeight = Math.max(
    0,
    viewportHeight - Math.max(0, headerHeight - scrollTop),
  );
  const view = useMemo(
    () => virtual.window(contentTop, visibleHeight, OVERSCAN),
    [virtual, contentTop, visibleHeight, measureVersion],
  );
  const paddingBottom = Math.max(0, view.totalHeight - virtual.offsetOf(view.end));

  const lineIndex = useMemo(() => {
    const before = new Map<number, number>();
    const after = new Map<number, number>();
    if (layout === 'split') {
      pairs.forEach((pair, index) => {
        if (pair.left) before.set(pair.left.n, index);
        if (pair.right) after.set(pair.right.n, index);
      });
    } else {
      rows.forEach((row, index) => {
        if (row.type === 'del') before.set(row.a.n, index);
        if (row.type !== 'del') after.set(row.b.n, index);
      });
    }
    return { before, after };
  }, [layout, pairs, rows]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const sync = () => {
      setScrollTop(element.scrollTop);
      setViewportHeight(element.clientHeight);
    };
    sync();
    element.addEventListener('scroll', sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => {
      element.removeEventListener('scroll', sync);
      observer.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const element = headRef.current;
    if (!element) return;
    const sync = () => setHeaderHeight(element.offsetHeight);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(element);
    return () => observer.disconnect();
  }, [layout]);

  useEffect(() => {
    if (!wrap) return;
    const pending = new Map<number, number>();
    let frame = 0;
    const flush = () => {
      frame = 0;
      let changed = false;
      for (const [index, height] of pending) {
        if (virtual.setHeight(index, height)) changed = true;
      }
      pending.clear();
      if (changed) setMeasureVersion((value) => value + 1);
    };
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const element = entry.target as HTMLElement;
        const index = Number(element.dataset.rowIndex);
        if (!Number.isInteger(index)) continue;
        const height = entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
        if (height > 0) pending.set(index, height);
      }
      if (!frame) frame = requestAnimationFrame(flush);
    });
    observerRef.current = observer;
    observedRows.current = new Set();
    return () => {
      observer.disconnect();
      observerRef.current = null;
      observedRows.current = new Set();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [wrap, virtual]);

  useEffect(() => {
    const observer = observerRef.current;
    const container = scrollRef.current;
    if (!observer || !container) return;
    const next = new Set<Element>();
    container.querySelectorAll<HTMLElement>('[data-row-index]').forEach((element) => {
      next.add(element);
      if (!observedRows.current.has(element)) observer.observe(element);
    });
    for (const element of observedRows.current) {
      if (!next.has(element)) observer.unobserve(element);
    }
    observedRows.current = next;
  });

  useEffect(() => {
    if (!targetLine) return;
    const container = scrollRef.current;
    if (!container) return;
    const side = targetSide ?? 'after';
    const index = (side === 'before' ? lineIndex.before : lineIndex.after).get(targetLine);
    if (index === undefined) return;
    const header = headRef.current?.offsetHeight ?? headerHeight;
    const center = virtual.offsetOf(index) + virtual.heightOf(index) / 2;
    const visible = container.clientHeight - header;
    const top = header + center - visible / 2;
    // 只纵向滚动，避免把 split 视图的 before 半栏横向推走。
    container.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, [file.path, targetLine, targetSide, layout, lineIndex, virtual, headerHeight]);

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

  const codeWidth = useMemo(() => {
    if (wrap) return 0;
    let max = 0;
    for (const row of rows) {
      const left = 'a' in row ? row.a.text.length : 0;
      const right = 'b' in row ? row.b.text.length : 0;
      max = Math.max(max, left, right);
    }
    return Math.max(340, Math.min(1200, Math.ceil(max * 7.2)));
  }, [rows, wrap]);

  const vars = {
    '--split-cols': `46px ${codeWidth}px 46px ${codeWidth}px`,
    '--unified-cols': `44px 44px 20px ${codeWidth}px`,
  } as CSSProperties;

  const visiblePairs = pairs.slice(view.start, view.end);
  const visibleRows = rows.slice(view.start, view.end);

  return (
    <div className={`${styles.wrapper}${wrap ? ` ${styles.wrap}` : ''}`} onMouseUp={handleMouseUp}>
      {file.status === 'unchanged' && (
        <div className={styles.notice}>文件未变更，下面是两侧相同的内容。</div>
      )}

      <div className={styles.scroll} ref={scrollRef} style={vars}>
        {layout === 'split' ? (
          <div className={styles.split}>
            <div className={styles.splitHead} ref={headRef}>
              <span />
              <span>before</span>
              <span />
              <span>after</span>
            </div>
            <div
              className={styles.virtual}
              style={{ paddingTop: view.top, paddingBottom }}
            >
              {visiblePairs.map((pair, offset) => {
                const index = view.start + offset;
                return (
                  <div
                    className={styles.row}
                    data-row-index={index}
                    key={`${index}-${pair.left?.n ?? 'x'}-${pair.right?.n ?? 'x'}`}
                  >
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
                );
              })}
            </div>
          </div>
        ) : (
          <div className={styles.unified}>
            <div className={styles.unifiedHead} ref={headRef}>
              <span>old</span>
              <span>new</span>
              <span />
              <span>code</span>
            </div>
            <div
              className={styles.virtual}
              style={{ paddingTop: view.top, paddingBottom }}
            >
              {visibleRows.map((row, offset) => {
                const index = view.start + offset;
                const oldLine = row.type === 'add' ? undefined : row.a;
                const newLine = row.type === 'del' ? undefined : row.b;
                const side: Side = row.type === 'del' ? 'before' : 'after';
                const line = row.type === 'del' ? oldLine?.n : newLine?.n;
                return (
                  <div className={styles.row} data-row-index={index} key={`${index}-${row.type}`}>
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
