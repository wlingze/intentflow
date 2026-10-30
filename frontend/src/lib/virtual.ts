export const DEFAULT_ROW_HEIGHT = 20;

export interface VirtualWindow {
  /** 第一条渲染的行的下标（含）。 */
  start: number;
  /** 最后一条之后的下标（不含）。 */
  end: number;
  /** 第一条渲染的行距内容顶部的偏移。 */
  top: number;
  totalHeight: number;
}

/**
 * offsets 是长度 count+1 的累积偏移，offsets[i] 是第 i 行的顶部。
 * 返回包含 offset 的行下标；offset 超出末尾时返回最后一行。
 */
export function findRowAtOffset(offsets: Float64Array, offset: number): number {
  const count = offsets.length - 1;
  if (count <= 0) return 0;
  if (!Number.isFinite(offset) || offset <= 0) return 0;
  if (offset >= offsets[count]) return count - 1;

  let lo = 0;
  let hi = count - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export function computeWindow(
  offsets: Float64Array,
  scrollTop: number,
  viewportHeight: number,
  overscan = 12,
): VirtualWindow {
  const count = offsets.length - 1;
  if (count <= 0) return { start: 0, end: 0, top: 0, totalHeight: 0 };

  const totalHeight = offsets[count];
  const top = Math.min(Math.max(scrollTop, 0), totalHeight);
  const height = Math.max(0, viewportHeight);
  const first = findRowAtOffset(offsets, top);
  const bottom = Math.min(totalHeight, top + height);
  const last =
    height > 0 ? findRowAtOffset(offsets, Math.max(top, bottom - 0.001)) : first;
  const padding = Math.max(0, Math.floor(overscan));
  const start = Math.max(0, first - padding);
  const end = Math.min(count, last + 1 + padding);

  return { start, end, top: offsets[start], totalHeight };
}

/** 行高缓存：未测量的行使用估算值，测量变化时才重建累积偏移。 */
export class RowVirtualizer {
  readonly count: number;
  private readonly estimate: number;
  private readonly heights: Float64Array;
  private offsets: Float64Array;
  private dirty = true;

  constructor(count: number, estimate = DEFAULT_ROW_HEIGHT) {
    this.count = Math.max(0, Math.floor(count));
    this.estimate = estimate > 0 ? estimate : DEFAULT_ROW_HEIGHT;
    this.heights = new Float64Array(this.count);
    this.offsets = new Float64Array(this.count + 1);
  }

  /** 返回行高是否真的变化；重复测量同一高度不会触发重建。 */
  setHeight(index: number, height: number): boolean {
    if (index < 0 || index >= this.count || !Number.isFinite(height)) return false;
    const next = Math.max(1, height);
    const previous = this.heights[index];
    const effective = previous > 0 ? previous : this.estimate;
    this.heights[index] = next;
    if (Math.abs(effective - next) < 0.5) return false;
    this.dirty = true;
    return true;
  }

  offsetOf(index: number): number {
    this.build();
    const clamped = Math.min(Math.max(index, 0), this.count);
    return this.offsets[clamped];
  }

  heightOf(index: number): number {
    if (index < 0 || index >= this.count) return this.estimate;
    this.build();
    return this.offsets[index + 1] - this.offsets[index];
  }

  get totalHeight(): number {
    this.build();
    return this.offsets[this.count];
  }

  get cumulativeOffsets(): Float64Array {
    this.build();
    return this.offsets;
  }

  window(scrollTop: number, viewportHeight: number, overscan = 12): VirtualWindow {
    this.build();
    return computeWindow(this.offsets, scrollTop, viewportHeight, overscan);
  }

  private build(): void {
    if (!this.dirty) return;
    let total = 0;
    this.offsets[0] = 0;
    for (let index = 0; index < this.count; index++) {
      const height = this.heights[index] || this.estimate;
      total += height;
      this.offsets[index + 1] = total;
    }
    this.dirty = false;
  }
}
