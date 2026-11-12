import { fetchPayload } from '../lib/api';
import { useApp, useAppDispatch, saveCurrentReview } from '../state/AppProvider';
import type { Revision } from '../types';
import styles from './RevisionPicker.module.css';

function labelOf(revision: Revision): string {
  if (revision.kind === 'worktree') {
    return `${revision.label} · ${revision.files} 个文件`;
  }
  if (revision.kind === 'range') {
    return `${revision.label} · ${revision.subject}`;
  }
  return `${revision.short} ${revision.subject}`;
}

export function RevisionPicker() {
  const state = useApp();
  const { revisions, revisionId, revisionLoading } = state;
  const dispatch = useAppDispatch();

  if (!revisions || revisions.revisions.length <= 1) return null;

  const current = revisionId || revisions.current;

  const onChange = async (id: string) => {
    if (!id || id === current) return;
    dispatch({ type: 'revision/loading', id });
    try {
      if (state.editVersion > state.savedVersion) await saveCurrentReview(state, dispatch);
      const payload = await fetchPayload(id);
      dispatch({ type: 'payload/loaded', id, payload });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: 'revision/error', error: message });
      dispatch({ type: 'toast/show', message: `切换失败：${message}`, kind: 'error' });
    }
  };

  return (
    <div className={styles.root}>
      <select
        className={styles.select}
        aria-label="比较范围"
        value={current}
        disabled={!!revisionLoading}
        onChange={(event) => onChange(event.target.value)}
      >
        {revisions.revisions.map((revision) => (
          <option key={revision.id} value={revision.id}>
            {labelOf(revision)}
          </option>
        ))}
      </select>
      {revisionLoading && <span className={styles.busy}>读取中…</span>}
      {!revisionLoading && revisions.dirty && !current.startsWith('worktree') && (
        <span className={styles.dirty} title="工作区有未提交改动">●</span>
      )}
    </div>
  );
}
