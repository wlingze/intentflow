import type { ReviewContext, ReviewSession } from '../types';

export function sameReviewContext(a: ReviewContext, b: ReviewContext): boolean {
  return (Object.keys(b) as (keyof ReviewContext)[]).every((key) => a[key] === b[key]);
}

export function parseReviewJSON(raw: string, expected: ReviewContext): ReviewSession {
  const doc = JSON.parse(raw) as Partial<ReviewSession> & Record<string, unknown>;
  if (!doc || doc.version !== 1 || !doc.context || !Array.isArray(doc.comments) || !Array.isArray(doc.viewed)) {
    throw new Error('不是版本 1 的 intentflow 评审 JSON');
  }
  if (!sameReviewContext(doc.context, expected)) {
    throw new Error(`记录属于 ${doc.context.branch || '未知分支'}，仓库、分支或比较范围不匹配；当前评审未修改`);
  }
  // Rebuild known fields so legacy summary/decision/extra keys never reach the
  // strict PUT decoder, and drop marks that predate content hashes.
  return {
    version: 1,
    context: doc.context,
    comments: doc.comments.map((comment) => ({
      id: String(comment.id ?? ''),
      text: String(comment.text ?? ''),
      title: String(comment.title ?? ''),
      source: comment.source === 'signal' || comment.source === 'ai' ? comment.source : 'manual',
      signalId: String(comment.signalId ?? ''),
      createdAt: Number(comment.createdAt ?? 0),
      resolved: Boolean(comment.resolved),
      ...(comment.quote ? {
        quote: {
          file: String(comment.quote.file ?? ''),
          side: comment.quote.side === 'before' ? 'before' as const : 'after' as const,
          start: Number(comment.quote.start ?? 0),
          end: Number(comment.quote.end ?? 0),
          snippet: String(comment.quote.snippet ?? ''),
        },
      } : {}),
    })),
    viewed: doc.viewed.filter((entry): entry is string => typeof entry === 'string' && entry.includes('#')),
    reviewed_hunks: (Array.isArray(doc.reviewed_hunks) ? doc.reviewed_hunks : []).filter((entry): entry is string => typeof entry === 'string' && entry.includes('#')),
    updated_at: String(doc.updated_at ?? ''),
  };
}

export function reviewFilename(doc: ReviewSession): string {
  const branch = doc.context.branch.replace(/[^\p{L}\p{N}._-]+/gu, '-');
  return `intentflow-${branch}-${doc.context.session_id.slice(0, 8)}.json`;
}
