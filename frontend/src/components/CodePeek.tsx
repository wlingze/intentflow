import { useMemo } from 'react';
import { highlight } from '../lib/highlight';
import { shortPath } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, DeltaKind, Quote, Side } from '../types';
import { IconClose, IconCode, IconComment } from './Icons';
import styles from './CodePeek.module.css';

const DELTA_LABEL: Record<DeltaKind, string> = {
  added: '新增',
  removed: '移除',
  modified: '变化',
  unchanged: '未变',
};

const ROLE_LABEL: Record<string, string> = {
  trigger: '触发',
  decision: '判定',
  transform: '变换',
  effect: '效果',
};

interface Props {
  node?: BehaviorNode;
  edge?: BehaviorEdge;
  anchor?: { file?: string; line?: number; side?: Side };
}

function lineRange(line: number) {
  const start = Math.max(1, line - 4);
  const end = line + 4;
  return { start, end };
}

function snippetFor(
  file: { before: string; after: string; language: string } | undefined,
  side: Side,
  line: number,
) {
  if (!file || !line) return null;
  const text = side === 'before' ? file.before : file.after;
  if (!text) return null;
  const lines = text.split('\n');
  const { start, end } = lineRange(line);
  const rows = [];
  for (let number = start; number <= Math.min(end, lines.length); number += 1) {
    rows.push({ number, html: highlight(lines[number - 1] ?? '', file.language) || '&nbsp;' });
  }
  return { rows, snippet: lines.slice(start - 1, Math.min(end, lines.length)).join('\n') };
}

export function CodePeek({ node, edge, anchor }: Props) {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { files } = useReviewData();
  const filePath = node?.file ?? anchor?.file ?? '';
  const line = node?.line ?? anchor?.line ?? 0;
  const side: Side =
    node ? (node.delta === 'removed' ? 'before' : 'after') : anchor?.side ?? 'after';
  const file = files.find((candidate) => candidate.path === filePath);
  const snippet = useMemo(() => snippetFor(file, side, line), [file, side, line]);
  const item = node ?? edge;
  if (!item) return null;

  const label = node?.label ?? `${edge?.label ?? '边'}`;
  const detail = node?.detail ?? `数据边 · ${edge?.kind ?? ''}`;
  const delta = node?.delta ?? edge?.delta ?? 'unchanged';

  const addQuote = () => {
    if (!filePath) {
      dispatch({ type: 'toast/show', message: '这条事实没有文件位置', kind: 'info' });
      return;
    }
    const quote: Quote = {
      file: filePath,
      side,
      start: line || 1,
      end: line || 1,
      snippet: snippet?.snippet ?? node?.snippet ?? label,
    };
    dispatch({ type: 'composer/quote', quote });
    dispatch({ type: 'toast/show', message: '引用已加入输入框', kind: 'info' });
  };

  return (
    <aside className={styles.peek} role="dialog" aria-label="代码预览">
      <header className={styles.head}>
        <span className={styles.role}>{ROLE_LABEL[node?.role ?? 'transform'] ?? '事实'}</span>
        <span className={`badge badge${delta === 'added' ? 'Green' : delta === 'removed' ? 'Red' : delta === 'modified' ? 'Amber' : ''}`}>
          {DELTA_LABEL[delta]}
        </span>
        {node?.change && <span className={styles.change}>{node.change}</span>}
        <button
          type="button"
          className={styles.close}
          title="关闭预览"
          onClick={() => dispatch({ type: 'peek/close' })}
        >
          <IconClose width={12} height={12} />
        </button>
      </header>

      <div className={styles.title}>{label}</div>
      <div className={styles.meta}>
        {detail}
        {filePath && (
          <button
            type="button"
            className={styles.loc}
            onClick={() => dispatch({ type: 'code/open', file: filePath, line, side })}
          >
            {shortPath(filePath, 36)}:{line}
          </button>
        )}
      </div>

      {snippet ? (
        <pre className={styles.code}>
          {snippet.rows.map((row) => (
            <span key={row.number} className={`${styles.line} ${row.number === line ? styles.target : ''}`}>
              <em>{row.number}</em>
              <span dangerouslySetInnerHTML={{ __html: row.html }} />
            </span>
          ))}
        </pre>
      ) : (
        <div className={styles.noCode}>没有可预览的代码位置</div>
      )}

      <footer className={styles.actions}>
        <button type="button" className="btn btnSmall" onClick={addQuote}>
          <IconComment width={12} height={12} />
          引用到评论
        </button>
        <button
          type="button"
          className="btn btnSmall btnPrimary"
          disabled={!filePath}
          onClick={() => dispatch({ type: 'code/open', file: filePath, line, side })}
        >
          <IconCode width={12} height={12} />
          打开代码
        </button>
        <span className={styles.hint}>
          {state.comments.length} 条评论
        </span>
      </footer>
    </aside>
  );
}
