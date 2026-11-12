import { useEffect, useState } from 'react';
import { cx } from '../lib/format';
import { uid } from '../lib/id';
import { listLocalDrafts, restoreLocalDraft } from '../lib/localReview';
import { useApp, useAppDispatch } from '../state/AppProvider';
import type { Comment } from '../types';
import { CommentCard } from './CommentCard';
import { CommentComposer } from './CommentComposer';
import { IconBot, IconCheck, IconComment } from './Icons';
import styles from './RightPanel.module.css';

type Tab = 'ai' | 'signals' | 'review';

export function RightPanel() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const tab = state.rightTab;
  const close = () => {
    if (state.drawer === 'right') dispatch({ type: 'drawer/set', drawer: null });
    else dispatch({ type: 'panel/toggle', panel: 'right' });
  };

  return <div className={styles.panel}>
    <div className={styles.tabs} role="tablist" aria-label="分析与评审">
      <TabButton id="ai" label="AI" tab={tab} />
      <TabButton id="signals" label="SyntaxFlow" tab={tab} />
      <TabButton id="review" label="Review" meta={state.comments.length ? String(state.comments.length) : undefined} tab={tab} />
      <button className={styles.close} type="button" aria-label="关闭评审面板" title="关闭评审面板" onClick={close}>×</button>
    </div>
    {tab === 'ai' ? <DisabledTab
      icon={<IconBot width={20} height={20} />}
      title="AI 分析未启用"
      body="当前版本只做文本 diff 和人工评审。AI 结论需要语义事实，而 SSA 已从默认工作台移除。"
      hint="评审可以复制 JSON 交给外部 Agent；入口在顶部「提交 Review」。"
    /> : tab === 'signals' ? <DisabledTab
      icon={<IconCheck width={20} height={20} />}
      title="SyntaxFlow 未启用"
      body="规则扫描依赖 SSA。当前构建不编译被评审代码，因此没有规则命中列表。"
      hint="需要规则结果时，可在另一个进程里跑扫描，再把结论写成评论。"
    /> : <ReviewTab />}
  </div>;
}

function TabButton({ id, label, meta, tab }: { id: Tab; label: string; meta?: string; tab: Tab }) {
  const dispatch = useAppDispatch();
  return <button
    type="button"
    role="tab"
    aria-selected={tab === id}
    aria-controls={`tab-${id}`}
    className={cx(styles.tab, tab === id && styles.tabActive)}
    onClick={() => dispatch({ type: 'tab/set', tab: id })}
  >
    {label}
    {meta && <span>{meta}</span>}
  </button>;
}

function DisabledTab({ icon, title, body, hint }: { icon: React.ReactNode; title: string; body: string; hint: string }) {
  return <div className={styles.disabled} role="tabpanel">
    <span className={styles.disabledIcon}>{icon}</span>
    <h3>{title}</h3>
    <p>{body}</p>
    <p className={styles.disabledHint}>{hint}</p>
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
