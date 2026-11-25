import { useDeferredValue, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { searchDiff } from '../lib/searchDiff';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { loadMatch, saveMatch } from '../lib/exactPref';
import { SearchHitList } from './SearchHitList';
import { IconChevronRight, IconClose } from './Icons';
import { cx } from '../lib/format';
import styles from './SymbolPanel.module.css';

const HEIGHT_KEY = 'intentflow.symbol-height';
const MIN_HEIGHT = 120;
const DEFAULT_HEIGHT = 300;

function initialHeight(): number {
  try {
    const raw = Number(localStorage.getItem(HEIGHT_KEY));
    return Number.isFinite(raw) && raw >= MIN_HEIGHT ? raw : DEFAULT_HEIGHT;
  } catch {
    return DEFAULT_HEIGHT;
  }
}

// The symbol panel lists the references of the word currently picked in the
// code. It reuses the global diff search, so rows and colors stay identical.
export function SymbolPanel() {
  const { code } = useApp();
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const [open, setOpen] = useState(true);
  const [limit, setLimit] = useState(200);
  const [active, setActive] = useState(-1);
  const [match, setMatch] = useState(() => loadMatch('symbol'));
  const [height, setHeight] = useState(initialHeight);
  const panel = useRef<HTMLElement>(null);
  const word = code.word;
  const deferred = useDeferredValue(word.trim());
  const results = useMemo(() => deferred ? searchDiff(files, deferred, match) : [], [files, deferred, match]);

  // 点击代码里的标识符后浮层自动出现；收起后新增一个词会再次打开。
  useEffect(() => {
    if (word.trim()) setOpen(true);
  }, [word]);

  useEffect(() => {
    setLimit(200);
    setActive(-1);
  }, [deferred, files, match]);

  const toggle = () => setOpen((value) => !value);

  const toggleCase = () => setMatch((current) => {
    const next = { ...current, caseSensitive: !current.caseSensitive };
    saveMatch('symbol', next);
    return next;
  });
  const toggleWord = () => setMatch((current) => {
    const next = { ...current, wholeWord: !current.wholeWord };
    saveMatch('symbol', next);
    return next;
  });

  const maxHeight = () => {
    const stage = panel.current?.parentElement;
    return Math.max(MIN_HEIGHT + 40, Math.min(560, (stage?.clientHeight ?? window.innerHeight) - 32));
  };
  const apply = (value: number) => {
    const next = Math.min(maxHeight(), Math.max(MIN_HEIGHT, value));
    setHeight(next);
    try { localStorage.setItem(HEIGHT_KEY, String(next)); } catch { /* optional preference */ }
  };

  const startResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = panel.current?.offsetHeight ?? height;
    const limit = maxHeight();
    const move = (pointer: PointerEvent) => {
      const next = Math.min(limit, Math.max(MIN_HEIGHT, startHeight - (pointer.clientY - startY)));
      panel.current?.style.setProperty('--symbol-height', `${next}px`);
    };
    const stop = (pointer: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      apply(startHeight - (pointer.clientY - startY));
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const onResizeKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowUp') apply(height + 16);
    else if (event.key === 'ArrowDown') apply(height - 16);
    else if (event.key === 'Home') apply(MIN_HEIGHT);
    else if (event.key === 'End') apply(maxHeight());
    else return;
    event.preventDefault();
  };

  const select = (index: number) => {
    setActive(index);
    const hit = results[index];
    if (hit) dispatch({ type: 'code/reveal', file: hit.path, line: hit.line, side: hit.side });
  };

  if (!word.trim()) return null;

  return <section ref={panel} style={{ '--symbol-height': `${height}px` } as React.CSSProperties} className={cx(styles.panel, open && styles.open)} aria-label="符号引用">
    {open && <div
      className={styles.resizer}
      role="separator"
      aria-orientation="horizontal"
      aria-label="调整符号面板高度"
      tabIndex={0}
      onPointerDown={startResize}
      onKeyDown={onResizeKey}
      onDoubleClick={() => apply(DEFAULT_HEIGHT)}
    />}
    <div className={styles.head}>
      <button type="button" className={styles.headToggle} aria-expanded={open} aria-controls="symbol-body" onClick={toggle}>
        <IconChevronRight width={12} height={12} className={cx(styles.chevron, open && styles.chevronOpen)} />
        <span className={styles.title}>符号</span>
        {word.trim() && <span className={styles.current} title={word.trim()}>{word.trim()}</span>}
        {word.trim() && <span className={styles.count}>{results.length}</span>}
      </button>
      <div className={styles.tools}>
        <button type="button" className={cx(styles.flag, match.caseSensitive && styles.flagOn)} aria-pressed={match.caseSensitive} aria-label="区分大小写" title="区分大小写" onClick={toggleCase}>Aa</button>
        <button type="button" className={cx(styles.flag, match.wholeWord && styles.flagOn)} aria-pressed={match.wholeWord} aria-label="完整匹配" title="完整匹配（整词）" onClick={toggleWord}>{'\\b'}</button>
        {word && <button type="button" className={styles.clear} aria-label="清除符号" title="清除符号" onClick={() => dispatch({ type: 'code/word', word: '' })}><IconClose width={11} height={11} /></button>}
      </div>
    </div>
    {open && <div id="symbol-body" className={styles.body}>
      {!deferred ? <p className={styles.empty}>点击 diff 里的标识符查看引用。<br />结果按全局搜索的口径列出，点击行跳转。</p>
        : !results.length ? <p className={styles.empty}>没有匹配。</p>
        : <SearchHitList
          key={deferred}
          variant="panel"
          results={results}
          visibleCount={limit}
          activeIndex={active}
          onSelect={select}
          onMore={results.length > limit ? () => setLimit((value) => value + 200) : undefined}
        />}
    </div>}
  </section>;
}
