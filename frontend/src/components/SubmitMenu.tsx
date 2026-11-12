import { useEffect, useRef, useState } from 'react';
import { copyText, downloadText } from '../lib/files';
import { buildReviewMarkdown } from '../lib/markdown';
import { reviewDocument, useApp, useAppDispatch } from '../state/AppProvider';
import { IconChevronDown } from './Icons';
import styles from './SubmitMenu.module.css';

export function SubmitMenu() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
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

  if (!state.payload) return null;

  const toast = (message: string, kind: 'success' | 'error' = 'success') => dispatch({ type: 'toast/show', message, kind });
  const markdown = () => buildReviewMarkdown(state.payload!.review, reviewDocument(state));
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

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`btn btnPrimary ${styles.trigger}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={!!state.revisionLoading}
      >
        提交 Review
        <IconChevronDown width={13} height={13} />
      </button>
      {open && (
        <div className={styles.menu} role="dialog" aria-label="导出评审">
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
        </div>
      )}
    </div>
  );
}
