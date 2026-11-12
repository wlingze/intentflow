import type { Comment, Finding, Review, ReviewSession } from '../types';

export function commentScope(comment: Comment): string {
  if (!comment.quote) return '整体意见';
  const { file, start, end, side } = comment.quote;
  const range = end > start ? `${start}-${end}` : `${start}`;
  return `${file}:${range} · ${side === 'before' ? '改动前' : '改动后'}`;
}

function quoteBlock(comment: Comment): string {
  if (!comment.quote?.snippet) return '';
  const snippet = comment.quote.snippet
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
  return `${snippet}\n`;
}

export function buildReviewMarkdown(
  review: Review,
  doc: ReviewSession,
  findings: Finding[] = [],
): string {
  const lines: string[] = [];
  lines.push(`# Review: ${review.before} → ${review.after}`);
  lines.push('');
  lines.push(`仓库：${doc.context.repository}`);
  lines.push(`分支：${doc.context.branch}`);
  lines.push(`比较：${doc.context.revision} · ${doc.context.base.slice(0, 12)} → ${doc.context.head.slice(0, 12)}`);
  lines.push('');
  lines.push('## Review 意见');
  lines.push('');

  if (!doc.comments.length) {
    lines.push('（暂无评论）');
    lines.push('');
  } else {
    doc.comments.forEach((comment, index) => {
      lines.push(`### ${index + 1}. ${commentScope(comment)}${comment.resolved ? '（已解决）' : ''}`);
      lines.push('');
      lines.push(quoteBlock(comment).trimEnd());
      if (comment.quote?.snippet) lines.push('');
      if (comment.title) lines.push(`**${comment.title}**`);
      lines.push(comment.text.trim());
      lines.push('');
    });
  }

  if (findings.length) {
    lines.push('## 重点位置');
    lines.push('');
    for (const finding of findings) {
      lines.push(`- [${finding.category_title}] ${finding.title} — ${finding.file}:${finding.line}`);
      if (finding.snippet) lines.push(`  - \`${finding.snippet}\``);
    }
    lines.push('');
  }

  if (review.notes?.length) {
    lines.push('## 运行说明');
    lines.push('');
    for (const note of review.notes) lines.push(`- ${note}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd() + '\n';
}
