import { useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { roleLabel } from '../lib/behavior';
import { shortPath } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, Quote, Side } from '../types';
import { IconClose, IconCode, IconComment } from './Icons';
import styles from './CodeDock.module.css';

const DELTA_LABEL: Record<string, string> = {
  added: '新增',
  removed: '移除',
  modified: '变化',
  unchanged: '未变',
};

const ROLE_MARK: Record<string, string> = {
  trigger: 'IN',
  decision: '??',
  transform: 'ƒ',
  effect: 'OUT',
};

function contextLines(text: string, line: number, radius = 6) {
  const lines = text.split('\n');
  const total = lines.length;
  const center = Math.max(1, Math.min(total, line || 1));
  const start = Math.max(1, center - radius);
  const end = Math.min(total, center + radius);
  const rows = [];
  for (let index = start; index <= end; index += 1) {
    rows.push({ number: index, text: lines[index - 1] ?? '' });
  }
  return { rows, center, total };
}

export function CodeDock() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review, files } = useReviewData();
  const [height, setHeight] = useState(296);

  const node: BehaviorNode | undefined = state.peek.nodeId
    ? review?.behavior.nodes.find((item) => item.id === state.peek.nodeId)
    : undefined;
  const edge: BehaviorEdge | undefined = state.peek.edgeId
    ? review?.behavior.edges.find((item) => item.id === state.peek.edgeId)
    : undefined;
  const targetNode = edge
    ? review?.behavior.nodes.find((item) => item.id === edge.to)
    : node;
  const filePath = targetNode?.file ?? state.peek.file;
  const open = state.peek.open && Boolean(node || edge || filePath);

  const file = filePath
    ? files.find((candidate) => candidate.path === filePath)
    : undefined;
  const side: Side = state.peek.side ?? (targetNode?.delta === 'removed' ? 'before' : 'after');
  const source = side === 'before' ? file?.before : file?.after;
  const line = state.peek.line ?? targetNode?.line ?? 1;
  const visible = useMemo(
    () => (source ? contextLines(source, line) : null),
    [source, line],
  );

  const scenario = node
    ? review?.behavior.scenarios.find((item) => item.nodes.includes(node.id))
    : edge
      ? review?.behavior.scenarios.find((item) => item.id === edge.scenario)
      : undefined;

  const quote = (): Quote | null => {
    if (!visible || !filePath) return null;
    return {
      file: filePath,
      side,
      start: visible.center,
      end: visible.center,
      snippet: visible.rows.find((row) => row.number === visible.center)?.text.trim() ?? '',
    };
  };

  const addQuote = () => {
    const value = quote();
    if (!value) {
      dispatch({ type: 'toast/show', message: '这个节点没有可引用的代码行', kind: 'info' });
      return;
    }
    dispatch({ type: 'composer/quote', quote: value });
    dispatch({ type: 'toast/show', message: '引用已加入输入框', kind: 'info' });
  };

  const openCode = () => {
    if (!filePath) {
      dispatch({ type: 'toast/show', message: '这个节点没有代码位置', kind: 'info' });
      return;
    }
    dispatch({
      type: 'code/open',
      file: filePath,
      line,
      side,
    });
  };

  const startDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const move = (moveEvent: PointerEvent) => {
      const next = startHeight + (startY - moveEvent.clientY);
      setHeight(Math.max(150, Math.min(window.innerHeight * 0.62, next)));
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  if (!open) {
    return (
      <div className={styles.collapsed}>
        <span className={styles.collapsedDot} />
        点击节点放大详情；在详情里展开代码；拖拽分隔条可调高度
      </div>
    );
  }

  return (
    <section className={styles.dock} style={{ height }}>
      <div className={styles.resizer} onPointerDown={startDrag} role="separator" aria-label="调整详情高度" />
      <header className={styles.head}>
        <div className={styles.kind}>
          <span className={styles.mark}>{node ? ROLE_MARK[node.role] ?? '·' : edge ? 'EDGE' : 'FILE'}</span>
          <div>
            <div className={styles.title}>
              {node?.label ?? (edge ? `${edge.kind} · ${edge.label}` : filePath ?? '代码')}
            </div>
            <div className={styles.sub}>
              {node ? roleLabel(node.role) : edge ? '关系' : '文件'} ·{' '}
              {DELTA_LABEL[node?.delta ?? edge?.delta ?? state.peek.delta ?? 'unchanged']}
              {node?.detail ? ` · ${node.detail}` : ''}
            </div>
          </div>
        </div>
        <div className={styles.actions}>
          <button type="button" className="btn btnGhost btnSmall" onClick={addQuote}>
            <IconComment width={12} height={12} />
            引用到评论
          </button>
          <button type="button" className="btn btnSmall" onClick={openCode}>
            <IconCode width={12} height={12} />
            打开代码
          </button>
          <button
            type="button"
            className={styles.close}
            title="关闭详情"
            onClick={() => dispatch({ type: 'peek/close' })}
          >
            <IconClose width={12} height={12} />
          </button>
        </div>
      </header>

      <div className={styles.body}>
        <aside className={styles.meta}>
          {node ? (
            <>
              <Meta label="位置" value={node.file ? `${shortPath(node.file, 42)}:${node.line}` : '—'} />
              <Meta label="函数" value={node.function || '—'} />
              <Meta label="来源" value={node.source || '—'} />
              <Meta label="形态" value={node.shape || '—'} />
              <Meta label="场景" value={scenario?.title || '—'} />
              {node.change && <Meta label="变化" value={node.change} />}
              {node.tags.length > 0 && (
                <div className={styles.tags}>
                  {node.tags.map((tag) => (
                    <span key={tag}>{tag}</span>
                  ))}
                </div>
              )}
              {node.evidence.length > 0 && (
                <div className={styles.evidence}>
                  <span>证据</span>
                  {node.evidence.map((item) => (
                    <code key={item}>{item}</code>
                  ))}
                </div>
              )}
            </>
          ) : edge ? (
            <>
              <Meta label="关系" value={edge.kind} />
              <Meta label="标签" value={edge.label || '—'} />
              <Meta label="来源" value={edge.source || '—'} />
              <Meta label="形态" value={edge.shape || '—'} />
              <Meta label="场景" value={scenario?.title || '—'} />
              <Meta label="目标" value={targetNode ? `${targetNode.label}` : '—'} />
            </>
          ) : (
            <>
              <Meta label="文件" value={filePath || '—'} />
              <Meta label="行号" value={String(line)} />
              <Meta label="侧" value={side} />
            </>
          )}
        </aside>

        <div className={styles.code}>
          {visible ? (
            <>
              <div className={styles.codeHead}>
                <span>{filePath}:{visible.center}</span>
                <em>{side}</em>
              </div>
              <pre className={styles.lines}>
                {visible.rows.map((row) => (
                  <div key={row.number} className={row.number === visible.center ? styles.hit : undefined}>
                    <span className={styles.lineNo}>{row.number}</span>
                    <code>{row.text || ' '}</code>
                  </div>
                ))}
              </pre>
            </>
          ) : (
            <div className={styles.noCode}>
              {filePath ? '源码未携带（文件超限或被跳过）' : '这个节点没有代码位置'}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.metaRow}>
      <span>{label}</span>
      <b title={value}>{value}</b>
    </div>
  );
}
