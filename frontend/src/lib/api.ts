import type { Payload, RevisionList } from '../types';

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

/** Legacy review images still referenced by `/api/review/assets/<name>`. */
export function reviewAssetUrl(name: string): string {
  return `/api/review/assets/${encodeURIComponent(name)}`;
}
