import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { useApp, useAppDispatch } from './state/AppProvider';
import { TopBar } from './components/TopBar';
import { DiffStage } from './components/DiffStage';
import { FileTree } from './components/FileTree';
import { RightPanel } from './components/RightPanel';
import { SearchPanel } from './components/SearchPanel';
import { SymbolPanel } from './components/SymbolPanel';
import { Toast } from './components/Toast';
import styles from './App.module.css';

function clampWidth(width: number) { return Math.max(280, Math.min(760, Math.floor(window.innerWidth * 0.48), width)); }

const LEFT_MIN = 200;
const LEFT_MAX = 620;
const LEFT_DEFAULT = 320;

function leftLimit(reviewWidth: number, rightOpen: boolean): number {
  // Keep at least 360px for the diff when both side panels are open.
  const available = window.innerWidth - (rightOpen ? reviewWidth : 0);
  return Math.max(LEFT_MIN, Math.min(LEFT_MAX, available - 360));
}

function clampLeft(width: number, reviewWidth: number, rightOpen: boolean): number {
  return Math.max(LEFT_MIN, Math.min(leftLimit(reviewWidth, rightOpen), Math.round(width)));
}

function initialLeftWidth(): number {
  try {
    const stored = Number(localStorage.getItem('intentflow.left-width'));
    if (Number.isFinite(stored) && stored > 0) return Math.min(LEFT_MAX, Math.max(LEFT_MIN, stored));
  } catch { /* optional preference */ }
  return window.innerWidth <= 1300 ? 260 : LEFT_DEFAULT;
}

export function App() {
  const { payload, loading, error, panels, drawer, revisionLoading } = useApp();
  const dispatch = useAppDispatch();
  const shell = useRef<HTMLDivElement>(null);
  const dragWidth = useRef(410);
  const [width, setWidth] = useState(() => { try { return Number(localStorage.getItem('intentflow.review-width')) || 410; } catch { return 410; } });
  const [dragging, setDragging] = useState(false);
  const leftBase = useRef(LEFT_DEFAULT);
  const leftOrigin = useRef(0);
  const leftNext = useRef(LEFT_DEFAULT);
  const [leftWidth, setLeftWidth] = useState(initialLeftWidth);
  const [leftDragging, setLeftDragging] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  useEffect(() => { try { localStorage.setItem('intentflow.review-width', String(width)); } catch { /* optional preference */ } }, [width]);
  useEffect(() => { try { localStorage.setItem('intentflow.left-width', String(leftWidth)); } catch { /* optional preference */ } }, [leftWidth]);
  useEffect(() => { setLeftWidth((value) => clampLeft(value, width, panels.right)); }, [width, panels.right]);
  useEffect(() => {
    const onResize = () => setLeftWidth((value) => clampLeft(value, width, panels.right));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [width, panels.right]);
  useEffect(() => {
    if (!drawer) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') dispatch({ type: 'drawer/set', drawer: null }); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer, dispatch]);
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
    setWidth(clampWidth(dragWidth.current));
  };
  const startLeftDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    leftBase.current = event.currentTarget.parentElement!.getBoundingClientRect().width;
    leftOrigin.current = event.clientX;
    leftNext.current = leftBase.current;
    event.currentTarget.setPointerCapture(event.pointerId);
    setLeftDragging(true);
  };
  const moveLeftDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const next = clampLeft(leftBase.current + event.clientX - leftOrigin.current, width, panels.right);
    leftNext.current = next;
    shell.current?.style.setProperty('--left-width', `${next}px`);
  };
  const endLeftDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    setLeftDragging(false);
    setLeftWidth(clampLeft(leftNext.current, width, panels.right));
  };
  const leftKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const max = leftLimit(width, panels.right);
    const next = event.key === 'Home' ? LEFT_MIN : event.key === 'End' ? max : leftWidth + (event.key === 'ArrowRight' ? 24 : -24);
    setLeftWidth(clampLeft(next, width, panels.right));
  };
  if (loading) return <div className={styles.splash}><span className={styles.mark}>if</span><p>正在读取 diff…</p></div>;
  if (error || !payload) return <div className={styles.splash} role="alert"><span className={styles.mark}>if</span><h1>无法打开工作台</h1><p className={styles.error}>{error ?? 'payload 为空'}</p><p>检查服务端输出和 --base 参数。</p></div>;
  return <div ref={shell} className={styles.shell} data-right={panels.right} data-resizing={dragging || leftDragging} style={{ '--review-width': `${width}px`, '--left-width': `${leftWidth}px` } as CSSProperties}>
    <div className={styles.workspace}>
      <TopBar onSearch={() => setSearchOpen(true)} />
      <main className={styles.main} inert={!!revisionLoading}>
        {panels.files && <aside id="file-sidebar" className={styles.left} aria-label="文件导航">
          <FileTree /><SymbolPanel />
          <div className={styles.leftResizer} role="separator" aria-label="调整文件导航宽度" aria-orientation="vertical" aria-controls="file-sidebar" aria-valuemin={LEFT_MIN} aria-valuemax={leftLimit(width, panels.right)} aria-valuenow={Math.round(leftWidth)} tabIndex={0}
            onDoubleClick={() => setLeftWidth(clampLeft(LEFT_DEFAULT, width, panels.right))}
            onPointerDown={startLeftDrag} onPointerMove={moveLeftDrag} onPointerUp={endLeftDrag} onPointerCancel={endLeftDrag}
            onKeyDown={leftKey} />
        </aside>}
        <DiffStage />
      </main>
    </div>
    {panels.right && <aside id="review-panel" className={styles.right} aria-label="评审信息">
      <div className={styles.resizer} role="separator" aria-label="调整评审面板宽度" aria-orientation="vertical" aria-controls="review-panel" aria-valuemin={280} aria-valuemax={760} aria-valuenow={Math.round(width)} tabIndex={0}
        onDoubleClick={() => setWidth(410)}
        onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); dragWidth.current = event.currentTarget.parentElement!.getBoundingClientRect().width; event.currentTarget.setPointerCapture(event.pointerId); setDragging(true); }}
        onPointerMove={(event) => { if (!event.currentTarget.hasPointerCapture(event.pointerId)) return; dragWidth.current = clampWidth(window.innerWidth - event.clientX); shell.current?.style.setProperty('--review-width', `${dragWidth.current}px`); }}
        onPointerUp={endDrag} onPointerCancel={endDrag}
        onKeyDown={(event) => { if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return; event.preventDefault(); setWidth(clampWidth(event.key === 'Home' ? 280 : event.key === 'End' ? 760 : width + (event.key === 'ArrowLeft' ? 24 : -24))); }} />
      <RightPanel />
    </aside>}
    {drawer && <button type="button" className={styles.overlay} aria-label="关闭面板" onClick={() => dispatch({ type: 'drawer/set', drawer: null })} />}
    {drawer === 'left' && <div className={styles.drawerLeft}><FileTree /><SymbolPanel /></div>}
    {drawer === 'right' && <div className={styles.drawerRight}><RightPanel /></div>}
    <Toast />
    <SearchPanel open={searchOpen} onOpen={() => setSearchOpen(true)} onClose={() => setSearchOpen(false)} />
  </div>;
}
