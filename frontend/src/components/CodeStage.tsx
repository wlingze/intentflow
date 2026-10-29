import { useMemo, useState } from 'react';
import { baseName, cx, shortPath } from '../lib/format';
import { layoutBehavior } from '../lib/behavior';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { Quote } from '../types';
import { DiffView } from './DiffView';
import { MiniMap } from './MiniMap';
import { SearchView } from './SearchView';
import { IconBranch, IconClose, IconDiff, IconSearch } from './Icons';
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
  const { files, stats, review } = useReviewData();
  const [miniOpen, setMiniOpen] = useState(true);

  const active = files.find((file) => file.path === state.code.active) ?? null;
  const activeStats = active ? stats.get(active.path) : undefined;
  const openFiles = state.code.files
    .map((path) => files.find((file) => file.path === path))
    .filter((file): file is NonNullable<typeof file> => Boolean(file));

  const graph = useMemo(
    () => (review ? layoutBehavior(review.behavior) : null),
    [review],
  );

  const addQuote = (quote: Quote) => {
    dispatch({ type: 'composer/quote', quote });
    dispatch({ type: 'toast/show', message: '引用已加入输入框', kind: 'info' });
  };

  return (
    <section className={styles.stage}>
      <header className={styles.head}>
        <button
          type="button"
          className={styles.back}
          onClick={() => dispatch({ type: 'code/close' })}
        >
          <IconBranch width={13} height={13} />
          行为图
        </button>
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
        {!miniOpen && graph && graph.nodes.length > 0 && (
          <button type="button" className="btn btnGhost btnSmall" onClick={() => setMiniOpen(true)}>
            显示缩略图
          </button>
        )}
      </div>

      <div className={styles.body}>
        {state.code.mode === 'search' ? (
          <SearchView />
        ) : active ? (
          <DiffView
            file={active}
            layout={state.code.layout}
            targetLine={state.code.line}
            targetSide={state.code.side}
            onQuote={addQuote}
          />
        ) : (
          <div className={styles.empty}>没有打开的文件。从左侧目录树选择一个文件。</div>
        )}

        {miniOpen && graph && graph.nodes.length > 0 && (
          <MiniMap
            graph={graph}
            activeNodeId={state.selected?.kind === 'node' ? state.selected.id : undefined}
            onClose={() => setMiniOpen(false)}
            onSelect={(node) => {
              if (!node.file) {
                dispatch({ type: 'toast/show', message: '这个行为节点没有代码位置', kind: 'info' });
                return;
              }
              dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
              dispatch({
                type: 'code/target',
                file: node.file,
                line: node.line,
                side: node.delta === 'removed' ? 'before' : 'after',
              });
            }}
          />
        )}
      </div>
    </section>
  );
}
