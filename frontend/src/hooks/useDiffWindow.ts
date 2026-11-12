import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RowVirtualizer, type VirtualWindow } from '../lib/virtual';

/** Virtual rows in the shared document scroller, not a nested scrolling pane. */
export function useDiffWindow(count: number, identity: unknown, estimatedHeight = 22) {
  const ref = useRef<HTMLDivElement>(null);
  const virtual = useMemo(() => new RowVirtualizer(count, estimatedHeight), [count, identity, estimatedHeight]);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<VirtualWindow>({ start: 0, end: 0, top: 0, totalHeight: count * estimatedHeight });
  const refresh = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const element = ref.current;
    const scroller = element?.closest<HTMLElement>('[data-review-scroll]');
    if (!element || !scroller) return;
    let frame = 0;
    let near = true;
    const sync = () => {
      frame = 0;
      const parent = scroller.getBoundingClientRect();
      const rect = element.getBoundingClientRect();
      const next = near ? virtual.window(Math.max(0, parent.top - rect.top), scroller.clientHeight, 12)
        : { start: 0, end: 0, top: 0, totalHeight: virtual.totalHeight };
      setRange((previous) => previous.start === next.start && previous.end === next.end && previous.top === next.top && previous.totalHeight === next.totalHeight ? previous : next);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(sync); };
    refresh.current = schedule;
    const observer = new IntersectionObserver(([entry]) => { near = entry.isIntersecting; schedule(); }, { root: scroller, rootMargin: '500px' });
    observer.observe(element);
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    const onScroll = () => { if (near) schedule(); };
    scroller.addEventListener('scroll', onScroll, { passive: true });
    sync();
    return () => { observer.disconnect(); resize.disconnect(); scroller.removeEventListener('scroll', onScroll); cancelAnimationFrame(frame); };
  }, [virtual]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let frame = 0;
    const pending = new Map<number, number>();
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.virtualRow);
        pending.set(index, entry.borderBoxSize[0]?.blockSize ?? entry.contentRect.height);
      }
      if (!frame) frame = requestAnimationFrame(() => {
        let changed = false;
        for (const [index, height] of pending) changed = virtual.setHeight(index, height) || changed;
        pending.clear(); frame = 0;
        if (changed) { setRevision((value) => value + 1); refresh.current(); }
      });
    });
    element.querySelectorAll<HTMLElement>('[data-virtual-row]').forEach((row) => observer.observe(row));
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [virtual, range.start, range.end]);
  void revision;
  return { ref, virtual, range };
}
