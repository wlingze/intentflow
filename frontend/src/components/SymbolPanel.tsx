import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { searchDiff } from '../lib/searchDiff';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { loadExact, saveExact } from '../lib/exactPref';
import { SearchHitList } from './SearchHitList';
import { IconChevronRight, IconClose, IconSearch } from './Icons';
import { cx } from '../lib/format';
import styles from './SymbolPanel.module.css';

const OPEN_KEY = 'intentflow.symbol-open';
const EXACT_KEY = 'intentflow.symbol-exact';

function initialOpen(): boolean {
  try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; }
}

// The symbol panel lists the references of the word currently picked in the
// code. It reuses the global diff search, so rows and colors stay identical.
export function SymbolPanel() {
  const { code } = useApp();
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const [open, setOpen] = useState(initialOpen);
  const [limit, setLimit] = useState(200);
  const [active, setActive] = useState(-1);
  const [exact, setExact] = useState(() => loadExact(EXACT_KEY, true));
  const toggleExact = () => setExact((value) => { saveExact(EXACT_KEY, !value); return !value; });
  const word = code.word;
  const deferred = useDeferredValue(word.trim());
  const results = useMemo(() => deferred ? searchDiff(files, deferred, { exact }) : [], [files, deferred, exact]);

  useEffect(() => {
    setLimit(200);
    setActive(-1);
  }, [deferred, files, exact]);

  const toggle = () => setOpen((value) => {
    const next = !value;
    try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* optional preference */ }
    return next;
  });

  const select = (index: number) => {
    setActive(index);
    const hit = results[index];
    if (hit) dispatch({ type: 'code/reveal', file: hit.path, line: hit.line, side: hit.side });
  };

  return <section className={cx(styles.panel, open && styles.open)} aria-label="符号引用">
    <button type="button" className={styles.head} aria-expanded={open} aria-controls="symbol-body" onClick={toggle}>
      <IconChevronRight width={12} height={12} className={cx(styles.chevron, open && styles.chevronOpen)} />
      <span className={styles.title}>符号</span>
      {word.trim() && <span className={styles.current} title={word.trim()}>{word.trim()}</span>}
      {word.trim() && <span className={styles.count}>{results.length}</span>}
    </button>
    {open && <div id="symbol-body" className={styles.body}>
      <div className={styles.searchRow}>
        <IconSearch width={13} height={13} />
        <input
          className={styles.input}
          value={word}
          onChange={(event) => dispatch({ type: 'code/word', word: event.target.value })}
          placeholder="输入符号，或点击代码里的标识符"
          aria-label="搜索符号引用"
          spellCheck={false}
        />
        <button type="button" className={cx(styles.exact, exact && styles.exactOn)} aria-pressed={exact} aria-label="精确搜索" title={exact ? '精确搜索：完整单词、区分大小写（点击关闭）' : '精确搜索：完整单词、区分大小写'} onClick={toggleExact}>Aa</button>
        {word && <button type="button" className={styles.clear} aria-label="清除符号" title="清除符号" onClick={() => dispatch({ type: 'code/word', word: '' })}><IconClose width={11} height={11} /></button>}
      </div>
      {!deferred ? <p className={styles.empty}>点击 diff 里的标识符，或在这里输入符号。<br />结果按全局搜索的口径列出，点击行跳转。</p>
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
