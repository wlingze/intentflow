import { useLayoutEffect, useRef, type PointerEvent, type RefObject } from 'react';
import type { Side } from '../types';
import styles from './FileDiffCard.module.css';

/** One visible, draggable thumb per side, also linked to trackpad/keyboard scrolling. */
export function DiffHorizontalScroll({ root, split, refresh }: { root: RefObject<HTMLElement | null>; split: boolean; refresh: string }) {
  const offsets = useRef({ before: 0, after: 0 });
  const drag = useRef<{ x: number; offset: number; rail: HTMLElement } | null>(null);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    const paint = (side: Side) => {
      const rail = element.querySelector<HTMLElement>(`[data-diff-rail="${side}"]`);
      const thumb = rail?.parentElement?.querySelector<HTMLElement>('[data-scroll-thumb]');
      if (!rail || !thumb) return;
      const width = rail.clientWidth;
      const overflow = rail.scrollWidth - width;
      const thumbWidth = Math.max(24, width * width / Math.max(1, rail.scrollWidth));
      thumb.style.width = `${thumbWidth}px`;
      thumb.style.transform = `translateX(${overflow > 0 ? rail.scrollLeft / overflow * (width - thumbWidth) : 0}px)`;
      thumb.style.display = overflow > 1 ? 'block' : 'none';
    };
    const sync = (side: Side, offset: number) => {
      const rail = element.querySelector<HTMLElement>(`[data-diff-rail="${side}"]`);
      if (rail && Math.abs(rail.scrollLeft - offset) > 0.5) rail.scrollLeft = offset;
      offsets.current[side] = offset;
      element.querySelectorAll<HTMLElement>(`[data-scroll-side="${side}"]`).forEach((cell) => {
        if (Math.abs(cell.scrollLeft - offset) > 0.5) cell.scrollLeft = offset;
      });
      paint(side);
    };
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement;
      const side = target.dataset.scrollSide as Side | undefined;
      if (side && Math.abs(offsets.current[side] - target.scrollLeft) > 0.5) sync(side, target.scrollLeft);
    };
    const resize = new ResizeObserver(() => {
      for (const side of ['before', 'after'] as const) {
        const rail = element.querySelector<HTMLElement>(`[data-diff-rail="${side}"]`);
        const x = Math.min(offsets.current[side], Math.max(0, (rail?.scrollWidth ?? 0) - (rail?.clientWidth ?? 0)));
        sync(side, x);
      }
    });
    for (const side of ['before', 'after'] as const) sync(side, offsets.current[side]);
    resize.observe(element);
    element.addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => { resize.disconnect(); element.removeEventListener('scroll', onScroll, true); };
  }, [root, split, refresh]);

  const start = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const rail = event.currentTarget.parentElement!.querySelector<HTMLElement>('[data-diff-rail]')!;
    drag.current = { x: event.clientX, offset: rail.scrollLeft, rail };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const { rail, x, offset } = current;
    const thumb = Math.max(24, rail.clientWidth * rail.clientWidth / rail.scrollWidth);
    rail.scrollLeft = offset + (event.clientX - x) * (rail.scrollWidth - rail.clientWidth) / Math.max(1, rail.clientWidth - thumb);
  };
  const stop = (event: PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    drag.current = null;
  };
  const track = (side: Side) => <div className={styles.railWrap} key={side}>
    <div className={styles.scrollbar} data-diff-rail={side} data-scroll-side={side} tabIndex={0} role="region" aria-label={split ? `横向滚动${side === 'before' ? '改动前' : '改动后'}代码` : '横向滚动代码'}>
      <div className={side === 'before' ? styles.beforeTrack : styles.afterTrack} />
    </div>
    <div className={styles.scrollThumb} data-scroll-thumb={side} aria-hidden onPointerDown={start} onPointerMove={move} onPointerUp={stop} onPointerCancel={stop} />
  </div>;
  return <div className={styles.scrollbars} data-split={split}>{split && track('before')}{track('after')}</div>;
}
