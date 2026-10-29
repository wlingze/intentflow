import { useEffect, useRef } from 'react';
import { uid } from '../lib/id';
import { shortPath } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import type { Comment } from '../types';
import { IconClose, IconComment, IconPlus } from './Icons';
import styles from './Composer.module.css';

export function Composer() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const textarea = useRef<HTMLTextAreaElement>(null);
  const { quote, text, focusToken } = state.composer;

  useEffect(() => {
    const element = textarea.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 132)}px`;
  }, [text]);

  useEffect(() => {
    if (focusToken > 0) textarea.current?.focus();
  }, [focusToken]);

  const submit = () => {
    const value = text.trim();
    if (!value) return;
    const comment: Comment = {
      id: uid('c-'),
      text: value,
      title: '',
      quote: quote ?? undefined,
      source: 'manual',
      signalId: '',
      createdAt: Date.now(),
    };
    dispatch({ type: 'comment/add', comment });
    dispatch({ type: 'toast/show', message: '评论已加入 Review', kind: 'success' });
  };

  return (
    <footer className={styles.composer}>
      <div className={styles.inner}>
        {quote && (
          <div className={styles.quote}>
            <div className={styles.quoteText}>
              <span className={styles.quoteLoc}>
                {shortPath(quote.file, 46)}:{quote.start}
                {quote.end > quote.start ? `-${quote.end}` : ''}
                <em>{quote.side}</em>
              </span>
              <span className={styles.quoteSnippet}>{quote.snippet}</span>
            </div>
            <button
              type="button"
              className={styles.remove}
              title="移除引用"
              onClick={() => dispatch({ type: 'composer/clearQuote' })}
            >
              <IconClose width={12} height={12} />
            </button>
          </div>
        )}

        <div className={styles.box}>
          <IconComment width={15} height={15} className={styles.icon} />
          <textarea
            ref={textarea}
            value={text}
            rows={1}
            placeholder={quote ? '写下针对这段代码的 review 意见…' : '选中代码或点击图节点添加引用，然后写下 review 意见…'}
            onChange={(event) => dispatch({ type: 'composer/text', text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                submit();
              }
            }}
          />
          <div className={styles.actions}>
            <span className={styles.hint}>
              {quote ? '引用已就绪' : '选中代码 / 图节点可引用'}
            </span>
            <button
              type="button"
              className="btn btnPrimary btnSmall"
              disabled={!text.trim()}
              onClick={submit}
            >
              <IconPlus width={12} height={12} />
              添加评论
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
