import type { Payload, ReviewState } from '../types';

export async function fetchPayload(): Promise<Payload> {
  const params = new URLSearchParams(window.location.search);
  const url = params.get('payload') || '/api/payload';
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`无法加载 payload（HTTP ${response.status}）`);
  }
  return (await response.json()) as Payload;
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
