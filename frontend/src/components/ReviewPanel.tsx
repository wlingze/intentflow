import { useMemo, useState } from 'react';
import { cx, shortPath, timeLabel } from '../lib/format';
import { uid } from '../lib/id';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { signalScope, useReviewData } from '../state/selectors';
import type { AISummary, Comment, Fact, Signal } from '../types';
import { IconAlert, IconBot, IconCheck, IconComment, IconPencil, IconTrash } from './Icons';
import styles from './ReviewPanel.module.css';

type SeverityFilter = 'all' | 'high' | 'warn' | 'info';

const SEVERITY: Record<string, string> = {
  high: '高',
  warn: '警告',
  info: '提示',
};

function signalSide(signal: Signal): 'before' | 'after' {
  return signal.title.includes('移除') ? 'before' : 'after';
}

function SignalCard({
  signal,
  facts,
  dismissed,
  kept,
}: {
  signal: Signal;
  facts: Map<string, Fact>;
  dismissed: boolean;
  kept: boolean;
}) {
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const scope = useMemo(() => signalScope(signal, facts), [signal, facts]);

  const openScope = () => {
    if (!scope) return;
    dispatch({ type: 'code/open', file: scope.file, line: scope.line, side: signalSide(signal) });
  };

  const dismiss = () => {
    dispatch({ type: 'signal/dismiss', id: signal.id });
    dispatch({ type: 'toast/show', message: '已标记为没问题，可在「已忽略」里撤销', kind: 'info' });
  };

  const keep = () => {
    if (kept) return;
    const side = signalSide(signal);
    const file = scope ? files.find((candidate) => candidate.path === scope.file) : undefined;
    const source = side === 'before' ? file?.before : file?.after;
    const lineText = source?.split('\n')[(scope?.line ?? 1) - 1]?.trim();
    const snippet = lineText || scope?.fact.snippet || signal.title;
    const comment: Comment = {
      id: uid('c-'),
      text: signal.detail ?? signal.title,
      title: signal.title,
      source: 'signal',
      signalId: signal.id,
      createdAt: Date.now(),
      quote: scope
        ? {
            file: scope.file,
            side,
            start: scope.line ?? 1,
            end: scope.line ?? 1,
            snippet,
          }
        : undefined,
    };
    dispatch({ type: 'signal/keep', id: signal.id, comment });
    dispatch({ type: 'toast/show', message: '已加入 Review', kind: 'success' });
  };

  return (
    <article className={cx(styles.signal, styles[`signal_${signal.severity}`], dismissed && styles.signalDismissed)}>
      <div className={styles.signalHead}>
        <span className={cx(styles.severity, styles[`severity_${signal.severity}`])}>
          <IconAlert width={12} height={12} />
          {SEVERITY[signal.severity] ?? signal.severity}
        </span>
        <span className={styles.confidence}>{signal.confidence}</span>
        {kept && <span className={cx(styles.kept, 'badge', 'badgeGreen')}>已保留</span>}
        {dismissed && <span className={cx(styles.kept, 'badge')}>已忽略</span>}
      </div>
      <h3 className={styles.signalTitle}>{signal.title}</h3>
      {signal.detail && <p className={styles.signalDetail}>{signal.detail}</p>}
      <div className={styles.signalFoot}>
        {scope ? (
          <button type="button" className={styles.scope} onClick={openScope} title={scope.file}>
            {shortPath(scope.file, 34)}
            {scope.line ? `:${scope.line}` : ''}
          </button>
        ) : (
          <span className={styles.scopeMuted}>无文件范围</span>
        )}
        <div className={styles.signalActions}>
          {dismissed ? (
            <button
              type="button"
              className="btn btnGhost btnSmall"
              onClick={() => dispatch({ type: 'signal/undismiss', id: signal.id })}
            >
              撤销忽略
            </button>
          ) : (
            <button type="button" className="btn btnGhost btnSmall" onClick={dismiss}>
              认为没事
            </button>
          )}
          <button
            type="button"
            className={cx('btn btnSmall', kept ? '' : 'btnPrimary')}
            onClick={keep}
            disabled={kept}
          >
            <IconCheck width={12} height={12} />
            {kept ? '已加入 Review' : '认为有问题'}
          </button>
        </div>
      </div>
    </article>
  );
}

function ReviewCard({
  comment,
  editing,
  draft,
  onEdit,
  onDraft,
  onSave,
  onCancel,
  onDelete,
}: {
  comment: Comment;
  editing: boolean;
  draft: string;
  onEdit: () => void;
  onDraft: (text: string) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
}) {
  const dispatch = useAppDispatch();

  const openQuote = () => {
    if (!comment.quote) return;
    dispatch({
      type: 'code/open',
      file: comment.quote.file,
      line: comment.quote.start,
      side: comment.quote.side,
    });
  };

  return (
    <article className={styles.comment}>
      <div className={styles.commentHead}>
        <span className={cx('badge', comment.source === 'signal' ? 'badgeBlue' : 'badgePurple')}>
          {comment.source === 'signal' ? '信号' : '手动'}
        </span>
        {comment.title && <span className={styles.commentTitle}>{comment.title}</span>}
        <time className={styles.time}>{timeLabel(comment.createdAt)}</time>
      </div>

      {comment.quote && (
        <button type="button" className={styles.quote} onClick={openQuote} title={comment.quote.file}>
          <span className={styles.quoteHead}>
            {comment.quote.file}:{comment.quote.start}
            {comment.quote.end > comment.quote.start ? `-${comment.quote.end}` : ''}
            <em>{comment.quote.side}</em>
          </span>
          <span className={styles.quoteText}>{comment.quote.snippet}</span>
        </button>
      )}

      {editing ? (
        <div className={styles.editBox}>
          <textarea
            className="input"
            value={draft}
            rows={4}
            autoFocus
            onChange={(event) => onDraft(event.target.value)}
          />
          <div className={styles.editActions}>
            <button type="button" className="btn btnSmall" onClick={onCancel}>取消</button>
            <button type="button" className="btn btnSmall btnPrimary" onClick={onSave}>保存</button>
          </div>
        </div>
      ) : (
        <p className={styles.commentText}>{comment.text}</p>
      )}

      {!editing && (
        <div className={styles.commentActions}>
          <button type="button" className="btn btnGhost btnSmall" onClick={onEdit}>
            <IconPencil width={12} height={12} />
            修改
          </button>
          <button type="button" className={cx('btn btnGhost btnSmall', styles.delete)} onClick={onDelete}>
            <IconTrash width={12} height={12} />
            删除
          </button>
        </div>
      )}
    </article>
  );
}

function AIPanel({ ai }: { ai?: AISummary }) {
  if (!ai || ai.status !== 'ok') {
    return (
      <div className={styles.aiEmpty}>
        <IconBot width={20} height={20} />
        <h3>{ai?.status === 'error' ? 'LLM 分析失败' : '未启用 LLM 叙述层'}</h3>
        <p>{ai?.summary || '配置 INTENTFLOW_LLM_BASE_URL 与 INTENTFLOW_LLM_API_KEY 后，会在事实层之上生成中文结论。'}</p>
        <code>INTENTFLOW_LLM_BASE_URL=… INTENTFLOW_LLM_MODEL=…</code>
        <span>节点、边、行号仍然只来自 SSA + SyntaxFlow，LLM 不生成事实。</span>
      </div>
    );
  }
  return (
    <div className={styles.aiBody}>
      <article className={styles.aiCard}>
        <div className={styles.aiHead}>
          <span className={styles.aiBadge}><IconBot width={12} height={12} /> LLM 结论</span>
          <span className={styles.aiModel}>{ai.model || 'model'}</span>
        </div>
        <p className={styles.aiSummary}>{ai.summary}</p>
      </article>

      {ai.focus.length > 0 && (
        <article className={styles.aiCard}>
          <h3 className={styles.aiTitle}>优先复核</h3>
          <ol className={styles.focusList}>
            {ai.focus.map((item, index) => (
              <li key={`${index}-${item}`}>{item}</li>
            ))}
          </ol>
        </article>
      )}

      {ai.risks.length > 0 && (
        <article className={styles.aiCard}>
          <h3 className={styles.aiTitle}>风险判断</h3>
          {ai.risks.map((risk, index) => (
            <div key={`${index}-${risk.title}`} className={styles.risk}>
              <div className={styles.riskTitle}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                {risk.title}
              </div>
              <p>{risk.detail}</p>
              {risk.evidence.length > 0 && (
                <div className={styles.riskEvidence}>
                  {risk.evidence.map((item) => (
                    <code key={item}>{item}</code>
                  ))}
                </div>
              )}
            </div>
          ))}
        </article>
      )}

      <div className={styles.aiNote}>
        叙述由 LLM 生成；事实来自 SSA + SyntaxFlow。证据可以先在 SyntaxFlow 里核对。
      </div>
    </div>
  );
}

export function ReviewPanel() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review, signals, facts } = useReviewData();
  const [filter, setFilter] = useState<SeverityFilter>('all');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');

  const activeSignals = signals.filter((signal) => !state.dismissed.includes(signal.id));
  const dismissedSignals = signals.filter((signal) => state.dismissed.includes(signal.id));
  const filtered = activeSignals.filter((signal) => filter === 'all' || signal.severity === filter);
  const editingComment = state.comments.find((comment) => comment.id === editingId);

  const startEdit = (comment: Comment) => {
    setEditingId(comment.id);
    setDraft(comment.text);
  };

  const saveEdit = () => {
    if (!editingId) return;
    dispatch({ type: 'comment/update', id: editingId, text: draft.trim() });
    setEditingId(null);
    setDraft('');
  };

  const deleteComment = (id: string) => {
    dispatch({ type: 'comment/delete', id });
    if (editingId === id) setEditingId(null);
    dispatch({ type: 'toast/show', message: '评论已删除', kind: 'info' });
  };

  return (
    <div className={styles.panel}>
      <div className={styles.tabs} role="tablist" aria-label="分析与 Review">
        <button
          type="button"
          role="tab"
          aria-selected={state.rightTab === 'ai'}
          className={cx(styles.tab, state.rightTab === 'ai' && styles.tabActive)}
          onClick={() => dispatch({ type: 'tab/set', tab: 'ai' })}
        >
          AI
          <span>{review?.ai?.status === 'ok' ? '✓' : '—'}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.rightTab === 'signals'}
          className={cx(styles.tab, state.rightTab === 'signals' && styles.tabActive)}
          onClick={() => dispatch({ type: 'tab/set', tab: 'signals' })}
        >
          SyntaxFlow
          <span>{signals.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={state.rightTab === 'review'}
          className={cx(styles.tab, state.rightTab === 'review' && styles.tabActive)}
          onClick={() => dispatch({ type: 'tab/set', tab: 'review' })}
        >
          Review
          <span>{state.comments.length}</span>
        </button>
      </div>

      {state.rightTab === 'ai' ? (
        <AIPanel ai={review?.ai} />
      ) : state.rightTab === 'signals' ? (
        <>
          <div className={styles.filters} role="group" aria-label="按严重度过滤">
            {(['all', 'high', 'warn', 'info'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={cx(styles.filter, filter === value && styles.filterActive)}
                onClick={() => setFilter(value)}
              >
                {value === 'all' ? '全部' : SEVERITY[value]}
                <em>
                  {value === 'all'
                    ? activeSignals.length
                    : activeSignals.filter((signal) => signal.severity === value).length}
                </em>
              </button>
            ))}
          </div>

          <div className={styles.body}>
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                <IconCheck width={20} height={20} />
                <p>当前过滤下没有待处理项。</p>
                <span>已在「已忽略」里的项可以撤销。</span>
              </div>
            ) : (
              filtered.map((signal) => (
                <SignalCard
                  key={signal.id}
                  signal={signal}
                  facts={facts}
                  dismissed={false}
                  kept={state.kept.includes(signal.id)}
                />
              ))
            )}

            {dismissedSignals.length > 0 && (
              <details className={styles.dismissed}>
                <summary>
                  已忽略
                  <span>{dismissedSignals.length}</span>
                </summary>
                {dismissedSignals.map((signal) => (
                  <div key={signal.id} className={styles.dismissedRow}>
                    <span>{signal.title}</span>
                    <button
                      type="button"
                      className="btn btnGhost btnSmall"
                      onClick={() => dispatch({ type: 'signal/undismiss', id: signal.id })}
                    >
                      撤销
                    </button>
                  </div>
                ))}
              </details>
            )}
          </div>
        </>
      ) : (
        <div className={styles.body}>
          {state.comments.length === 0 ? (
            <div className={styles.empty}>
              <IconComment width={20} height={20} />
              <p>还没有 Review 意见。</p>
              <span>在代码里选中一段，或在 SyntaxFlow 结果里保留一条。</span>
            </div>
          ) : (
            state.comments.map((comment) => (
              <ReviewCard
                key={comment.id}
                comment={comment}
                editing={editingId === comment.id}
                draft={editingId === comment.id ? draft : ''}
                onEdit={() => startEdit(comment)}
                onDraft={setDraft}
                onSave={saveEdit}
                onCancel={() => setEditingId(null)}
                onDelete={() => deleteComment(comment.id)}
              />
            ))
          )}
          {editingComment && (
            <div className={styles.editingHint}>
              正在编辑：{shortPath(editingComment.quote?.file ?? '评论', 30)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
