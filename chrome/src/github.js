import { commentBody } from './payload.js';
import { indexPatch, parsePatch } from './patch.js';

const API = 'https://api.github.com';
const TOKEN_KEY = 'intentflow.github.token';
let memoryToken = '';

export function parsePrUrl(value = location.href) {
  const match = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/|$)/.exec(new URL(value).pathname);
  if (!match) return null;
  return { owner: match[1], repo: match[2], number: Number(match[3]) };
}

function gmValue(key, fallback) {
  try {
    if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
  } catch { /* fall through */ }
  return memoryToken && key === TOKEN_KEY ? memoryToken : fallback;
}

function gmSetValue(key, value) {
  if (key === TOKEN_KEY) memoryToken = value;
  try {
    if (typeof GM_setValue === 'function') GM_setValue(key, value);
  } catch { /* memory only */ }
}

export function getToken() {
  return gmValue(TOKEN_KEY, '') || (typeof window !== 'undefined' ? window.__INTENTFLOW_TOKEN__ || '' : '');
}

export function setToken(value) {
  gmSetValue(TOKEN_KEY, String(value || '').trim());
}

export function askToken(force = false) {
  let token = getToken();
  if (token && !force) return token;
  token = window.prompt('GitHub token（fine-grained: Pull requests Read and write；仅存 Tampermonkey）', token);
  if (token) setToken(token.trim());
  return getToken();
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

function apiHeaders(token, accept = 'application/vnd.github+json') {
  const headers = { Accept: accept, 'X-GitHub-Api-Version': '2022-11-28' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
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
  if (status === 403 || status === 429) message += '；可能是权限不足或触发限流';
  if (status === 401) message += '；token 无效或已过期';
  return new Error(`${message} [${url}]`);
}

async function apiJSON(path, token, accept) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const response = await request({ url, headers: apiHeaders(token, accept) });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, response.text, url);
  try { return JSON.parse(response.text); } catch { throw new Error(`GitHub API 返回非 JSON：${url}`); }
}

async function apiText(path, token, accept) {
  const url = path.startsWith('http') ? path : `${API}${path}`;
  const response = await request({ url, headers: apiHeaders(token, accept) });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, response.text, url);
  return response.text;
}

export async function fetchDiff(owner, repo, number) {
  const token = getToken();
  const url = `https://github.com/${owner}/${repo}/pull/${number}.diff`;
  try {
    // GitHub redirects .diff to patch-diff.githubusercontent.com. Page fetch
    // is blocked by GitHub's connect-src; GM_xmlhttpRequest bypasses it.
    const response = await request({ url, headers: { Accept: 'text/plain' } });
    if (response.status >= 200 && response.status < 300) {
      const text = response.text;
      if (text.trim() && !text.trimStart().startsWith('<!DOCTYPE')) return text;
    }
  } catch { /* fall back to the API */ }
  return apiText(`/repos/${owner}/${repo}/pulls/${number}`, token, 'application/vnd.github.v3.diff');
}

export async function fetchPull(owner, repo, number) {
  const token = getToken();
  try {
    return await apiJSON(`/repos/${owner}/${repo}/pulls/${number}`, token);
  } catch (error) {
    // Public pages can still be reviewed without a token; metadata is optional.
    return { title: '', base: null, head: null, _error: error instanceof Error ? error.message : String(error) };
  }
}

export async function fetchComments(owner, repo, number) {
  const token = getToken();
  const out = [];
  try {
    for (let page = 1; page <= 10; page += 1) {
      const items = await apiJSON(`/repos/${owner}/${repo}/pulls/${number}/comments?per_page=100&page=${page}`, token);
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
  const token = askToken();
  if (!token) throw new Error('缺少 GitHub token，无法提交 review');
  const url = `${API}/repos/${owner}/${repo}/pulls/${number}/reviews`;
  const response = await request({
    method: 'POST',
    url,
    headers: { ...apiHeaders(token), 'Content-Type': 'application/json' },
    data: JSON.stringify(review),
  });
  if (response.status < 200 || response.status >= 300) throw apiError(response.status, response.text, url);
  return JSON.parse(response.text);
}
