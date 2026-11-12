import type { ReviewContext, ReviewSession } from '../types';

const PREFIX = 'intentflow.review.';
const KEY = (id: string) => `${PREFIX}${id}`;

/**
 * Review JSON lives in the browser, not next to the repository. The workbench
 * is a viewer: nothing is written to disk, and the user copies the document
 * out through 「提交 Review」.
 */
export function saveLocalReview(doc: ReviewSession): void {
  try {
    const stored = JSON.stringify({ ...doc, updated_at: new Date().toISOString() });
    localStorage.setItem(KEY(doc.context.comparison_id), stored);
  } catch {
    // Quota exceeded: keep the in-memory state, the copy action still works.
  }
}

export function loadLocalReview(context: ReviewContext): ReviewSession | null {
  try {
    const raw = localStorage.getItem(KEY(context.comparison_id));
    if (!raw) return null;
    const doc = JSON.parse(raw) as ReviewSession;
    if (doc?.version !== 1 || doc.context?.comparison_id !== context.comparison_id) return null;
    return {
      ...doc,
      comments: doc.comments ?? [],
      viewed: doc.viewed ?? [],
      reviewed_hunks: doc.reviewed_hunks ?? [],
    };
  } catch {
    return null;
  }
}

export interface LocalDraft {
  comparison_id: string;
  updated_at: string;
  comments: number;
}

/** Drafts of the same branch session, for the 「其他草稿」 list. */
export function listLocalDrafts(context: ReviewContext): LocalDraft[] {
  const out: LocalDraft[] = [];
  try {
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (!key?.startsWith(PREFIX)) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const doc = JSON.parse(raw) as ReviewSession;
      if (doc?.context?.session_id !== context.session_id) continue;
      if (doc.context.comparison_id === context.comparison_id || !doc.comments?.length) continue;
      out.push({ comparison_id: doc.context.comparison_id, updated_at: doc.updated_at ?? '', comments: doc.comments.length });
    }
  } catch {
    return out;
  }
  return out.sort((left, right) => right.updated_at.localeCompare(left.updated_at));
}

export interface RestoreOutcome {
  document: ReviewSession;
  adjusted: number;
}

function lines(source: string | undefined): number {
  return source ? source.split('\n').length : 0;
}

/**
 * Copy another comparison's draft into the current one. Comments whose line
 * anchors no longer exist become general comments, and viewed marks for files
 * that are gone are dropped — the same rule the server store applies.
 */
export function restoreLocalDraft(context: ReviewContext, files: Array<{ path: string; before?: string; after?: string }>, comparisonId: string): RestoreOutcome | null {
  const source = loadLocalReview({ ...context, comparison_id: comparisonId });
  if (!source) return null;
  const byPath = new Map(files.map((file) => [file.path, file]));
  let adjusted = 0;
  const comments = source.comments.map((comment) => {
    if (!comment.quote) return comment;
    const file = byPath.get(comment.quote.file);
    const length = file ? lines(comment.quote.side === 'before' ? file.before : file.after) : 0;
    if (length && comment.quote.start >= 1 && comment.quote.end <= length) return comment;
    adjusted++;
    return { ...comment, quote: undefined };
  });
  const viewed = source.viewed.filter((entry) => byPath.has(entry.split('#')[0]));
  const document: ReviewSession = {
    ...source,
    context,
    comments,
    viewed,
    reviewed_hunks: (source.reviewed_hunks ?? []).filter((key) => byPath.has(key.split('@')[0])),
    updated_at: '',
  };
  return { document, adjusted };
}
