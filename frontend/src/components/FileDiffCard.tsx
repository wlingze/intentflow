import { memo, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { fileDiff } from '../lib/fileDiff';
import { diffSections, growExpansion, splitPairs, type DiffLine, type DiffSection, type Expansion, type SplitPair } from '../lib/diffSections';
import type { Hunk } from '../lib/hunks';
import type { DiffRow, DiffStats } from '../lib/diff';
import { cx } from '../lib/format';
import { hashText } from '../lib/hash';
import { useImagePaste } from '../hooks/useImagePaste';
import { highlight } from '../lib/highlight';
import { clearCodeSelection, setCodeSelection } from '../lib/codeSelection';
import { codeColumns } from '../lib/codeColumns';
import { DiffHorizontalScroll } from './DiffHorizontalScroll';
import { uid } from '../lib/id';
import { useDiffWindow } from '../hooks/useDiffWindow';
import { useAppDispatch } from '../state/AppProvider';
import type { CodeFile, Comment, Side } from '../types';
import { CommentCard } from './CommentCard';
import { IconChevronDown, IconChevronRight, IconLocate } from './Icons';
import { FileIcon } from './FileTypeIcon';
import styles from './FileDiffCard.module.css';

type Layout = 'split' | 'unified';
interface Props {
  file: CodeFile;
  layout: Layout;
  wrap: boolean;
  viewed: boolean;
  digest: string;
  stat: DiffStats;
  /** All comments; the card keeps only the ones quoting this file. */
  comments: Comment[];
  /** All reviewed hunk keys; the card keeps only its own. */
  reviewedHunks: string[];
  targetLine?: number;
  targetSide?: Side;
  defaultOpen?: boolean;
  revealToken?: number;
  word: string;
}
type Item = { type: 'gap'; section: DiffSection } | { type: 'header'; text: string; key: number; hash: string } | { type: 'line'; pair?: SplitPair; row?: DiffRow };
const STATUS = { added: '新增', removed: '删除', modified: '修改', unchanged: '未变', renamed: '重命名' };
const EMPTY: Record<number, Expansion> = {};
const EMPTY_ROWS: DiffRow[] = [];
const EMPTY_HUNKS: Hunk[] = [];
// Row range picked by dragging. `side` fixes the column in split view; unified
// has one side per row, so it spans whatever side each row carries.
interface PickedRange { side: Side; anchor: number; focus: number }

function pickedRows(range: PickedRange | null): [number, number] | null {
  return range ? [Math.min(range.anchor, range.focus), Math.max(range.anchor, range.focus)] : null;
}

function isPicked(range: PickedRange | null, row: number, side: Side): boolean {
  const span = pickedRows(range);
  if (!span || !range || row < span[0] || row > span[1]) return false;
  // Split view shows both sides per row; only the picked column is marked.
  return range.side === side;
}

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

function isWordChar(char: string | undefined): boolean {
  return !!char && WORD_CHAR.test(char);
}

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

// Single click on code picks the identifier under the pointer. A drag-select
// is left alone, so copying text does not change the highlight.
function wordAtPoint(event: ReactMouseEvent<HTMLElement>, source: HTMLElement, line: string): string | null {
  if (event.detail !== 1) return null;
  if (!source.contains(event.target as Node)) return '';
  if (!line) return '';
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim()) return null;
  const doc = document as CaretDocument;
  let container: Node | null = null;
  let offset = 0;
  const range = doc.caretRangeFromPoint?.(event.clientX, event.clientY);
  if (range) {
    container = range.startContainer;
    offset = range.startOffset;
  } else {
    const position = doc.caretPositionFromPoint?.(event.clientX, event.clientY);
    if (position) {
      container = position.offsetNode;
      offset = position.offset;
    }
  }
  if (!container || !source.contains(container)) return '';
  const before = document.createRange();
  before.selectNodeContents(source);
  before.setEnd(container, offset);
  let index = before.toString().length;
  if (index >= line.length) index = line.length - 1;
  if (!isWordChar(line[index]) && index > 0 && isWordChar(line[index - 1])) index--;
  if (!isWordChar(line[index])) return '';
  let start = index;
  let end = index + 1;
  while (start > 0 && isWordChar(line[start - 1])) start--;
  while (end < line.length && isWordChar(line[end])) end++;
  return line.slice(start, end);
}

function lineOf(row: Element | null, side: Side): HTMLElement | null {
  return row ? row.querySelector<HTMLElement>(`[data-line][data-side="${side}"]`) : null;
}

// Closest row to the pointer. Using distance instead of hit-testing keeps
// the drag alive over gaps, hunk headers and the edge of the viewport, where
// nothing is under the pointer but the range should still extend.
function rowNear(root: HTMLElement, y: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const row of root.querySelectorAll<HTMLElement>('[data-virtual-row]')) {
    const rect = row.getBoundingClientRect();
    const next = y < rect.top ? rect.top - y : y > rect.bottom ? y - rect.bottom : 0;
    if (next < distance) { best = row; distance = next; }
  }
  return best;
}

// Column of the pointer: the cell with the smallest horizontal gap. This also
// resolves gutter clicks, where no cell is under the pointer.
function sideAt(row: Element, x: number): Side {
  let side: Side = 'after';
  let distance = Infinity;
  for (const cell of row.querySelectorAll<HTMLElement>('[data-scroll-side]')) {
    const rect = cell.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const next = x < rect.left ? rect.left - x : x > rect.right ? x - rect.right : 0;
    if (next < distance) { side = cell.dataset.scrollSide as Side; distance = next; }
  }
  return side;
}

// Nearest line on the requested side. Rows that only add or only delete have a
// hole on one column, so both neighbours are checked and the closer one wins.
function sideLine(row: HTMLElement | null, side: Side, y: number): HTMLElement | null {
  if (!row) return null;
  const own = lineOf(row, side);
  if (own) return own;
  let best: HTMLElement | null = null;
  let distance = Infinity;
  for (const direction of [1, -1] as const) {
    let cursor: Element | null = direction === 1 ? row.nextElementSibling : row.previousElementSibling;
    while (cursor) {
      const line = lineOf(cursor, side);
      if (line) {
        const rect = line.getBoundingClientRect();
        const next = Math.min(Math.abs(rect.top - y), Math.abs(rect.bottom - y));
        if (next < distance) { best = line; distance = next; }
        break;
      }
      cursor = direction === 1 ? cursor.nextElementSibling : cursor.previousElementSibling;
    }
  }
  return best;
}

function quoteSnippet(text: string): string {
  const clean = text.replace(/\r\n/g, '\n').trim();
  return clean.length > 4000 ? `${clean.slice(0, 4000)}…` : clean;
}

function itemLines(item: Item): { before?: DiffLine; after?: DiffLine } {
  if (item.type !== 'line') return {};
  if (item.pair) return { before: item.pair.left, after: item.pair.right };
  const row = item.row!;
  return { before: row.type === 'add' ? undefined : row.a, after: row.type === 'del' ? undefined : row.b };
}

export const FileDiffCard = memo(function FileDiffCard({
  file,
  layout,
  wrap,
  viewed,
  digest,
  stat,
  comments,
  reviewedHunks,
  targetLine,
  targetSide = 'after',
  defaultOpen = true,
  revealToken,
  word,
}: Props) {
  const dispatch = useAppDispatch();
  // Cards compute their diff only when opened and close to the viewport; a
  // 1700-file review otherwise blocks the main thread for seconds.
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(defaultOpen && !viewed);
  const [expanded, setExpanded] = useState<Record<number, Expansion>>(EMPTY);
  const [comment, setComment] = useState<{ side: Side; start: number; end: number; snippet: string } | null>(null);
  const [draft, setDraft] = useState('');
  const paste = useImagePaste(draft, setDraft);
  const pointerStart = useRef<{ x: number; y: number } | null>(null);
  const selectionCleanup = useRef<() => void>(() => {});
  const [picked, setPicked] = useState<PickedRange | null>(null);
  const pickedRef = useRef<PickedRange | null>(null);
  const itemsRef = useRef<Item[]>([]);
  const wasViewed = useRef(viewed);
  useEffect(() => { if (revealToken !== undefined) setOpen(true); }, [revealToken]);
  useEffect(() => {
    if (viewed && !wasViewed.current) setOpen(false);
    if (!viewed && wasViewed.current) setOpen(true);
    wasViewed.current = viewed;
  }, [viewed]);
  const root = useRef<HTMLElement>(null);
  useEffect(() => () => selectionCleanup.current(), []);
  pickedRef.current = picked;
  const lastReveal = useRef('');
  useEffect(() => {
    if (!open || ready) return;
    const element = root.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setReady(true); return; }
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) setReady(true);
    }, { rootMargin: '1200px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [open, ready]);
  const diff = ready ? fileDiff(file) : null;
  const rows = diff?.rows ?? EMPTY_ROWS;
  const hunks = diff?.hunks ?? EMPTY_HUNKS;
  const pathComments = useMemo(() => comments.filter((entry) => entry.quote?.file === file.path), [comments, file.path]);
  const pathReviewed = useMemo(() => reviewedHunks.filter((key) => key.startsWith(`${file.path}@`)), [reviewedHunks, file.path]);
  const onViewed = () => dispatch({ type: 'viewed/toggle', entry: `${file.path}#${digest}` });
  const onHunkToggle = (key: string) => dispatch({ type: 'hunk/toggle', key });
  const onHunkReplace = (keys: string[]) => dispatch({ type: 'hunk/replace', file: file.path, keys });
  const onWord = (next: string) => dispatch({ type: 'code/word', word: next === word ? '' : next });
  const sections = useMemo(() => diffSections(rows, hunks, expanded), [rows, hunks, expanded]);
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const section of sections) {
      if (section.type === 'gap') { out.push({ type: 'gap', section }); continue; }
      const slice = rows.slice(section.start, section.end);
      let before = 0; let after = 0; let beforeStart = 0; let afterStart = 0;
      for (const row of slice) {
        if (row.type !== 'add') { before++; beforeStart ||= row.a.n; }
        if (row.type !== 'del') { after++; afterStart ||= row.b.n; }
      }
      const digest = hashText(slice.map((row) => row.type === 'add' ? `+${row.b.text}` : row.type === 'del' ? `-${row.a.text}` : ` ${row.a.text}\u0000${row.b.text}`).join('\n'));
      out.push({ type: 'header', text: `@@ −${beforeStart},${before} +${afterStart},${after} @@`, key: section.key, hash: digest });
      if (layout === 'split') for (const pair of splitPairs(slice)) out.push({ type: 'line', pair });
      else for (const row of slice) out.push({ type: 'line', row });
    }
    return out;
  }, [sections, rows, layout]);
  const hunkKeys = useMemo(() => items.flatMap((item) => item.type === 'header' ? [`${file.path}@${item.key}#${item.hash}`] : []), [items, file.path]);
  const reviewedSet = useMemo(() => new Set(pathReviewed), [pathReviewed]);
  const allHunksReviewed = hunkKeys.length > 0 && hunkKeys.every((key) => viewed || reviewedSet.has(key));
  // Every hunk in the file is reviewed -> the whole file counts as viewed.
  useEffect(() => { if (allHunksReviewed && !viewed) onViewed(); }, [allHunksReviewed, viewed, onViewed]);
  const identity = useMemo(() => ({ items, wrap }), [items, wrap]);
  const { ref: content, virtual, range: view } = useDiffWindow(open ? items.length : 0, identity);
  const columns = useMemo(() => {
    let before = 0; let after = 0;
    for (const item of items) {
      if (item.type !== 'line') continue;
      const lines = itemLines(item);
      before = Math.max(before, codeColumns(lines.before?.text));
      after = Math.max(after, codeColumns(lines.after?.text));
    }
    return { before, after, code: Math.max(before, after) };
  }, [items]);

  // 定位到行：先展开包含该行的折叠区，等重排完成后再滚动。
  const [pendingScroll, setPendingScroll] = useState('');
  useEffect(() => {
    if (revealToken === undefined || !open) return;
    const key = `${file.path}:${revealToken}:${targetSide}:${targetLine}`;
    if (lastReveal.current === key) return;
    if (!targetLine) { setPendingScroll(key); return; }
    const index = rows.findIndex((row) => targetSide === 'before' ? row.type !== 'add' && row.a.n === targetLine : row.type !== 'del' && row.b.n === targetLine);
    if (index < 0) return;
    const next = hunks.find((hunk) => hunk.start > index);
    const previous = [...hunks].reverse().find((hunk) => hunk.start + hunk.rows.length <= index);
    const start = previous ? previous.start + previous.rows.length : 0;
    const end = next ? next.start : rows.length;
    if (start >= end || index < start || index >= end) { setPendingScroll(key); return; }
    const fromTop = index - start;
    const fromBottom = end - index;
    setExpanded((current) => {
      const gap = current[start] ?? { top: 0, bottom: 0 };
      if (fromTop <= fromBottom) return { ...current, [start]: { ...gap, top: Math.max(gap.top, fromTop + 4) } };
      return { ...current, [start]: { ...gap, bottom: Math.max(gap.bottom, fromBottom + 4) } };
    });
    setPendingScroll(key);
  }, [revealToken, targetLine, targetSide, rows, hunks, open, file.path]);

  useEffect(() => {
    if (!pendingScroll || !ready || !open) return;
    const scroller = content.current?.closest<HTMLElement>('[data-review-scroll]');
    const element = root.current;
    if (!scroller || !element) return;
    const index = targetLine ? items.findIndex((item) => itemLines(item)[targetSide]?.n === targetLine) : -1;
    if (targetLine && index < 0) return;
    lastReveal.current = pendingScroll;
    setPendingScroll('');
    // Keep the target below the floating search panel instead of hiding it.
    const panel = document.querySelector<HTMLElement>('[data-search-panel="true"]');
    const offset = panel ? Math.max(100, panel.getBoundingClientRect().bottom - scroller.getBoundingClientRect().top + 16) : 100;
    const top = element.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop + (index >= 0 ? virtual.offsetOf(index) - offset : 0);
    scroller.scrollTo({ top: Math.max(0, top), behavior: 'instant' });
  }, [pendingScroll, ready, open, items, virtual, targetLine, targetSide]);

  const expand = (section: DiffSection, end: 'top' | 'bottom') => setExpanded((current) => {
    const next = growExpansion(section, current[section.key] ?? { top: 0, bottom: 0 }, end);
    return next ? { ...current, [section.key]: next } : current;
  });
  // 打开整个文件：每个折叠区一次露完，不用连点几十次。
  const revealWholeGap = (section: DiffSection) => setExpanded((current) => {
    const previous = current[section.key] ?? { top: 0, bottom: 0 };
    return { ...current, [section.key]: { top: previous.top + (section.end - section.start), bottom: previous.bottom } };
  });
  const expandAllGaps = () => setExpanded((current) => {
    const next = { ...current };
    for (const section of sections) {
      if (section.type !== 'gap') continue;
      const previous = current[section.key] ?? { top: 0, bottom: 0 };
      next[section.key] = { top: previous.top + (section.end - section.start), bottom: previous.bottom };
    }
    return next;
  });
  const hasGaps = sections.some((section) => section.type === 'gap');
  itemsRef.current = items;
  // The diff draws its own selection, so Ctrl+C is served from the line range
  // instead of the browser selection. Clicking outside or Esc clears it.
  useEffect(() => {
    if (!picked) return;
    const onCopy = (event: ClipboardEvent) => {
      const range = pickedRef.current;
      const text = range ? textInRange(range) : '';
      if (!text) return;
      event.clipboardData?.setData('text/plain', text);
      event.preventDefault();
    };
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) { setPicked(null); clearCodeSelection(); }
    };
    const onKey = (event: KeyboardEvent) => {
      // Esc belongs to open dialogs (search, export) first.
      if (event.key !== 'Escape' || document.querySelector('[role="dialog"]')) return;
      setPicked(null);
      clearCodeSelection();
    };
    document.addEventListener('copy', onCopy);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('copy', onCopy);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked]);
  // Split view repeats both sides in one row, so the snippet is rebuilt from
  // the rows of the quoted side only.
  const linesInRange = (range: PickedRange): { side: Side; line: number; text: string }[] => {
    const span = pickedRows(range);
    if (!span) return [];
    const out: { side: Side; line: number; text: string }[] = [];
    const list = itemsRef.current;
    for (let index = span[0]; index <= span[1] && index < list.length; index++) {
      const own = itemLines(list[index]);
      const pick = layout === 'split' ? own[range.side] : own.after ?? own.before;
      if (!pick) continue;
      out.push({ side: own.after === pick ? 'after' : 'before', line: pick.n, text: pick.text });
    }
    return out;
  };
  const textInRange = (range: PickedRange): string => linesInRange(range).map((entry) => entry.text).join('\n');
  const startComment = (side: Side, line: DiffLine) => {
    const range = pickedRef.current;
    setPicked(null);
    clearCodeSelection();
    const owned = range ? linesInRange(range).filter((entry) => layout !== 'split' || entry.side === side) : [];
    const first = owned[0];
    const last = owned[owned.length - 1];
    if (range && first && last && owned.length > 1) {
      setComment({ side: first.side, start: first.line, end: last.line, snippet: quoteSnippet(owned.map((entry) => entry.text).join('\n')) });
      setDraft('');
      return;
    }
    setComment({ side, start: line.n, end: line.n, snippet: line.text });
    setDraft('');
  };
  const beginSelection = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest('button, input, label, textarea, a, [data-source]')) return;
    const body = content.current;
    const row = target.closest<HTMLElement>('[data-virtual-row]');
    if (!body || !row) return;
    const side = sideAt(row, event.clientX);
    const first = sideLine(row, side, event.clientY);
    if (!first) return;
    const rowIndex = (element: Element | null): number => {
      const own = element?.closest<HTMLElement>('[data-virtual-row]');
      return own ? Number(own.dataset.virtualRow) : -1;
    };
    const anchor = rowIndex(row);
    if (anchor < 0) return;
    event.preventDefault();
    selectionCleanup.current();
    setPicked({ side, anchor, focus: anchor });
    let pointerY = event.clientY;
    let frame = 0;
    const scroller = body.closest<HTMLElement>('[data-review-scroll]');
    const paint = () => {
      const hovered = rowNear(body, pointerY);
      const target2 = rowIndex(hovered);
      if (target2 >= 0) setPicked({ side, anchor, focus: target2 });
    };
    // Dragging past the viewport edge scrolls, so a long range can be picked in
    // one gesture even though rows are virtualized.
    const scroll = () => {
      frame = 0;
      const bounds = scroller?.getBoundingClientRect();
      if (!scroller || !bounds) return;
      const edge = 40;
      const step = pointerY < bounds.top + edge ? -16 : pointerY > bounds.bottom - edge ? 16 : 0;
      if (!step) return;
      scroller.scrollTop += step;
      paint();
      frame = requestAnimationFrame(scroll);
    };
    const move = (pointer: PointerEvent) => {
      pointerY = pointer.clientY;
      paint();
      if (!frame) frame = requestAnimationFrame(scroll);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      if (frame) cancelAnimationFrame(frame);
      const range = pickedRef.current;
      if (range) setCodeSelection(textInRange(range));
      selectionCleanup.current = () => {};
    };
    selectionCleanup.current = stop;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
    window.addEventListener('pointercancel', stop, { once: true });
  };
  const renderGutter = (side: Side, line?: DiffLine) => <div className={styles.gutter}>
    {line && <><button type="button" className={styles.commentAdd} title={`评论 ${side === 'before' ? 'L' : 'R'}${line.n}`} aria-label={`评论 ${side === 'before' ? 'L' : 'R'}${line.n}`} onMouseDown={() => { /* keep the picked range for the comment quote */ }} onClick={() => startComment(side, line)}>+</button><span className={styles.lineNo}>{line.n}</span></>}
  </div>;
  const cell = (rowIndex: number, side: Side, line?: DiffLine, change?: 'add' | 'del') => <div data-scroll-side={line ? (layout === 'unified' ? 'after' : side) : undefined} className={cx(styles.cell, change && styles[change], !line && styles.blank)}>
    {line && <span className={cx(styles.code, targetLine === line.n && targetSide === side && styles.target, isPicked(picked, rowIndex, side) && styles.picked)} data-side={side} data-line={line.n} onPointerDown={(event) => { pointerStart.current = { x: event.clientX, y: event.clientY }; }} onClick={(event) => {
      const start = pointerStart.current;
      pointerStart.current = null;
      if (start && (Math.abs(event.clientX - start.x) > 4 || Math.abs(event.clientY - start.y) > 4)) return;
      const source = event.currentTarget.querySelector<HTMLElement>('[data-source]');
      if (!source) return;
      if (pickedRef.current) { setPicked(null); clearCodeSelection(); }
      const selected = wordAtPoint(event, source, line.text);
      if (selected !== null) onWord(selected);
    }}><span className={styles.sign} aria-hidden>{change === 'add' ? '+' : change === 'del' ? '−' : ' '}</span><span className={styles.source} data-source dangerouslySetInnerHTML={{ __html: highlight(line.text, file.language, word) || '&nbsp;' }} /></span>}
  </div>;

  const slash = file.path.lastIndexOf('/');
  const dir = slash >= 0 ? file.path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? file.path.slice(slash + 1) : file.path;

  return <section ref={root} style={{ '--before-w': `calc(${columns.before}ch + 32px)`, '--after-w': `calc(${layout === 'split' ? columns.after : columns.code}ch + 32px)` } as CSSProperties} className={cx(styles.card, wrap && styles.wrap, layout === 'split' && styles.splitMode, viewed && styles.isViewed)} data-file={file.path}>
    <header className={styles.head}>
      <button className={styles.toggle} type="button" aria-expanded={open} aria-label={`${open ? '折叠' : '展开'} ${file.path}`} onClick={() => setOpen((value) => !value)}>
        {open ? <IconChevronDown width={14} height={14} /> : <IconChevronRight width={14} height={14} />}
      </button>
      <FileIcon name={name} size={14} className={styles.fileIcon} />
      <span className={styles.path} title={file.old_path ? `${file.old_path} → ${file.path}` : file.path}>
        {file.old_path
          ? <><span className={styles.oldPath}>{file.old_path}</span><span className={styles.arrow}>→</span><b>{name}</b></>
          : <><span className={styles.dir}>{dir}</span><b>{name}</b></>}
      </span>
      <span className={cx(styles.badge, styles[`badge_${file.status}`])}>{STATUS[file.status]}</span>
      <button type="button" className={styles.locate} aria-label={`在文件列表定位 ${name}`} title="在文件列表定位" onClick={() => dispatch({ type: 'tree/focus', path: file.path })}><IconLocate width={12} height={12} /></button>
      {hasGaps && <button type="button" className={styles.openAll} title="展开全部折叠行，显示整个文件" onClick={expandAllGaps}>展开全部</button>}
      <span className={styles.stat}><b className={styles.plus}>+{stat.adds}</b><b className={styles.minus}>−{stat.dels}</b></span>
      <label className={styles.viewed} title="标记整个文件已查看；取消会清除该文件的段落标记">
        <input type="checkbox" checked={viewed || allHunksReviewed} onChange={() => {
          if (viewed || allHunksReviewed) { if (viewed) onViewed(); onHunkReplace([]); }
          else { onHunkReplace(hunkKeys); if (!viewed) onViewed(); }
        }} />
        <span>已查看</span>
      </label>
    </header>
    {open && ready && <div ref={content} className={styles.body} onPointerDown={beginSelection}>
      {!items.length && <div className={styles.clean}>没有可显示的文本改动。</div>}
      <div aria-hidden style={{ height: view.top }} />
      {items.slice(view.start, view.end).map((item, offset) => {
        const index = view.start + offset;
        if (item.type === 'gap') {
          // Chevron direction follows what appears on screen: up reveals lines
          // above the gap row, down reveals lines below it. Leading/trailing
          // gaps keep the one side that actually has hidden lines.
          const open = item.section.leading ? 'bottom' : 'top';
          const title = item.section.leading ? '向下露出 5 行' : '向上露出 5 行';
          return <div key={index} data-virtual-row={index} className={styles.gap} title={title} onClick={(event) => { if (!(event.target as HTMLElement).closest('button')) expand(item.section, open); }}>
            <div className={styles.expanders}>
              {!item.section.leading && <button type="button" className={styles.expandUp} aria-label="向上展开 5 行" title="向上露出 5 行" onClick={() => expand(item.section, 'top')}><IconChevronDown width={12} height={12} /></button>}
              {!item.section.trailing && <button type="button" className={styles.expandDown} aria-label="向下展开 5 行" title="向下露出 5 行" onClick={() => expand(item.section, 'bottom')}><IconChevronDown width={12} height={12} /></button>}
            </div>
            <button type="button" className={styles.gapLabel} title={`${title}；双击展开整段`} onClick={() => expand(item.section, open)} onDoubleClick={(event) => { event.preventDefault(); revealWholeGap(item.section); }}>已折叠 {item.section.end - item.section.start} 行</button>
            <em>每次 5 行</em>
          </div>;
        }
        if (item.type === 'header') {
          const fullKey = `${file.path}@${item.key}#${item.hash}`;
          const done = viewed || reviewedSet.has(fullKey);
          return <div key={index} data-virtual-row={index} className={cx(styles.hunkHead, done && styles.hunkDone)}>
            <span>{item.text}</span>
            <label className={styles.hunkCheck} title="标记这段改动已查看；全部标记后文件自动折叠">
              <input type="checkbox" checked={done} aria-label={`已查看 ${item.text}`} onChange={() => {
                if (viewed) {
                  onViewed();
                  onHunkReplace(hunkKeys.filter((entry) => entry !== fullKey));
                } else {
                  onHunkToggle(fullKey);
                }
              }} />
              <span>已查看</span>
            </label>
          </div>;
        }
        const lines = itemLines(item);
        const changed = item.pair ? item.pair.changed : item.row!.type !== 'equal';
        const commentHere = comment && lines[comment.side]?.n === comment.end;
        return <div key={index} data-virtual-row={index}>
          <div className={styles.row}>
            {layout === 'split' ? <>{renderGutter('before', lines.before)}{cell(index, 'before', lines.before, changed && lines.before ? 'del' : undefined)}{renderGutter('after', lines.after)}{cell(index, 'after', lines.after, changed && lines.after ? 'add' : undefined)}</> : <>{renderGutter('before', lines.before)}{renderGutter('after', lines.after)}{cell(index, item.row!.type === 'del' ? 'before' : 'after', lines.after ?? lines.before, item.row!.type === 'equal' ? undefined : item.row!.type)}</>}
          </div>
          {(() => {
            const attached = pathComments.filter((entry) => entry.quote && entry.quote.end === (entry.quote.side === 'before' ? lines.before?.n : lines.after?.n));
            return attached.length ? <div className={styles.inlineThread}>{attached.map((entry) => <CommentCard key={entry.id} comment={entry} compact />)}</div> : null;
          })()}
          {commentHere && <form className={styles.inlineComment} onSubmit={(event) => {
            event.preventDefault();
            if (!draft.trim()) return;
            dispatch({ type: 'comment/add', comment: { id: uid('c-'), resolved: false, source: 'manual', title: '', signalId: '', text: draft.trim(), createdAt: Date.now(), images: [], quote: { file: file.path, side: comment.side, start: comment.start, end: comment.end, snippet: comment.snippet } } });
            setComment(null); setDraft('');
            dispatch({ type: 'toast/show', message: '评论已加入 Review', kind: 'success' });
          }}>
            <label>评论 {comment.side === 'before' ? 'L' : 'R'}{comment.start}{comment.end > comment.start ? `–${comment.end}` : ''}<textarea aria-label="行内评论" autoFocus value={draft} onChange={(event) => setDraft(event.target.value)} onPaste={(event) => void paste.onPaste(event)} placeholder="写下审查意见，可粘贴图片…" /></label>
            {paste.error && <p className={styles.pasteError}>{paste.error}</p>}
            <div><button type="button" className="btn btnSmall" onClick={() => { setComment(null); setDraft(''); }}>取消</button><button className="btn btnSmall btnPrimary" type="submit" disabled={!draft.trim() || paste.uploading}>{paste.uploading ? '上传中…' : '加入 Review'}</button></div>
          </form>}
        </div>;
      })}
      <div aria-hidden style={{ height: Math.max(0, virtual.totalHeight - virtual.offsetOf(view.end)) }} />
    </div>}
    {open && !wrap && items.length > 0 && <DiffHorizontalScroll root={root} split={layout === 'split'} refresh={`${view.start}:${view.end}`} />}
  </section>;
});
