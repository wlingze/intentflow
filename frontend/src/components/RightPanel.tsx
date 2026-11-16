import { useEffect, useState } from 'react';
import { uid } from '../lib/id';
import { listLocalDrafts, restoreLocalDraft } from '../lib/localReview';
import { useApp, useAppDispatch } from '../state/AppProvider';
import type { Comment } from '../types';
import { CommentCard } from './CommentCard';
import { CommentComposer } from './CommentComposer';
import { IconComment } from './Icons';
import styles from './RightPanel.module.css';

export function RightPanel() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const close = () => {
    if (state.drawer === 'right') dispatch({ type: 'drawer/set', drawer: null });
    else dispatch({ type: 'panel/toggle', panel: 'right' });
  };

  return <div className={styles.panel}>
    <div className={styles.head}>
      <span className={styles.title}>Review{state.comments.length ? <span className={styles.count}>{state.comments.length}</span> : null}</span>
      <button className={styles.close} type="button" aria-label="关闭评审面板" title="关闭评审面板" onClick={close}>×</button>
    </div>
    <ReviewTab />
  </div>;
}

function ReviewTab() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const [drafts, setDrafts] = useState<ReturnType<typeof listLocalDrafts>>([]);
  const [restoring, setRestoring] = useState('');
  const comparison = state.payload?.session.context.comparison_id;

  useEffect(() => {
    if (!comparison) return;
    const context = state.payload?.session.context;
    setDrafts(context ? listLocalDrafts(context) : []);
  }, [comparison, state.payload?.session.context]);

  const restore = (draft: ReturnType<typeof listLocalDrafts>[number]) => {
    const context = state.payload?.session.context;
    const files = state.payload?.code.files ?? [];
    if (!context) return;
    setRestoring(draft.comparison_id);
    const result = restoreLocalDraft(context, files, draft.comparison_id);
    setRestoring('');
    if (!result) {
      dispatch({ type: 'toast/show', message: '找不到这份草稿', kind: 'error' });
      return;
    }
    dispatch({ type: 'review/imported', document: result.document });
    setDrafts((current) => current.filter((item) => item.comparison_id !== draft.comparison_id));
    dispatch({ type: 'toast/show', message: `已恢复 ${result.document.comments.length} 条意见${result.adjusted ? `；${result.adjusted} 条失效行号改为不绑定行号` : ''}`, kind: 'success' });
  };

  return <div className={styles.body} id="tab-review" role="tabpanel">
    {drafts.length > 0 && <section className={styles.drafts} aria-label="其他草稿">
      <span>这个分支还有 {drafts.length} 份旧草稿</span>
      {drafts.map((draft) => <button key={draft.comparison_id} type="button" disabled={restoring === draft.comparison_id} onClick={() => restore(draft)}>
        {restoring === draft.comparison_id ? '恢复中…' : `恢复 ${draft.comments} 条`}
      </button>)}
    </section>}
    <div className={styles.composerWrap}>
      <CommentComposer
        compact
        rows={2}
        placeholder="写一条评审意见，或粘贴图片…"
        onSubmit={(text) => {
          const comment: Comment = {
            id: uid('c-'), text, title: '', source: 'manual', signalId: '', createdAt: Date.now(),
            resolved: false,
          };
          dispatch({ type: 'comment/add', comment });
        }}
      />
    </div>
    {state.comments.length ? <div className={styles.comments}>
      {state.comments.map((comment) => <CommentCard key={comment.id} comment={comment} />)}
    </div> : <div className={styles.empty}><IconComment width={22} height={22} /><span>还没有意见</span></div>}
  </div>;
}
