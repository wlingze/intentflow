import type { Payload, RestoreResult, ReviewDraftList, ReviewSession, RevisionList } from '../types';

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

export async function fetchPayload(revision?: string): Promise<Payload> {
  const query = revision ? `?revision=${encodeURIComponent(revision)}` : '';
  return jsonResponse<Payload>(await fetch(`/api/payload${query}`, { cache: 'no-store' }));
}

export async function fetchRevisions(): Promise<RevisionList> {
  return jsonResponse<RevisionList>(await fetch('/api/revisions', { cache: 'no-store' }));
}

// Preserve request order: a slower autosave must not overwrite a newer edit/import.
let saveQueue: Promise<unknown> = Promise.resolve();
export function saveReviewSession(doc: ReviewSession): Promise<ReviewSession> {
  const next = saveQueue.catch(() => undefined).then(async () => jsonResponse<ReviewSession>(
    await fetch('/api/review/state', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(doc),
    }),
  ));
  saveQueue = next;
  return next;
}

export async function uploadReviewAsset(file: Blob): Promise<string> {
  const body = await jsonResponse<{ name: string }>(await fetch('/api/review/assets', {
    method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file,
  }));
  if (!body.name) throw new Error('服务端没有返回图片名');
  return body.name;
}

export async function fetchReviewDrafts(): Promise<ReviewDraftList> {
  return jsonResponse<ReviewDraftList>(await fetch('/api/review/drafts', { cache: 'no-store' }));
}

export async function restoreReviewDraft(comparisonId: string, relax: boolean): Promise<RestoreResult> {
  return jsonResponse<RestoreResult>(await fetch(`/api/review/drafts/${encodeURIComponent(comparisonId)}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ relax }),
  }));
}

export function reviewAssetUrl(name: string): string {
  return `/api/review/assets/${encodeURIComponent(name)}`;
}
