import { useMemo } from 'react';
import { layoutBehavior, roleLabel } from '../lib/behavior';
import { cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, DeltaKind, LaidOutEdge, LaidOutNode } from '../types';
import { CodeDock } from './CodeDock';
import { IconCode, IconSearch } from './Icons';
import styles from './GraphView.module.css';

const DELTA_LABEL: Record<DeltaKind, string> = {
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

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Edge({
  edge,
  from,
  to,
  onSelect,
}: {
  edge: LaidOutEdge;
  from: LaidOutNode;
  to: LaidOutNode;
  onSelect: () => void;
}) {
  const showLabel =
    (edge.kind === 'data' && edge.delta !== 'removed') ||
    (edge.kind === 'control' && !edge.label.includes('进入判定'));
  const label = edge.kind === 'data' ? edge.shape || edge.label : edge.label;
  return (
    <g
      className={cx(styles.edge, styles[`edge_${edge.delta}`], styles[`kind_${edge.kind}`])}
      role="button"
      tabIndex={0}
      aria-label={`${from.label} 到 ${to.label}，${DELTA_LABEL[edge.delta]}，${edge.label}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <title>
        {from.label} → {to.label} · {edge.kind} · {edge.label} · {DELTA_LABEL[edge.delta]}
      </title>
      <path className={styles.edgeHit} d={edge.path} />
      <path className={styles.edgeLine} d={edge.path} markerEnd={`url(#arrow-${edge.delta})`} />
      {showLabel && (
        <text className={styles.edgeLabel} x={edge.labelX} y={edge.labelY} textAnchor="middle">
          {truncate(label, 20)}
        </text>
      )}
    </g>
  );
}

function Node({
  node,
  selected,
  onSelect,
}: {
  node: LaidOutNode;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      className={cx(styles.node, styles[`role_${node.role}`], styles[`delta_${node.delta}`], selected && styles.selected)}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}，${roleLabel(node.role)}，${DELTA_LABEL[node.delta]}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <title>
        {node.label} · {node.detail} · {DELTA_LABEL[node.delta]}
      </title>
      <rect className={styles.card} width={node.width} height={node.height} rx={9} />
      <rect className={styles.glyphBox} x={11} y={14} width={28} height={28} rx={7} />
      <text className={styles.glyph} x={25} y={33} textAnchor="middle">
        {ROLE_MARK[node.role] ?? '·'}
      </text>
      <text className={styles.nodeTitle} x={47} y={26}>
        {truncate(node.label, 17)}
      </text>
      <text className={styles.nodeSub} x={47} y={42}>
        {truncate(node.detail, 18)}
      </text>
      {node.change && (
        <text className={styles.nodeChange} x={47} y={57}>
          {truncate(node.change, 23)}
        </text>
      )}
      <text className={styles.nodeMark} x={node.width - 12} y={20} textAnchor="end">
        {node.delta === 'added' ? '+' : node.delta === 'removed' ? '−' : node.delta === 'modified' ? '~' : ''}
      </text>
    </g>
  );
}

export function GraphView() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review, files } = useReviewData();
  const graph = useMemo(
    () => (review ? layoutBehavior(review.behavior) : null),
    [review],
  );

  if (!review || !graph) return <div className={styles.empty}>没有分析结果。</div>;

  const baseNode = (id: string) => review.behavior.nodes.find((node) => node.id === id);
  const selectedNode = state.peek.nodeId ? baseNode(state.peek.nodeId) : undefined;
  const selectedEdge = state.peek.edgeId
    ? review.behavior.edges.find((edge) => edge.id === state.peek.edgeId)
    : undefined;

  const openNode = (node: BehaviorNode) => {
    dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
    dispatch({
      type: 'peek/open',
      nodeId: node.id,
      file: node.file,
      line: node.line,
      side: node.delta === 'removed' ? 'before' : 'after',
    });
  };

  const openEdge = (edge: BehaviorEdge) => {
    const to = baseNode(edge.to);
    dispatch({ type: 'select', selected: { kind: 'edge', id: edge.id } });
    dispatch({
      type: 'peek/open',
      edgeId: edge.id,
      file: to?.file,
      line: to?.line,
      side: edge.delta === 'removed' ? 'before' : 'after',
    });
  };

  const firstChanged = review.intent.added[0] ?? review.intent.removed[0];
  const openCode = () => {
    const target = selectedNode ?? (selectedEdge ? baseNode(selectedEdge.to) : undefined);
    const file = target?.file ?? firstChanged?.file;
    const line = target?.line ?? firstChanged?.line;
    if (file) {
      dispatch({ type: 'code/open', file, line, side: selectedNode?.delta === 'removed' ? 'before' : 'after' });
    } else {
      dispatch({ type: 'code/open' });
    }
  };

  const changedFiles = files.filter((file) => file.status !== 'unchanged').length;

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>行为视图 · 每条行为一行</div>
          <div className={styles.titleRow}>
            <h1>{review.behavior.stats.scenarios} 条行为</h1>
            <span className={styles.sub}>
              {review.behavior.stats.nodes} 节点 · {review.behavior.stats.edges} 边 ·{' '}
              {review.behavior.stats.added} 新增 / {review.behavior.stats.modified} 变化 /{' '}
              {review.behavior.stats.removed} 移除
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.legend}>
            {review.behavior.lanes.map((lane) => (
              <span key={lane.role} className={styles[`legend_${lane.role}`]}>
                <i />
                {lane.label}
                {lane.count > 0 && <em>{lane.count}</em>}
              </span>
            ))}
          </div>
          <button type="button" className="btn btnSmall" onClick={openCode}>
            <IconCode width={13} height={13} />
            代码
          </button>
          <button
            type="button"
            className="btn btnSmall"
            onClick={() => dispatch({ type: 'code/open', mode: 'search' })}
          >
            <IconSearch width={13} height={13} />
            搜索
          </button>
        </div>
      </header>

      <div className={styles.canvasWrap}>
        {graph.rows.length === 0 ? (
          <div className={styles.empty}>
            <p>本次改动没有可绘制的行为。</p>
            <p>可能两侧都没有命中 sink，或 SSA 未启用。</p>
          </div>
        ) : (
          <svg
            className={styles.canvas}
            width={graph.width}
            height={graph.height}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            role="img"
            aria-label="行为图"
          >
            <defs>
              {(['added', 'removed', 'modified', 'unchanged'] as const).map((delta) => (
                <marker
                  key={delta}
                  id={`arrow-${delta}`}
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className={styles[`marker_${delta}`]} />
                </marker>
              ))}
            </defs>

            {graph.rows.map((row) => (
              <g key={row.id}>
                <line
                  className={styles.rowLine}
                  x1={row.x}
                  y1={row.y + row.height - 6}
                  x2={row.width - row.x}
                  y2={row.y + row.height - 6}
                />
                <text className={styles.rowIndex} x={row.x} y={row.y + 13}>
                  {String(row.index + 1).padStart(2, '0')}
                </text>
                <text
                  className={cx(styles.rowTitle, styles[`row_${row.delta}`])}
                  x={row.x + 24}
                  y={row.y + 13}
                >
                  {truncate(row.title, 48)}
                </text>
                <text className={styles.rowMeta} x={row.x + 24} y={row.y + 26}>
                  {DELTA_LABEL[row.delta]} · {row.source || '未知来源'} · {row.shape || '—'}
                </text>
              </g>
            ))}

            {graph.rows.map((row) => (
              <g key={`${row.id}-edges`}>
                {row.edges.map((edge) => {
                  const from = row.nodes.find((node) => node.id === edge.from);
                  const to = row.nodes.find((node) => node.id === edge.to);
                  if (!from || !to) return null;
                  return (
                    <Edge
                      key={edge.pathId}
                      edge={edge}
                      from={from}
                      to={to}
                      onSelect={() => openEdge(edge)}
                    />
                  );
                })}
              </g>
            ))}

            {graph.rows.map((row) => (
              <g key={`${row.id}-nodes`}>
                {row.nodes.map((node) => (
                  <Node
                    key={`${row.id}-${node.id}`}
                    node={node}
                    selected={state.selected?.kind === 'node' && state.selected.id === node.id}
                    onSelect={() => openNode(node)}
                  />
                ))}
              </g>
            ))}
          </svg>
        )}
      </div>

      <CodeDock />

      <footer className={styles.foot}>
        <span>
          {review.behavior.entry
            ? `主入口：${review.behavior.entry.replace('trigger:', '').split(':')[0]}`
            : '未识别入口'}
        </span>
        <span>{changedFiles} 个变更文件</span>
        <span>{review.behavior.stats.scenarios} 条行为 · 判定不跨行连边</span>
      </footer>
    </section>
  );
}
