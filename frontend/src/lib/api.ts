import type { Payload, RevisionList } from '../types';

// Relative on purpose: the live server, a static export and a PR path such as
// /pr/owner/repo/4/ all resolve api/*.json next to the page.
export function apiPath(name: string): string {
  return `api/${name}`;
}

async function jsonResponse<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error ?? `HTTP ${response.status}`);
  return body;
}

export async function fetchPayload(revision?: string): Promise<Payload> {
  const query = revision ? `?revision=${encodeURIComponent(revision)}` : '';
  return jsonResponse<Payload>(await fetch(`${apiPath('payload.json')}${query}`, { cache: 'no-store' }));
}

export async function fetchRevisions(): Promise<RevisionList> {
  return jsonResponse<RevisionList>(await fetch(apiPath('revisions.json'), { cache: 'no-store' }));
}
