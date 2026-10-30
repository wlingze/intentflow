import { useEffect, useRef, type ReactNode } from 'react';
import styles from './App.module.css';
import { BehaviorSidebar } from './components/BehaviorSidebar';
import { CodeStage } from './components/CodeStage';
import { Composer } from './components/Composer';
import { FileTree } from './components/FileTree';
import { SymbolView } from './components/SymbolView';
import { IconChevronDown, IconChevronRight } from './components/Icons';
import { ReviewPanel } from './components/ReviewPanel';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useTheme } from './hooks/useTheme';
import { cx } from './lib/format';
import { useApp, useAppDispatch } from './state/AppProvider';
import { useReviewData } from './state/selectors';

function Loading() {
  return (
    <div className={styles.loading}>
      <div className={styles.loadingInner}>
        <div className={styles.spinner} />
        <span>正在载入 review payload…</span>
      </div>
    </div>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className={styles.loading}>
      <div className={styles.error}>
        <h2>无法载入 payload</h2>
        <p>{message}</p>
        <code>intentflow serve --before … --after … --dist frontend/dist</code>
      </div>
    </div>
  );
}

function Panel({
  title,
  meta,
  open,
  onToggle,
  actions,
  children,
}: {
  title: string;
  meta?: ReactNode;
  open: boolean;
  onToggle: () => void;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={cx(styles.panel, open && styles.panelOpen)}>
      <div className={styles.panelHead}>
        <button type="button" className={styles.panelToggle} onClick={onToggle} aria-expanded={open}>
          {open ? <IconChevronDown width={11} height={11} /> : <IconChevronRight width={11} height={11} />}
          <span>{title}</span>
          {meta && <em>{meta}</em>}
        </button>
        {actions}
      </div>
      {open && <div className={styles.panelBody}>{children}</div>}
    </section>
  );
}

export default function App() {
  const { payload, loading, error, view, panels, drawer } = useApp();
  const { pref, setPref } = useTheme();
  const dispatch = useAppDispatch();
  const { files, review } = useReviewData();
  const composerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = composerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      document.documentElement.style.setProperty('--composer-h', `${element.offsetHeight}px`);
    });
    observer.observe(element);
    document.documentElement.style.setProperty('--composer-h', `${element.offsetHeight}px`);
    return () => observer.disconnect();
  }, [payload]);

  const changed = files.filter((file) => file.status !== 'unchanged').length;

  return (
    <div className={styles.shell}>
      <TopBar pref={pref} onPrefChange={setPref} />
      {loading ? (
        <Loading />
      ) : error || !payload ? (
        <ErrorState message={error ?? 'payload 为空'} />
      ) : (
        <>
          <div className={styles.main}>
            <aside className={cx(styles.left, drawer === 'left' && styles.drawerOpen)}>
              <Panel
                title="文件"
                meta={`${changed}/${files.length}`}
                open={panels.files}
                onToggle={() => dispatch({ type: 'panel/toggle', panel: 'files' })}
              >
                <FileTree variant="files" />
              </Panel>
              <Panel
                title="符号图"
                meta={
                  review
                    ? `${review.symbols.stats.functions}ƒ ${review.symbols.stats.types}T`
                    : undefined
                }
                open={panels.graph}
                onToggle={() => dispatch({ type: 'panel/toggle', panel: 'graph' })}
              >
                <div className={styles.miniGraph}>
                  <SymbolView compact />
                </div>
              </Panel>
              <div className={styles.leftRest}>
                <BehaviorSidebar />
              </div>
            </aside>

            <main className={styles.center}>
              {view === 'graph' ? <SymbolView /> : <CodeStage />}
            </main>

            <aside className={cx(styles.right, drawer === 'right' && styles.drawerOpen)}>
              <ReviewPanel />
            </aside>
          </div>

          {drawer && (
            <div
              className={styles.backdrop}
              role="presentation"
              onClick={() => dispatch({ type: 'drawer/set', drawer: null })}
            />
          )}
          <div className={styles.composerSlot} ref={composerRef}>
            <Composer />
          </div>
        </>
      )}
      <Toast />
    </div>
  );
}
