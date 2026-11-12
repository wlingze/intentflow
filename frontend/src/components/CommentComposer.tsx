import { useEffect, useRef, useState } from 'react';
import { useImagePaste } from '../hooks/useImagePaste';
import styles from './CommentComposer.module.css';

interface Props {
  onSubmit: (text: string) => void;
  submitLabel?: string;
  placeholder?: string;
  compact?: boolean;
  autoFocus?: boolean;
  rows?: number;
}

export function CommentComposer({
  onSubmit,
  submitLabel = '增加意见',
  placeholder = '写一条评审意见，或粘贴图片…',
  compact = false,
  autoFocus = false,
  rows = 2,
}: Props) {
  const [text, setText] = useState('');
  const textarea = useRef<HTMLTextAreaElement>(null);
  const paste = useImagePaste(text, setText);
  const canSubmit = text.trim().length > 0 && !paste.uploading;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, compact ? 120 : 180)}px`;
  }, [text, compact]);

  const submit = () => {
    if (!canSubmit) return;
    onSubmit(text.trim());
    setText('');
  };

  return <div className={styles.root}>
    <textarea
      ref={textarea}
      className={styles.input}
      aria-label={placeholder}
      placeholder={placeholder}
      rows={rows}
      autoFocus={autoFocus}
      value={text}
      onChange={(event) => setText(event.target.value)}
      onPaste={(event) => void paste.onPaste(event)}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
          event.preventDefault();
          submit();
        }
      }}
    />
    <div className={styles.footer}>
      <span className={paste.error ? styles.error : styles.hint}>{paste.error || (paste.uploading ? '图片上传中…' : '可粘贴图片')}</span>
      <button type="button" className={styles.submit} disabled={!canSubmit} onClick={submit}>{submitLabel}</button>
    </div>
  </div>;
}
