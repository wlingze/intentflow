import { baseName, cx, shortPath } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { Quote } from '../types';
import { DiffView } from './DiffView';
import { SearchView } from './SearchView';
import { IconClose, IconDiff, IconSearch } from './Icons';
import styles from './CodeStage.module.css';

const STATUS_LABEL: Record<string, string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  unchanged: '未变',
};

export function CodeStage() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { files, stats } = useReviewData();

  const active = files.find((file) => file.path === state.code.active) ?? null;
  const activeStats = active ? stats.get(active.path) : undefined;
  const openFiles = state.code.files
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is NonNullable<typeof file> => Boolean(file));

  const addQuote = (quote: Quote) => {
    dispatch({ type: 'composer/quote', quote });
    dispatch({ type: 'toast/show', message: '引用已加入输入框', kind: 'info' });
  };

  return (
    <section className={styles.stage}>
      <header className={styles.head}>
        <div className={styles.tabs}>
          {openFiles.map((file) => (
            <div
              key={file.path}
              className={cx(styles.tab, state.code.active === file.path && styles.tabActive)}
              title={file.path}
            >
              <button
                type="button"
                className={styles.tabName}
                onClick={() => dispatch({ type: 'code/file', file: file.path })}
              >
                <span className={cx(styles.dot, styles[file.status])} />
                {baseName(file.path)}
              </button>
              <button
                type="button"
                className={styles.tabClose}
                title="关闭文件"
                onClick={() => dispatch({ type: 'code/closeFile', file: file.path })}
              >
                <IconClose width={10} height={10} />
              </button>
            </div>
          ))}
        </div>
      </header>

      <div className={styles.toolbar}>
        <div className={styles.modes} role="tablist" aria-label="代码视图">
          <button
            type="button"
            role="tab"
            aria-selected={state.code.mode === 'diff'}
            className={cx(styles.mode, state.code.mode === 'diff' && styles.modeActive)}
            onClick={() => dispatch({ type: 'code/mode', mode: 'diff' })}
          >
            <IconDiff width={13} height={13} />
            Diff
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={state.code.mode === 'search'}
            className={cx(styles.mode, state.code.mode === 'search' && styles.modeActive)}
            onClick={() => dispatch({ type: 'code/mode', mode: 'search' })}
          >
            <IconSearch width={13} height={13} />
            搜索
          </button>
        </div>

        {state.code.mode === 'diff' && active && (
          <>
            <div className={styles.layout}>
              <button
                type="button"
                className={cx(styles.layoutBtn, state.code.layout === 'split' && styles.layoutActive)}
                onClick={() => dispatch({ type: 'code/layout', layout: 'split' })}
                title="左右分栏，窄屏时两栏各自横向滚动"
              >
                分栏
              </button>
              <button
                type="button"
                className={cx(styles.layoutBtn, state.code.layout === 'unified' && styles.layoutActive)}
                onClick={() => dispatch({ type: 'code/layout', layout: 'unified' })}
              >
                统一
              </button>
              <button
                type="button"
                aria-pressed={state.code.wrap}
                className={cx(styles.layoutBtn, state.code.wrap && styles.layoutActive)}
                onClick={() => dispatch({ type: 'code/wrap', wrap: !state.code.wrap })}
                title="自动换行；关闭时按内容宽度横向滚动"
              >
                换行
              </button>
            </div>
            <div className={styles.fileMeta}>
              <span className={styles.filePath} title={active.path}>{shortPath(active.path, 56)}</span>
              <span className={cx('badge', active.status === 'modified' && 'badgeAmber', active.status === 'added' && 'badgeGreen', active.status === 'removed' && 'badgeRed')}>
                {STATUS_LABEL[active.status]}
              </span>
              {activeStats && (
                <span className={styles.stats}>
                  <b className={styles.plus}>+{activeStats.adds}</b>
                  <b className={styles.minus}>−{activeStats.dels}</b>
                </span>
              )}
            </div>
          </>
        )}
        {state.code.mode === 'search' && (
          <span className={styles.searchHint}>搜索范围：{files.length} 个文件的 before / after</span>
        )}
      </div>

      <div className={styles.body}>
        {state.code.mode === 'search' ? (
          <SearchView />
        ) : active ? (
          <DiffView
            file={active}
            layout={state.code.layout}
            wrap={state.code.wrap}
            targetLine={state.code.line}
            targetSide={state.code.side}
            onQuote={addQuote}
          />
        ) : (
          <div className={styles.empty}>没有打开的文件。从左侧目录树选择一个文件。</div>
        )}
      </div>
    </section>
  );
}
