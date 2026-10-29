import { useDeferredValue, useMemo } from 'react';
import { cx, shortPath } from '../lib/format';
import { highlightMatch, searchCode } from '../lib/search';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { IconSearch } from './Icons';
import styles from './SearchView.module.css';

const STATUS_LABEL: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  unchanged: '',
};

export function SearchView() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const query = state.drawer.search;
  const deferred = useDeferredValue(query);
  const groups = useMemo(() => searchCode(files, deferred), [files, deferred]);
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0);

  return (
    <div className={styles.wrapper}>
      <div className={styles.searchBar}>
        <IconSearch width={15} height={15} className={styles.searchIcon} />
        <input
          autoFocus
          value={query}
          placeholder="在 before / after 里搜索…"
          onChange={(event) => dispatch({ type: 'drawer/search', search: event.target.value })}
        />
        {query.trim() && <span className={styles.count}>{total} 处</span>}
      </div>

      <div className={styles.scroll}>
        {!query.trim() ? (
          <div className={styles.empty}>
            <IconSearch width={22} height={22} />
            <p>输入关键字，跨文件搜索改动前后的代码。</p>
            <span>结果按文件分组，点击跳到对应行。</span>
          </div>
        ) : groups.length === 0 ? (
          <div className={styles.empty}>
            <p>没有匹配「{query}」的代码。</p>
            <span>试试更短的关键字，或检查大小写。</span>
          </div>
        ) : (
          groups.map((group) => (
            <section key={group.file} className={styles.group}>
              <header className={styles.groupHead}>
                <span className={styles.filePath} title={group.file}>{shortPath(group.file, 56)}</span>
                {group.status !== 'unchanged' && (
                  <span className={cx(styles.status, styles[group.status])}>{STATUS_LABEL[group.status]}</span>
                )}
                <span className={styles.groupCount}>{group.hits.length}</span>
              </header>
              {group.hits.map((hit) => (
                <button
                  key={`${hit.side}-${hit.line}`}
                  type="button"
                  className={styles.hit}
                  title={`${hit.file}:${hit.line}`}
                  onClick={() =>
                    dispatch({
                      type: 'drawer/target',
                      file: hit.file,
                      line: hit.line,
                      side: hit.side,
                    })
                  }
                >
                  <span className={cx(styles.side, hit.side === 'before' ? styles.before : styles.after)}>
                    {hit.side}
                  </span>
                  <span className={styles.line}>{hit.line}</span>
                  <span
                    className={styles.snippet}
                    dangerouslySetInnerHTML={{ __html: highlightMatch(hit.text, hit.start, hit.end) }}
                  />
                </button>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  );
}
