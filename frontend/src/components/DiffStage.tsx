import { useEffect, useRef } from 'react';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import { FileDiffCard } from './FileDiffCard';
import { IconBranch } from './Icons';
import { sortedPaths } from '../lib/visibleFiles';
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
  const visible = useRef<string[]>([]);

  // 一个观察器管全部卡片：屏内文件给文件树用（灰色），近处文件挂载正文。
  // 每张卡片各自建观察器时，上千文件会让回调迟到十几秒。
  useEffect(() => {
    const root = scroller.current;
    if (!root || typeof IntersectionObserver === 'undefined') return;
    const onScreen = new Set<string>();
    const near = new Set<string>();
    let frame = 0;
    let lastVisible = '';
    let lastMounted = '';
    const flush = () => {
      frame = 0;
      const visibleList = sortedPaths(onScreen);
      const mountedList = sortedPaths(near);
      const visibleKey = visibleList.join('\n');
      const mountedKey = mountedList.join('\n');
      if (visibleKey === lastVisible && mountedKey === lastMounted) return;
      lastVisible = visibleKey;
      lastMounted = mountedKey;
      visible.current = visibleList;
      dispatch({ type: 'code/visible', files: visibleList, mounted: mountedList });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(flush); };
    const onScreenObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const path = (entry.target as HTMLElement).dataset.file;
        if (!path) continue;
        if (entry.isIntersecting) onScreen.add(path);
        else onScreen.delete(path);
      }
      schedule();
    }, { root, threshold: 0 });
    const nearObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const path = (entry.target as HTMLElement).dataset.file;
        if (!path) continue;
        if (entry.isIntersecting) near.add(path);
        else near.delete(path);
      }
      schedule();
    }, { root, rootMargin: '2000px 0px' });
    for (const element of root.querySelectorAll<HTMLElement>('[data-file]')) {
      onScreenObserver.observe(element);
      nearObserver.observe(element);
    }
    return () => {
      onScreenObserver.disconnect();
      nearObserver.disconnect();
      if (frame) cancelAnimationFrame(frame);
      visible.current = [];
    };
  }, [files, dispatch]);

  // 跳转第一步：不管有没有行号，都先把目标卡片滚进视口。行级定位由卡片
  // 在挂载后自己完成；卡片不在视口附近时正文不挂载，所以必须由这里先滚。
  useEffect(() => {
    if (!code.reveal) return;
    const target = scroller.current?.querySelector<HTMLElement>(`[data-file="${cssEscape(code.reveal.file)}"]`);
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  }, [code.reveal, code.revealToken]);

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
              mounted={code.mounted.includes(file.path)}
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
