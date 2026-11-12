import { useEffect, useRef } from 'react';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { FileDiffCard } from './FileDiffCard';
import { IconBranch } from './Icons';
import styles from './DiffStage.module.css';

const EMPTY_STAT = { adds: 0, dels: 0 };

export function DiffStage() {
  const { code, viewed, payload, comments, reviewedHunks } = useApp();
  const dispatch = useAppDispatch();
  const { files, stats, truncated, skipped, digests } = useReviewData();
  const viewedEntry = (path: string) => `${path}#${digests.get(path) ?? ''}`;
  const base = payload?.review.comparison.beforeLabel ?? payload?.review.before ?? '';
  const after = payload?.review.comparison.afterLabel ?? payload?.review.after ?? '';
  const scroller = useRef<HTMLDivElement>(null);

  // 文件树点击：把目标卡片滚到顶部。行级定位由卡片自己处理。
  useEffect(() => {
    if (!code.reveal || code.line !== undefined) return;
    const target = scroller.current?.querySelector<HTMLElement>(`[data-file="${cssEscape(code.reveal.file)}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [code.reveal, code.line]);

  const allViewed = files.length > 0 && files.every((file) => viewed.includes(viewedEntry(file.path)));

  return (
    <section className={styles.stage} aria-label="代码改动">
      <header className={styles.head}>
        <div className={styles.title}>
          <IconBranch width={14} height={14} />
          <b title={`${base} → ${after}`}>{base} → {after}</b>
          <span className={styles.count}>{files.length} 个文件</span>
        </div>
        <div className={styles.controls}>
          <div className={styles.segmented} role="group" aria-label="Diff 视图">
            <button type="button" aria-pressed={code.layout === 'split'} onClick={() => dispatch({ type: 'code/layout', layout: 'split' })}>分栏</button>
            <button type="button" aria-pressed={code.layout === 'unified'} onClick={() => dispatch({ type: 'code/layout', layout: 'unified' })}>统一</button>
          </div>
          <button
            type="button"
            className={styles.tool}
            aria-pressed={code.wrap}
            onClick={() => dispatch({ type: 'code/wrap', wrap: !code.wrap })}
          >
            自动换行
          </button>
          <button
            type="button"
            className={styles.tool}
            onClick={() => dispatch({ type: 'viewed/all', value: !allViewed, entries: files.map((file) => viewedEntry(file.path)) })}
            title="把全部文件标为已查看"
          >
            {allViewed ? '全部未读' : '全部已读'}
          </button>
        </div>
      </header>

      {truncated && (
        <div className={styles.truncated} role="status">
          {skipped} 个文件超出服务端体积上限，只显示文件头，没有正文。
        </div>
      )}

      <div className={styles.scroll} data-review-scroll ref={scroller}>
        <div className={styles.list}>
          {!files.length && (
            <div className={styles.empty}>
              <p>没有文件改动。</p>
              <span>确认基线正确，或先修改代码。</span>
            </div>
          )}
          {files.map((file) => (
            <FileDiffCard
              key={file.path}
              file={file}
              layout={code.layout}
              wrap={code.wrap}
              viewed={viewed.includes(viewedEntry(file.path))}
              digest={digests.get(file.path) ?? ''}
              stat={stats.get(file.path) ?? EMPTY_STAT}
              comments={comments}
              reviewedHunks={reviewedHunks}
              revealToken={code.reveal?.file === file.path ? code.revealToken : undefined}
              targetLine={code.reveal?.file === file.path ? code.line : undefined}
              targetSide={code.reveal?.file === file.path ? code.side : undefined}
              word={code.word}
            />
          ))}
          {files.length > 0 && (
            <footer className={styles.tail}>
              已显示 {files.length} 个文件。每段折叠区可上下各展开 5 行。
            </footer>
          )}
        </div>
      </div>
    </section>
  );
}

function cssEscape(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}
