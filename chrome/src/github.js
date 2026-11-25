import { commentBody } from './payload.js';
import { indexPatch, parsePatch } from './patch.js';

const API = 'https://api.github.com';

export function parsePrUrl(value = location.href) {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(new URL(value).pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function request(options) {
  return new Promise((resolve, reject) => {
    if (typeof GM_xmlhttpRequest === 'function') {
      GM_xmlhttpRequest({
        method: options.method || 'GET',
        url: options.url,
        headers: options.headers || {},
        data: options.data,
        timeout: 30000,
        onload: (response) => resolve({ status: response.status, text: response.responseText, headers: response.responseHeaders || '' }),
        onerror: () => reject(new Error('GitHub 请求失败：网络错误')),
        ontimeout: () => reject(new Error('GitHub 请求超时')),
      });
      return;
    }
    fetch(options.url, {
      method: options.method || 'GET',
      headers: options.headers || {},
      body: options.data,
      credentials: 'include',
    }).then(async (response) => resolve({ status: response.status, text: await response.text(), headers: '' }))
      .catch(reject);
  });
}

function apiHeaders(accept = 'application/vnd.github+json') {
  return { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
}

function apiError(status, text, url) {
  let message = `GitHub API HTTP ${status}`;
  try {
    const body = JSON.parse(text);
    if (body.message) message = `GitHub API: ${body.message}`;
    if (Array.isArray(body.errors) && body.errors.length) {
      message += `（${body.errors.map((item) => item.message || item.code || JSON.stringify(item)).join('; ')}）`;
    }
  } catch { /* plain text */ }
  if (status === 403 || status === 429) message += '；权限不足、限流，或私有仓库需要登录会话';
  if (status === 401) message += '；GitHub 拒绝了这次读取';
  return new Error(`${message} [${url}]`);
}

async function apiJSON(path, accept) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const response = await request({ url, headers: apiHeaders(accept) });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, response.text, url);
  try { return JSON.parse(response.text); } catch { throw new Error(`GitHub API 返回非 JSON：${url}`); }
}

async function apiText(path, accept) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const response = await request({ url, headers: apiHeaders(accept) });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, response.text, url);
  return response.text;
}

export async function fetchDiff(owner, repo, number) {
  const url = `https://github.com/${owner}/${repo}/pull/${number}.diff`;
  try {
    // GitHub redirects .diff to patch-diff.githubusercontent.com. Page fetch
    // is blocked by GitHub's connect-src; GM_xmlhttpRequest bypasses it and
    // carries the browser session, so private repositories work without a PAT.
    const response = await request({ url, headers: { Accept: 'text/plain' } });
    if (response.status >= 200 && response.status < 300) {
      const text = response.text;
      if (text.trim() && !text.trimStart().startsWith('<!DOCTYPE')) return text;
    }
  } catch { /* fall back to the API */ }
  return apiText(`/repos/${owner}/${repo}/pulls/${number}`, 'application/vnd.github.v3.diff');
}

export async function fetchPull(owner, repo, number) {
  try {
    return await apiJSON(`/repos/${owner}/${repo}/pulls/${number}`);
  } catch (error) {
    // Public pages can still be reviewed without a token; metadata is optional.
    return { title: '', base: null, head: null, _error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchComments(owner, repo, number) {
  const out = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const items = await apiJSON(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100&page=${page}`);
      if (!Array.isArray(items)) break;
      out.push(...items);
      if (items.length < 100) break;
    }
  } catch {
    return out;
  }
  return out;
}

export function importComments(items) {
  return items.map((item) => {
    const comment = {
      id: `gh-${item.id}`,
      text: item.body || '',
      title: '',
      source: 'manual',
      signalId: '',
      createdAt: Date.parse(item.created_at) || Date.now(),
    };
    const line = item.line ?? item.original_line;
    const start = item.start_line ?? item.original_start_line;
    if (item.path && Number.isInteger(line) && line >= 1) {
      const side = item.side === 'LEFT' || item.original_side === 'LEFT' ? 'before' : 'after';
      comment.quote = {
        file: item.path,
        side,
        start: Number.isInteger(start) && start >= 1 && start <= line ? start : line,
        end: line,
        snippet: '',
      };
    } else if (item.path) {
      comment.title = item.path;
    }
    return comment;
  });
}

function inRange(ranges, start, end) {
  return ranges.some((range) => start >= range.start && end <= range.end);
}

export function mapReview(doc, diffText) {
  const parsed = parsePatch(diffText);
  const index = indexPatch(parsed.files);
  const inline = [];
  const general = [];
  const unmapped = [];

  for (const comment of doc.comments || []) {
    if (!comment || comment.resolved || String(comment.id || '').startsWith('gh-')) continue;
    const text = commentBody(comment);
    if (!text) continue;
    const quote = comment.quote;
    if (!quote || !quote.file) {
      general.push(text);
      continue;
    }
    const ranges = index.get(quote.file);
    const side = quote.side === 'before' ? 'LEFT' : 'RIGHT';
    const list = ranges ? (side === 'LEFT' ? ranges.old : ranges.new) : [];
    const start = Number(quote.start);
    const end = Number(quote.end);
    if (!ranges || !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || !inRange(list, start, end)) {
      unmapped.push(`- \`${quote.file}\` ${start}-${end}（${side === 'LEFT' ? '改动前' : '改动后'}）：${text}`);
      continue;
    }
    if (start === end) {
      inline.push({ path: quote.file, body: text, line: end, side });
    } else {
      inline.push({ path: quote.file, body: text, start_line: start, start_side: side, line: end, side });
    }
  }

  const body = [];
  if (general.length) body.push(`## 整体意见\n\n${general.join('\n\n')}`);
  if (unmapped.length) body.push(`## 未映射到当前 diff 的评论\n\n${unmapped.join('\n')}`);
  return { body: body.join('\n\n'), comments: inline, skipped: unmapped.length };
}

export async function submitReview(owner, repo, number, review) {
  const paths = webReviewPaths(owner, repo, number);
  let token = findAuthenticityToken();
  if (!token) token = await fetchAuthenticityToken(paths.page);
  if (!token) throw new Error('GitHub 未登录或页面缺少表单令牌；请刷新 PR 页面后重试');

  let posted = 0;
  try {
    for (const comment of review.comments ?? []) {
      await postNativeForm(paths.comment, reviewCommentFields(comment), token);
      posted += 1;
    }
    await postNativeForm(paths.review, reviewFields(review), token);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const suffix = posted ? `（已创建 ${posted} 条待提交评论，可在 GitHub 页面继续）` : '';
    throw new Error(`${message}${suffix}`);
  }
  return { comments: posted, event: review.event || 'COMMENT' };
}

export function webReviewPaths(owner, repo, number) {
  const base = `/${owner}/${repo}/pull/${number}`;
  return { page: base, comment: `${base}/review_comments`, review: `${base}/reviews` };
}

export function reviewCommentFields(comment) {
  const fields = {
    'pull_request_review_comment[body]': comment.body ?? '',
    'pull_request_review_comment[path]': comment.path ?? '',
    'pull_request_review_comment[line]': String(comment.line ?? ''),
    'pull_request_review_comment[side]': comment.side ?? 'RIGHT',
  };
  if (comment.start_line) {
    fields['pull_request_review_comment[start_line]'] = String(comment.start_line);
    fields['pull_request_review_comment[start_side]'] = comment.start_side ?? comment.side ?? 'RIGHT';
  }
  return fields;
}

export function reviewFields(review) {
  return {
    'pull_request_review[body]': review.body ?? '',
    'pull_request_review[event]': review.event ?? 'COMMENT',
  };
}

export function findAuthenticityToken(root = document) {
  return root.querySelector('input[name="authenticity_token"]')?.value
    || root.querySelector('meta[name="csrf-token"]')?.getAttribute('content')
    || '';
}

async function fetchAuthenticityToken(path) {
  try {
    const response = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
    if (!response.ok) return '';
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return findAuthenticityToken(doc);
  } catch {
    return '';
  }
}

async function postNativeForm(path, fields, token) {
  const body = new URLSearchParams({ authenticity_token: token, ...fields });
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      Accept: 'text/html,application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest',
    },
    body: body.toString(),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(nativeError(response.status, text));
  if (new URL(response.url, location.href).pathname.startsWith('/login')) {
    throw new Error('GitHub 登录已失效，请重新登录');
  }
  return { status: response.status, url: response.url };
}

function nativeError(status, text) {
  let message = '';
  try {
    const doc = new DOMParser().parseFromString(text, 'text/html');
    message = doc.querySelector('.flash-error, .flash-notice, [role="alert"], .error')?.textContent?.trim() ?? '';
  } catch { /* plain text */ }
  if (!message) message = text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  return `GitHub 返回 HTTP ${status}${message ? `：${message.slice(0, 300)}` : ''}`;
}
