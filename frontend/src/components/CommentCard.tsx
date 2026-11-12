import { useState } from 'react';
import { useAppDispatch } from '../state/AppProvider';
import { useImagePaste } from '../hooks/useImagePaste';
import { cx, timeLabel } from '../lib/format';
import type { Comment } from '../types';
import { CommentBody } from './CommentBody';
import { IconPencil, IconTrash } from './Icons';
import styles from './CommentCard.module.css';

export function CommentCard({ comment, compact = false }: { comment: Comment; compact?: boolean }) {
  const dispatch = useAppDispatch();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [draft, setDraft] = useState(comment.text);
  const paste = useImagePaste(draft, setDraft);

  return <article className={cx(styles.comment, compact && styles.compact, comment.resolved && styles.resolved)}>
    {!compact && <div className={styles.head}>
      {comment.quote && <button type="button" className={styles.where} title={comment.quote.file} onClick={() => dispatch({ type: 'code/reveal', file: comment.quote!.file, line: comment.quote!.start, side: comment.quote!.side })}>
        {comment.quote.file}:{comment.quote.start}{comment.quote.end > comment.quote.start ? `–${comment.quote.end}` : ''}
      </button>}
      <time>{timeLabel(comment.createdAt)}</time>
    </div>}
    {editing ? <div className={styles.edit}>
      <textarea
        className="input"
        aria-label="修改评论"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onPaste={(event) => void paste.onPaste(event)}
      />
      {paste.error && <p className={styles.error}>{paste.error}</p>}
      <div className={styles.actions}>
        <button className="btn btnSmall" type="button" onClick={() => { setEditing(false); setDraft(comment.text); }}>取消</button>
        <button
          className="btn btnSmall btnPrimary"
          type="button"
          disabled={!draft.trim() || paste.uploading}
          onClick={() => {
            dispatch({ type: 'comment/update', id: comment.id, text: draft.trim() });
            setEditing(false);
          }}
        >保存</button>
      </div>
    </div> : <CommentBody text={comment.text} legacy={comment.images} />}
    {!editing && <div className={styles.actions}>
      {deleting ? <>
        <span className={styles.confirm}>删除？</span>
        <button className="btn btnGhost btnSmall" type="button" onClick={() => setDeleting(false)}>取消</button>
        <button className="btn btnGhost btnSmall" type="button" onClick={() => dispatch({ type: 'comment/delete', id: comment.id })}>删除</button>
      </> : <>
        <button className="btn btnGhost btnSmall" type="button" onClick={() => dispatch({ type: 'comment/resolve', id: comment.id, resolved: !comment.resolved })}>{comment.resolved ? '重新打开' : '解决'}</button>
        <button className="btn btnGhost btnSmall" type="button" aria-label="修改评论" onClick={() => { setDraft(comment.text); setEditing(true); }}><IconPencil width={11} height={11} /></button>
        <button className="btn btnGhost btnSmall" type="button" aria-label="删除评论" onClick={() => setDeleting(true)}><IconTrash width={11} height={11} /></button>
      </>}
    </div>}
  </article>;
}
