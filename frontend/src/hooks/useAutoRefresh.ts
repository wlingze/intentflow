import { useEffect, useLayoutEffect, useRef } from 'react';
import { apiPath } from '../lib/api';
import { pickRevision } from '../lib/revisions';
import { useApp, useAppDispatch, useWorkbenchSource } from '../state/AppProvider';

const DEBOUNCE_MS = 400;

/**
 * Watches /api/events and refreshes the diff after a settled local edit.
 *
 * Only the worktree revision refreshes its own diff. On other revisions the
 * event just updates the dirty dot in the revision picker, so reading an old
 * commit is not interrupted. Review state (comments, viewed marks, drafts)
 * lives in the reducer and is kept across a refresh.
 */
export function useAutoRefresh() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const source = useWorkbenchSource();
  const latest = useRef(state);
  useLayoutEffect(() => { latest.current = state; }, [state]);
  const watch = Boolean(state.payload?.capabilities?.watch);
  const closed = state.closed;

  useEffect(() => {
    if (!watch || closed || typeof EventSource === 'undefined') return;
    let disposed = false;
    let timer: number | undefined;
    let running = false;
    let queued = false;

    const schedule = () => {
      if (disposed) return;
      if (running) {
        queued = true;
        return;
      }
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        void refresh();
      }, DEBOUNCE_MS);
    };

    // Reverting the last edit removes the worktree revision. Fall back to the
    // first remaining revision so the page never keeps a stale selection.

    const refresh = async () => {
      if (disposed) return;
      const start = latest.current;
      if (!start.payload) return;
      // 切换 revision 或自动保存中：先让当前请求结束，避免互相覆盖。
      if (start.revisionLoading || start.saveStatus === 'saving') {
        schedule();
        return;
      }
      const startId = start.revisionId || start.payload.session.context.revision;
      const worktree = startId === 'worktree' || start.payload.session.context.revision === 'worktree';
      running = true;
      try {
        const revisions = await source.fetchRevisions();
        if (!worktree) {
          // 读旧提交时不打断：只更新 dirty 圆点。
          if (!disposed) dispatch({ type: 'revisions/loaded', revisions });
          return;
        }
        const payload = await source.fetchPayload(pickRevision(startId, revisions));
        if (disposed) return;
        const live = latest.current;
        if (live.revisionLoading || (live.revisionId || live.payload?.session.context.revision) !== startId) return;
        dispatch({ type: 'payload/refresh', id: payload.session.context.revision, payload });
        dispatch({ type: 'revisions/loaded', revisions });
        dispatch({ type: 'toast/show', message: '检测到本地修改，已刷新', kind: 'info' });
      } catch (error) {
        if (disposed) return;
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: 'toast/show', message: `自动刷新失败：${message}`, kind: 'error' });
      } finally {
        running = false;
        if (queued) {
          queued = false;
          schedule();
        }
      }
    };

    const events = new EventSource(apiPath('events'));
    events.addEventListener('repo-changed', schedule);
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
      events.close();
    };
  }, [watch, closed, source, dispatch]);
}
