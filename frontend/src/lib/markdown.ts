import type { Comment, Review, Signal } from '../types';

export function commentScope(comment: Comment): string {
  if (!comment.quote) return '未指定文件';
  const { file, start, end, side } = comment.quote;
  const range = end > start ? `${start}-${end}` : `${start}`;
  return `${file}:${range} · ${side}`;
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
  comments: Comment[],
  signals: Signal[],
  dismissed: string[],
): string {
  const lines: string[] = [];
  lines.push(`# Review: ${review.before} → ${review.after}`);
  lines.push('');
  lines.push('## Review 意见');
  lines.push('');

  if (!comments.length) {
    lines.push('（暂无评论）');
    lines.push('');
  } else {
    comments.forEach((comment, index) => {
      lines.push(`### ${index + 1}. ${commentScope(comment)}`);
      lines.push('');
      lines.push(quoteBlock(comment).trimEnd());
      if (comment.quote?.snippet) lines.push('');
      if (comment.title) lines.push(`**${comment.title}**`);
      lines.push(comment.text.trim());
      lines.push('');
    });
  }

  const dismissedSignals = signals.filter((signal) => dismissed.includes(signal.id));
  if (dismissedSignals.length) {
    lines.push('## 已忽略的 SyntaxFlow 告警');
    lines.push('');
    for (const signal of dismissedSignals) {
      lines.push(`- [${signal.severity}] ${signal.title}`);
      if (signal.detail) lines.push(`  - ${signal.detail}`);
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

export function buildAgentPrompt(markdown: string): string {
  return [
    '你是代码 review agent。请根据下面的 review 意见修改代码，并逐条回复处理结果。',
    '每条意见都带有文件范围和引用代码；不要修改范围之外的代码。',
    '',
    markdown.trim(),
  ].join('\n');
}
