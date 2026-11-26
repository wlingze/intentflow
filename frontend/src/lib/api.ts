import type { Payload, ReviewSession, ReviewSubmission, RevisionList } from '../types';

export type ReviewEvent = 'COMMENT' | 'APPROVE' | 'REQUEST_CHANGES';

// 页面只认数据源，不根据 URL 猜测能否发布。静态导出的 GitHub PR 仍然只读。
export interface WorkbenchSource {
  fetchPayload: (revision?: string) => Promise<Payload>;
  fetchRevisions: () => Promise<RevisionList>;
  /** 有值表示能发布：显示在「提交 Review」菜单和顶栏的远端来源名。 */
  publishLabel?: string;
  publishReview?: (document: ReviewSession, event: ReviewEvent) => Promise<string>;
}

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

// 服务端先写完 200 再关闭监听；网络在响应后断开属于成功路径。
export async function shutdownServer(): Promise<void> {
  await jsonResponse<{ status: string }>(await fetch(apiPath('shutdown'), {
    method: 'POST',
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  }));
}

export const httpSource: WorkbenchSource = { fetchPayload, fetchRevisions };

export async function submitReview(request: ReviewSubmission): Promise<{ status: string }> {
  return jsonResponse<{ status: string }>(await fetch(apiPath('submission'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30000),
  }));
}
