import { useEffect, useRef, useState } from 'react';
import { submitReview } from '../lib/api';
import { downloadText, copyText } from '../lib/files';
import { buildAgentPrompt, buildReviewMarkdown } from '../lib/markdown';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import {
  IconBot,
  IconChevronDown,
  IconCopy,
  IconDownload,
} from './Icons';
import styles from './SubmitMenu.module.css';

export function SubmitMenu() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review, signals } = useReviewData();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
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

  if (!review) return null;

  const markdown = () => buildReviewMarkdown(review, state.comments, signals, state.dismissed);
  const hasContent = state.comments.length > 0 || state.dismissed.length > 0;

  const toast = (message: string, kind: 'info' | 'success' | 'error' = 'info') => {
    dispatch({ type: 'toast/show', message, kind });
  };

  const onAgent = async () => {
    if (!hasContent) {
      toast('还没有 Review 意见或已忽略项', 'info');
      return;
    }
    setBusy(true);
    const md = markdown();
    const prompt = buildAgentPrompt(md);
    const copied = await copyText(prompt);
    try {
      const result = await submitReview(md, {
        comments: state.comments,
        dismissed: state.dismissed,
        kept: state.kept,
      });
      const where = result.path ? `已写入 ${result.path}` : '已提交到服务端';
      toast(copied ? `${where}，并复制到剪贴板` : where, 'success');
    } catch {
      toast(copied ? '服务端未保存；已复制 Agent prompt' : '复制失败，请手动导出', copied ? 'info' : 'error');
    } finally {
      setBusy(false);
      setOpen(false);
    }
  };

  const onCopy = async () => {
    if (!hasContent) {
      toast('还没有 Review 意见或已忽略项', 'info');
      return;
    }
    const ok = await copyText(markdown());
    toast(ok ? 'Review Markdown 已复制' : '复制失败', ok ? 'success' : 'error');
    setOpen(false);
  };

  const onDownload = () => {
    if (!hasContent) {
      toast('还没有 Review 意见或已忽略项', 'info');
      return;
    }
    downloadText(`intentflow-review-${Date.now()}.md`, markdown());
    toast('Review Markdown 已下载', 'success');
    setOpen(false);
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`btn btnPrimary ${styles.trigger}`}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        提交 Review
        <IconChevronDown width={13} height={13} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          <button type="button" role="menuitem" className={styles.item} onClick={onAgent} disabled={busy}>
            <IconBot width={15} height={15} />
            <span>
              <b>提交给 Agent</b>
              <em>写入 review.md，并复制 prompt</em>
            </span>
          </button>
          <button type="button" role="menuitem" className={styles.item} onClick={onCopy}>
            <IconCopy width={15} height={15} />
            <span>
              <b>复制 Markdown</b>
              <em>粘到任意对话或文档</em>
            </span>
          </button>
          <button type="button" role="menuitem" className={styles.item} onClick={onDownload}>
            <IconDownload width={15} height={15} />
            <span>
              <b>保存 .md 文件</b>
              <em>下载到本地</em>
            </span>
          </button>
        </div>
      )}
    </div>
  );
}
