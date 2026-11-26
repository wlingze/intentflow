import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiPath, shutdownServer } from './api';

describe('apiPath', () => {
  it('stays relative so static and PR-prefixed pages share one client', () => {
    expect(apiPath('payload.json')).toBe('api/payload.json');
    expect(apiPath('revisions.json')).toBe('api/revisions.json');
  });
});

describe('shutdownServer', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts to api/shutdown relative to the page', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ status: 'closing' }), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await shutdownServer();
    expect(fetchMock).toHaveBeenCalledWith('api/shutdown', expect.objectContaining({ method: 'POST', cache: 'no-store' }));
  });

  it('surfaces the server error message', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: '只允许同源页面或本机请求关闭服务' }), {
      status: 403, headers: { 'Content-Type': 'application/json' },
    }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(shutdownServer()).rejects.toThrow('只允许同源页面或本机请求关闭服务');
  });
});
