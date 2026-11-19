import type { Review } from '../types';

type BaseStatus = Pick<Review, 'baseLabel' | 'baseBehind' | 'baseUpstream' | 'needsRebase'>;

// baseSummary 只负责拼接展示文案；基线落后不阻断启动。
export function baseSummary(review: BaseStatus): string {
  const parts = [`基线 ${review.baseLabel}`];
  if (review.needsRebase) {
    parts.push(review.baseBehind > 0 && review.baseUpstream
      ? `落后 ${review.baseUpstream} ${review.baseBehind} 个提交，建议 rebase`
      : '建议 rebase');
  } else if (review.baseUpstream) {
    parts.push(`已包含 ${review.baseUpstream}`);
  }
  return parts.join(' · ');
}