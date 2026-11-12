import { describe, expect, it } from 'vitest';
import { RowVirtualizer, computeWindow, findRowAtOffset } from './virtual';

describe('findRowAtOffset', () => {
  const offsets = Float64Array.from([0, 20, 40, 60, 80]);

  it('finds the row containing an offset', () => {
    expect(findRowAtOffset(offsets, -5)).toBe(0);
    expect(findRowAtOffset(offsets, 0)).toBe(0);
    expect(findRowAtOffset(offsets, 19.9)).toBe(0);
    expect(findRowAtOffset(offsets, 20)).toBe(1);
    expect(findRowAtOffset(offsets, 55)).toBe(2);
    expect(findRowAtOffset(offsets, 79.9)).toBe(3);
  });

  it('clamps at the end', () => {
    expect(findRowAtOffset(offsets, 80)).toBe(3);
    expect(findRowAtOffset(offsets, 1_000)).toBe(3);
    expect(findRowAtOffset(Float64Array.from([0]), 12)).toBe(0);
  });
});

describe('computeWindow', () => {
  const offsets = new RowVirtualizer(100, 20).cumulativeOffsets;

  it('renders the top with overscan', () => {
    expect(computeWindow(offsets, 0, 200, 2)).toEqual({
      start: 0,
      end: 12,
      top: 0,
      totalHeight: 2_000,
    });
  });

  it('renders the middle with overscan', () => {
    expect(computeWindow(offsets, 1_000, 200, 2)).toEqual({
      start: 48,
      end: 62,
      top: 960,
      totalHeight: 2_000,
    });
  });

  it('renders the bottom with overscan', () => {
    expect(computeWindow(offsets, 1_800, 200, 2)).toEqual({
      start: 88,
      end: 100,
      top: 1_760,
      totalHeight: 2_000,
    });
  });

  it('handles an empty list and an unmeasured viewport', () => {
    expect(computeWindow(Float64Array.from([0]), 0, 0, 12)).toEqual({
      start: 0,
      end: 0,
      top: 0,
      totalHeight: 0,
    });
    expect(computeWindow(offsets, 0, 0, 2)).toEqual({
      start: 0,
      end: 3,
      top: 0,
      totalHeight: 2_000,
    });
  });
});

describe('RowVirtualizer', () => {
  it('uses the estimate for unmeasured rows', () => {
    const virtualizer = new RowVirtualizer(10, 25);
    expect(virtualizer.totalHeight).toBe(250);
    expect(virtualizer.offsetOf(4)).toBe(100);
    expect(virtualizer.heightOf(4)).toBe(25);
  });

  it('rebuilds offsets only when a height actually changes', () => {
    const virtualizer = new RowVirtualizer(100, 20);

    expect(virtualizer.setHeight(5, 20)).toBe(false);
    expect(virtualizer.cumulativeOffsets[6]).toBe(120);
    expect(virtualizer.setHeight(5, 20)).toBe(false);

    expect(virtualizer.setHeight(5, 40)).toBe(true);
    const after = virtualizer.cumulativeOffsets;
    expect(virtualizer.totalHeight).toBe(2_020);
    expect(virtualizer.offsetOf(5)).toBe(100);
    expect(virtualizer.offsetOf(6)).toBe(140);
    expect(findRowAtOffset(after, 139)).toBe(5);
    expect(findRowAtOffset(after, 140)).toBe(6);
  });

  it('keeps the window stable around unchanged rows after a measurement', () => {
    const virtualizer = new RowVirtualizer(100, 20);
    const topWindow = virtualizer.window(0, 200, 2);

    virtualizer.setHeight(50, 60);
    const movedTop = virtualizer.window(0, 200, 2);
    expect({ start: movedTop.start, end: movedTop.end, top: movedTop.top }).toEqual({
      start: topWindow.start,
      end: topWindow.end,
      top: topWindow.top,
    });
    expect(movedTop.totalHeight).toBe(2_040);

    const middle = virtualizer.window(1_000, 200, 2);
    expect(middle.start).toBe(48);
    expect(middle.end).toBe(60);
    expect(virtualizer.offsetOf(50)).toBe(1_000);
    expect(virtualizer.heightOf(50)).toBe(60);
  });
});

describe('RowVirtualizer per-index estimates', () => {
  it('uses the caller estimate for unmeasured rows', () => {
    const heights = [22, 26, 32];
    const virtual = new RowVirtualizer(3, 20, (index) => heights[index]);
    expect(virtual.totalHeight).toBe(80);
    expect(virtual.offsetOf(2)).toBe(48);
  });

  it('keeps measured heights after they replace the estimate', () => {
    const virtual = new RowVirtualizer(2, 20, (index) => (index === 0 ? 22 : 32));
    expect(virtual.setHeight(0, 30)).toBe(true);
    expect(virtual.heightOf(0)).toBe(30);
    expect(virtual.heightOf(1)).toBe(32);
    expect(virtual.totalHeight).toBe(62);
  });
});
