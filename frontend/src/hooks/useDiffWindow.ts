import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { RowVirtualizer, type VirtualWindow } from '../lib/virtual';

/** Virtual rows in the shared document scroller, not a nested scrolling pane. */
/**
 * Virtual window over rows drawn in the shared document scroller.
 * `active` must turn true together with the element mount: the layout effect
 * reads the element, so it has to re-run once the body really exists.
 */
export function useDiffWindow(count: number, identity: unknown, active: boolean, estimatedHeight = 22, estimateAt?: (index: number) => number) {
  const ref = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- estimateAt reads the same items identity
  const virtual = useMemo(() => new RowVirtualizer(count, estimatedHeight, estimateAt), [count, identity, estimatedHeight]);
  const [revision, setRevision] = useState(0);
  const [range, setRange] = useState<VirtualWindow>(() => ({ start: 0, end: 0, top: 0, totalHeight: virtual.totalHeight }));
  const refresh = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const element = ref.current;
    const scroller = element?.closest<HTMLElement>('[data-review-scroll]');
    if (!element || !scroller) return;
    let frame = 0;
    let near = true;
    let listening = false;
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
    // Only cards near the viewport listen to scroll; a 1300-file review would
    // otherwise run one handler per card on every frame.
    const onScroll = () => { if (near) schedule(); };
    const listen = (value: boolean) => {
      if (value === listening) return;
      listening = value;
      if (value) scroller.addEventListener('scroll', onScroll, { passive: true });
      else scroller.removeEventListener('scroll', onScroll);
    };
    const observer = new IntersectionObserver(([entry]) => { near = entry.isIntersecting; listen(near); schedule(); }, { root: scroller, rootMargin: '900px' });
    observer.observe(element);
    const resize = new ResizeObserver(schedule);
    resize.observe(scroller);
    listen(true);
    schedule();
    return () => { observer.disconnect(); resize.disconnect(); listen(false); cancelAnimationFrame(frame); };
  }, [virtual, active]);

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
