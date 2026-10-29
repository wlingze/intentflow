import { useEffect, useRef } from 'react';
import styles from './App.module.css';
import { CodeDrawer } from './components/CodeDrawer';
import { Composer } from './components/Composer';
import { FileTree } from './components/FileTree';
import { GraphView } from './components/GraphView';
import { ReviewPanel } from './components/ReviewPanel';
import { Toast } from './components/Toast';
import { TopBar } from './components/TopBar';
import { useTheme } from './hooks/useTheme';
import { useApp } from './state/AppProvider';

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
        <code>intentflow serve --before … --after … --frontend frontend/dist</code>
      </div>
    </div>
  );
}

export default function App() {
  const { payload, loading, error } = useApp();
  const { pref, setPref } = useTheme();
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
            <aside className={styles.left}>
              <FileTree />
            </aside>
            <main className={styles.center}>
              <GraphView />
            </main>
            <aside className={styles.right}>
              <ReviewPanel />
            </aside>
          </div>
          <div className={styles.composerSlot} ref={composerRef}>
            <Composer />
          </div>
          <CodeDrawer />
        </>
      )}
      <Toast />
    </div>
  );
}
