import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { searchDiff, type SearchHit } from '../lib/searchDiff';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { cx } from '../lib/format';
import { codeSelection } from '../lib/codeSelection';
import { loadMatch, saveMatch } from '../lib/exactPref';
import { SearchHitList } from './SearchHitList';
import { IconClose, IconSearch } from './Icons';
import styles from './SearchPanel.module.css';

interface Props {
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
}

// Cmd/Ctrl+F follows the browser convention: a selection becomes the query.
// Multi-line selections use their first non-empty line because search is per
// diff line.
function selectedQuery(): string {
  const active = document.activeElement;
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? 0;
    const end = active.selectionEnd ?? 0;
    if (end > start) return firstLine(active.value.slice(start, end));
  }
  // The diff keeps its own line range; native selection is usually collapsed
  // there because rows are virtualized.
  return firstLine(window.getSelection()?.toString() ?? '') || firstLine(codeSelection());
}

function firstLine(text: string): string {
  return text.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? '';
}

interface Position { path: string; line: number }

function targetVisible(target: Position): boolean {
  const scroller = document.querySelector<HTMLElement>('[data-review-scroll]');
  if (!scroller) return false;
  const card = [...scroller.querySelectorAll<HTMLElement>('[data-file]')].find((element) => element.dataset.file === target.path);
  const line = card && [...card.querySelectorAll<HTMLElement>('[data-line]')].find((element) => Number(element.dataset.line) === target.line);
  if (!line) return false;
  const rect = line.getBoundingClientRect();
  const bounds = scroller.getBoundingClientRect();
  return rect.bottom > bounds.top && rect.top < bounds.bottom;
}

// Current viewport position, used to pick the nearest match instead of the
// first one. Cards and lines are virtualized, so only visible DOM is read.
function currentPosition(): Position | null {
  const scroller = document.querySelector<HTMLElement>('[data-review-scroll]');
  if (!scroller) return null;
  const top = scroller.getBoundingClientRect().top + 20;
  const cards = [...scroller.querySelectorAll<HTMLElement>('[data-file]')];
  const card = cards.find((element) => element.getBoundingClientRect().bottom > top);
  if (!card?.dataset.file) return null;
  const lines = [...card.querySelectorAll<HTMLElement>('[data-line]')];
  const line = lines.find((element) => element.getBoundingClientRect().bottom > top);
  return { path: card.dataset.file, line: Number(line?.dataset.line ?? 0) };
}

function nearestIndex(results: SearchHit[], anchor: Position | null, files: { path: string }[]): number {
  if (!results.length) return 0;
  if (anchor) {
    const same = results.map((hit, index) => ({ hit, index })).filter((item) => item.hit.path === anchor.path);
    if (same.length) {
      return (same.find((item) => item.hit.line >= anchor.line) ?? same[same.length - 1]).index;
    }
    const order = new Map(files.map((file, index) => [file.path, index]));
    const anchorFile = order.get(anchor.path);
    if (anchorFile !== undefined) {
      const after = results.findIndex((hit) => (order.get(hit.path) ?? -1) > anchorFile);
      if (after >= 0) return after;
      return results.length - 1;
    }
  }
  return 0;
}

export function SearchPanel({ open, onOpen, onClose }: Props) {
  const { code } = useApp();
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const [query, setQuery] = useState('');
  const deferred = useDeferredValue(query);
  const [match, setMatch] = useState(() => loadMatch('search'));
  const toggleCase = () => setMatch((current) => {
    const next = { ...current, caseSensitive: !current.caseSensitive };
    saveMatch('search', next);
    return next;
  });
  const toggleWord = () => setMatch((current) => {
    const next = { ...current, wholeWord: !current.wholeWord };
    saveMatch('search', next);
    return next;
  });
  const [active, setActive] = useState(0);
  const [limit, setLimit] = useState(200);
  const input = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);
  const lastJumped = useRef(-1);
  const results = useMemo(() => searchDiff(files, deferred, match), [files, deferred, match]);
  const visible = results.slice(0, limit);

  const reveal = (hit: SearchHit) => dispatch({ type: 'code/reveal', file: hit.path, line: hit.line, side: hit.side });
  const move = (index: number) => {
    if (!results.length) return;
    const next = (index + results.length) % results.length;
    setActive(next);
    if (next >= limit) setLimit(Math.min(results.length, next + 50));
  };
  const select = (index: number) => {
    if (!results.length) return;
    const next = (index + results.length) % results.length;
    move(next);
    reveal(results[next]);
    lastJumped.current = next;
  };
  // Enter jumps to the selected row first; pressing it again walks forward.
  const enter = () => {
    if (!results.length) return;
    if (lastJumped.current === active) select(active + 1);
    else select(active);
  };

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Opening and changing the query select the match nearest the current
  // viewport, but never scroll the code by itself.
  const selectNearest = () => {
    const reveal = code.reveal ? { path: code.reveal.file, line: code.line ?? 0 } : null;
    const anchor = reveal && targetVisible(reveal) ? reveal : currentPosition();
    const next = nearestIndex(results, anchor, files);
    setActive(next);
    setLimit(Math.max(200, next + 1));
    lastJumped.current = -1;
  };

  useEffect(() => {
    if (open) selectNearest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (open) selectNearest();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferred, files, match]);

  useEffect(() => {
    setActive((current) => results.length ? Math.min(current, results.length - 1) : 0);
  }, [results.length]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.isComposing) return;
      const find = (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f';
      if (find) {
        event.preventDefault();
        const selected = input.current === document.activeElement ? '' : selectedQuery();
        if (selected) setQuery(selected);
        if (!open) onOpen();
        requestAnimationFrame(() => { input.current?.focus(); input.current?.select(); });
        return;
      }
      if (!open) {
        if (event.key === 'F3') { event.preventDefault(); onOpen(); }
        return;
      }
      if (event.key === 'Escape') { event.preventDefault(); onClose(); return; }
      if (event.key === 'F3') { event.preventDefault(); select(active + (event.shiftKey ? -1 : 1)); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onOpen, onClose, active, results, limit]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) onClose();
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open, onClose]);

  if (!open) return null;

  return <div ref={root} className={styles.root} role="dialog" aria-label="搜索全部 diff" data-search-panel="true">
    <div className={styles.bar}>
      <IconSearch width={15} height={15} />
      <input
        ref={input}
        className={styles.input}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) select(active - 1);
            else enter();
          } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            move(active + 1);
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            move(active - 1);
          }
        }}
        placeholder="搜索全部 diff…"
        aria-label="搜索全部 diff"
        spellCheck={false}
      />
      <button type="button" className={cx(styles.exact, match.caseSensitive && styles.exactOn)} aria-pressed={match.caseSensitive} aria-label="区分大小写" title="区分大小写" onClick={toggleCase}>Aa</button>
      <button type="button" className={cx(styles.exact, match.wholeWord && styles.exactOn)} aria-pressed={match.wholeWord} aria-label="完整匹配" title="完整匹配（整词）" onClick={toggleWord}>{'\\b'}</button>
      <span className={styles.count}>{results.length ? `${Math.min(active + 1, results.length)} / ${results.length}` : '0'}</span>
      <button type="button" className={styles.icon} aria-label="上一个匹配" title="上一个匹配 (Shift+Enter)" disabled={!results.length} onClick={() => select(active - 1)}>↑</button>
      <button type="button" className={styles.icon} aria-label="下一个匹配" title="下一个匹配 (Enter)" disabled={!results.length} onClick={() => select(active + 1)}>↓</button>
      <button type="button" className={styles.icon} aria-label="关闭搜索" title="关闭搜索 (Esc)" onClick={onClose}><IconClose width={13} height={13} /></button>
    </div>
    {!deferred.trim() ? <p className={styles.empty}>输入关键词，搜索全部文件的 diff。</p>
      : !results.length ? <p className={styles.empty}>没有匹配。</p>
      : <SearchHitList
        results={results}
        visibleCount={visible.length}
        activeIndex={active}
        activeRef={activeRef}
        onSelect={select}
        onMore={results.length > visible.length ? () => setLimit((value) => value + 200) : undefined}
      />}
  </div>;
}
