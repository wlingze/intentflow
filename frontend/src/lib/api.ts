import type { CommitList, Payload, ReviewState } from '../types';

export async function fetchPayload(commits?: string[]): Promise<Payload> {
  const params = new URLSearchParams(window.location.search);
  const override = params.get('payload');
  let url = override || '/api/payload';
  if (!override && commits) {
    const query = new URLSearchParams({ commits: commits.join(',') });
    url = `/api/payload?${query}`;
  }
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `无法加载 payload（HTTP ${response.status}）`);
  }
  return (await response.json()) as Payload;
}

export async function fetchCommits(): Promise<CommitList> {
  const response = await fetch('/api/commits', { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法加载提交列表（HTTP ${response.status}）`);
  }
  return (await response.json()) as CommitList;
}

export async function submitReview(
  markdown: string,
  data: ReviewState,
): Promise<{ path?: string }> {
  const response = await fetch('/api/review', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ markdown, data }),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return (await response.json()) as { path?: string };
}
