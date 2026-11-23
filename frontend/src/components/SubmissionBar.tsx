import { useEffect, useState } from 'react';
import { submitReview } from '../lib/api';
import { buildCancel, buildSubmission } from '../lib/submission';
import { useApp, useAppDispatch } from '../state/AppProvider';
import type { ReviewSubmissionVerdict } from '../types';
import styles from './SubmissionBar.module.css';

const VERDICTS: Array<{ value: ReviewSubmissionVerdict; label: string; title: string }> = [
  { value: 'approve', label: '通过', title: '可以合并' },
  { value: 'request-changes', label: '要求修改', title: 'agent 应按评论修改' },
  { value: 'comment', label: '仅评论', title: '只给意见，不表态' },
];

type Phase = 'idle' | 'sending' | 'done' | 'cancelled';

/**
 * The only write path of a `review --wait` session. The EventSource keeps the
 * waiter alive; closing every page cancels the agent's wait after a grace.
 */
export function SubmissionBar() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const [verdict, setVerdict] = useState<ReviewSubmissionVerdict>('comment');
  const [summary, setSummary] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');

  const enabled = Boolean(state.payload?.submission?.enabled);
  const busy = phase === 'sending';
  const settled = phase === 'done' || phase === 'cancelled';
  useEffect(() => {
    if (!enabled || settled) return;
    const source = new EventSource('/api/events');
    return () => source.close();
  }, [enabled, settled]);

  if (!enabled || !state.payload) return null;
  const context = state.payload.session.context;

  const submit = async () => {
    if (busy || settled) return;
    setPhase('sending');
    setError('');
    try {
      await submitReview(buildSubmission(context, state.comments, verdict, summary));
      setPhase('done');
      dispatch({ type: 'toast/show', message: '审阅已提交，agent 会收到结果', kind: 'success' });
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
      setPhase('cancelled');
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setPhase('idle');
      setError(message);
    }
  };

  return <section className={styles.bar} aria-label="提交审阅">
    {!settled && <div className={styles.verdict} role="group" aria-label="审阅结论">
      {VERDICTS.map((item) => <button key={item.value} type="button" aria-pressed={verdict === item.value}
        title={item.title} disabled={busy} onClick={() => setVerdict(item.value)}>{item.label}</button>)}
    </div>}
    {!settled && <input className={styles.summary} aria-label="审阅总结" placeholder="总结（可选）" maxLength={65536} value={summary}
      disabled={busy} onChange={(event) => setSummary(event.target.value)} />}
    <span className={styles.count}>{state.comments.length} 条意见</span>
    {error && <span className={styles.error} role="alert">{error}</span>}
    {phase === 'done' && <span className={styles.done}>已提交，可以关闭页面</span>}
    {phase === 'cancelled' && <span className={styles.done}>已取消，可以关闭页面</span>}
    {!settled && <>
      <button type="button" className={styles.cancel} disabled={busy} onClick={() => void cancel()}>取消审阅</button>
      <button type="button" className={`btn btnPrimary ${styles.submit}`} disabled={busy} onClick={() => void submit()}>
        {busy ? '提交中…' : '提交并关闭'}
      </button>
    </>}
  </section>;
}
