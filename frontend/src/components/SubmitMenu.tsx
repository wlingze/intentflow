import { useEffect, useRef, useState } from 'react';
import { shutdownServer, submitReview } from '../lib/api';
import type { ReviewEvent } from '../lib/api';
import { appQuery } from '../lib/dom';
import { copyText, downloadText } from '../lib/files';
import { buildReviewMarkdown } from '../lib/markdown';
import { buildCancel, buildSubmission } from '../lib/submission';
import { reviewDocument, saveCurrentReview, useApp, useAppDispatch, useWorkbenchSource } from '../state/AppProvider';
import type { ReviewSubmissionVerdict } from '../types';
import { IconChevronDown } from './Icons';
import styles from './SubmitMenu.module.css';

const VERDICTS: Array<{ value: ReviewSubmissionVerdict; label: string; title: string }> = [
  { value: 'approve', label: '通过', title: '可以合并' },
  { value: 'request-changes', label: '要求修改', title: 'agent 应按评论修改' },
  { value: 'comment', label: '仅评论', title: '只给意见，不表态' },
];

type Phase = 'idle' | 'sending' | 'done' | 'cancelled';

export function SubmitMenu() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const [event, setEvent] = useState<ReviewEvent>('COMMENT');
  const [publishing, setPublishing] = useState(false);
  const [closing, setClosing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const source = useWorkbenchSource();
  const [verdict, setVerdict] = useState<ReviewSubmissionVerdict>('comment');
  const [summary, setSummary] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  const submissionEnabled = Boolean(state.payload?.submission?.enabled);
  const busy = phase === 'sending';
  const settled = phase === 'done' || phase === 'cancelled';
  const unresolved = state.comments.filter((comment) => !comment.resolved).length;

  const toast = (message: string, kind: 'success' | 'error' = 'success') => dispatch({ type: 'toast/show', message, kind });
  const markdown = () => buildReviewMarkdown(state.payload!.review, reviewDocument(state));
  const copyMarkdown = async () => {
    if (!state.payload) return;
    const ok = await copyText(markdown());
    toast(ok ? 'Review Markdown 已复制' : '复制失败', ok ? 'success' : 'error');
  };

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current || !event.composedPath().includes(rootRef.current)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  // The EventSource is the page presence heartbeat. It stays connected while
  // the menu is closed, so a page that is still open never cancels the wait.
  useEffect(() => {
    if (!submissionEnabled || settled) return;
    const source = new EventSource('/api/events');
    return () => source.close();
  }, [submissionEnabled, settled]);

  // Browsers only allow a script to close a tab it opened. Try anyway; when
  // the call is blocked the goodbye screen stays and asks the human to close.
  useEffect(() => {
    if (!settled) return;
    const timer = window.setTimeout(() => window.close(), 150);
    return () => window.clearTimeout(timer);
  }, [settled]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.key !== 'Enter' || event.isComposing) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]')) return;
      if (appQuery('[role="dialog"]')) return;
      event.preventDefault();
      void copyMarkdown();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.payload, state.comments, state.viewed, state.reviewedHunks]);

  if (!state.payload) return null;

  if (settled) {
    const submitted = phase === 'done';
    return <div className={styles.goodbye} role="status" aria-live="polite">
      <span className={styles.goodbyeMark}>if</span>
      <h1>{submitted ? '审阅已提交' : '审阅已取消'}</h1>
      <p>{submitted ? 'agent 已收到结果，可以关闭此页面。' : 'agent 已收到取消结果，可以关闭此页面。'}</p>
    </div>;
  }

  const context = state.payload.session.context;
  const json = () => JSON.stringify(reviewDocument(state), null, 2) + '\n';
  const close = () => setOpen(false);
  const copy = async (text: string, label: string) => {
    const ok = await copyText(text);
    toast(ok ? `${label} 已复制` : '复制失败', ok ? 'success' : 'error');
    close();
  };
  const save = (text: string, extension: 'md' | 'json', label: string, type: string) => {
    downloadText(`intentflow-review-${Date.now()}.${extension}`, text, type);
    toast(`${label} 已保存`, 'success');
    close();
  };
  // 先落本地草稿再提交：网络失败时不丢评审内容。
  const publish = async () => {
    if (!source.publishReview || publishing) return;
    setPublishing(true);
    try {
      await saveCurrentReview(state, dispatch);
      const message = await source.publishReview(reviewDocument(state), event);
      toast(message, 'success');
      close();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setPublishing(false);
    }
  };
  const send = async () => {
    if (busy || settled) return;
    setPhase('sending');
    setError('');
    try {
      await submitReview(buildSubmission(context, state.comments, verdict, summary));
      setOpen(false);
      setPhase('done');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPhase('idle');
      setError(message);
      dispatch({ type: 'toast/show', message: `提交失败：${message}`, kind: 'error' });
    }
  };
  const cancel = async () => {
    if (busy || settled) return;
    if (!window.confirm('取消本次审阅？agent 会收到取消结果。')) return;
    setPhase('sending');
    setError('');
    try {
      await submitReview(buildCancel(context));
      setOpen(false);
      setPhase('cancelled');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPhase('idle');
      setError(message);
    }
  };
  // 服务端先回 200 再停监听；失败时留在页面并提示原因。
  const shutdown = async () => {
    if (closing) return;
    if (!window.confirm('关闭服务？页面会停止刷新，可以之后重新启动 intentflow。')) return;
    setClosing(true);
    try {
      await shutdownServer();
      close();
      dispatch({ type: 'service/closed' });
    } catch (error) {
      setClosing(false);
      toast(`关闭失败：${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`btn btnPrimary ${styles.trigger}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!!state.revisionLoading}
        title="提交 Review（⌘↵ 或 Ctrl+↵ 直接复制 Markdown）"
      >
        提交 Review
        <IconChevronDown width={13} height={13} />
      </button>
      {open && (
        <div className={styles.menu} role="dialog" aria-label="提交评审">
          {submissionEnabled && <>
            <div className={styles.submitBlock}>
              <div className={styles.submitHead}>
                <b>提交并关闭</b>
                <span>{unresolved} 条意见</span>
              </div>
              <div className={styles.verdict} role="group" aria-label="审阅结论">
                {VERDICTS.map((item) => <button key={item.value} type="button" aria-pressed={verdict === item.value}
                  title={item.title} disabled={busy} onClick={() => setVerdict(item.value)}>{item.label}</button>)}
              </div>
              <textarea className={styles.summary} aria-label="审阅总结" placeholder="总结（可选）" rows={2} maxLength={65536}
                disabled={busy} value={summary} onChange={(event) => setSummary(event.target.value)} />
              {error && <div className={styles.error} role="alert">{error}</div>}
              <div className={styles.submitActions}>
                <button type="button" className={styles.cancel} disabled={busy} onClick={() => void cancel()}>取消审阅</button>
                <button type="button" className={`btn btnPrimary ${styles.submit}`} disabled={busy} onClick={() => void send()}>
                  {busy ? '提交中…' : '提交并关闭'}
                </button>
              </div>
            </div>
            <div className={styles.sectionLabel}>导出副本</div>
          </>}
          <div className={styles.row}>
            <div className={styles.label}>
              <b>Markdown</b>
              <em>人类可读的评审</em>
            </div>
            <button type="button" className={styles.action} aria-label="复制 Markdown" onClick={() => void copy(markdown(), 'Markdown')}>复制</button>
            <button type="button" className={styles.action} aria-label="保存 Markdown 文件" onClick={() => save(markdown(), 'md', 'Markdown', 'text/markdown;charset=utf-8')}>保存文件</button>
          </div>
          <div className={styles.row}>
            <div className={styles.label}>
              <b>JSON</b>
              <em>完整评审数据</em>
            </div>
            <button type="button" className={styles.action} aria-label="复制 JSON" onClick={() => void copy(json(), 'JSON')}>复制</button>
            <button type="button" className={styles.action} aria-label="保存 JSON 文件" onClick={() => save(json(), 'json', 'JSON', 'application/json;charset=utf-8')}>保存文件</button>
          </div>
          {state.publishLabel && source.publishReview && (
            <div className={styles.row}>
              <div className={styles.label}>
                <b>{state.publishLabel}</b>
                <em>用当前登录会话提交到 PR</em>
              </div>
              <select
                className={styles.select}
                value={event}
                onChange={(change) => setEvent(change.target.value as ReviewEvent)}
                aria-label="提交方式"
                disabled={publishing}
              >
                <option value="COMMENT">评论</option>
                <option value="APPROVE">通过</option>
                <option value="REQUEST_CHANGES">请求修改</option>
              </select>
              <button type="button" className={styles.action} aria-label="发布到 GitHub" onClick={() => void publish()} disabled={publishing}>
                {publishing ? '提交中…' : '发布'}
              </button>
            </div>
          )}
          {state.payload.capabilities?.shutdown && (
            <div className={`${styles.row} ${styles.footer}`}>
              <div className={styles.label}>
                <b>服务</b>
                <em>关闭本地工作台</em>
              </div>
              <button type="button" className={`${styles.action} ${styles.danger}`} aria-label="关闭服务" onClick={() => void shutdown()} disabled={closing}>
                {closing ? '关闭中…' : '关闭服务'}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
