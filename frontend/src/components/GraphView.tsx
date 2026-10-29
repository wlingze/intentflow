import { useMemo, useState } from 'react';
import { buildGraph, layoutGraph } from '../lib/graph';
import { cx, shortPath } from '../lib/format';
import { shapeLabel } from '../lib/labels';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { GraphEdge, GraphNode, LaidOutEdge, LaidOutNode, Quote } from '../types';
import { IconBranch, IconCode, IconComment, IconSearch } from './Icons';
import styles from './GraphView.module.css';

const DELTA_LABEL: Record<string, string> = {
  added: '新增',
  removed: '移除',
  modified: '结构变化',
  unchanged: '未变',
};

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function locText(node: GraphNode | GraphEdge): string {
  if (!node.file) return '无代码位置';
  return `${shortPath(node.file, 42)}${node.line ? `:${node.line}` : ''}`;
}

function makeQuote(node: GraphNode | GraphEdge): Quote | null {
  if (!node.file) return null;
  const line = node.line ?? 1;
  return {
    file: node.file,
    side: node.side ?? 'after',
    start: line,
    end: line,
    snippet: node.snippet ?? node.label,
  };
}

function Edge({
  edge,
  from,
  to,
  reducedMotion,
  onSelect,
}: {
  edge: LaidOutEdge;
  from: LaidOutNode;
  to: LaidOutNode;
  reducedMotion: boolean;
  onSelect: (edge: LaidOutEdge) => void;
}) {
  const marker = edge.delta === 'added' ? 'arrow-added' : edge.delta === 'removed' ? 'arrow-removed' : edge.delta === 'modified' ? 'arrow-modified' : 'arrow-unchanged';
  return (
    <g
      className={cx(styles.edge, styles[`edge_${edge.delta}`])}
      role="button"
      tabIndex={0}
      aria-label={`${from.label} 到 ${to.label}，${DELTA_LABEL[edge.delta]}，${edge.label}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(edge);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(edge);
        }
      }}
    >
      <title>
        {from.label} → {to.label} · {edge.label} · {DELTA_LABEL[edge.delta]}
      </title>
      <path className={styles.edgeHit} d={edge.path} />
      <path className={styles.edgeLine} d={edge.path} markerEnd={`url(#${marker})`} id={edge.pathId} />
      <text className={styles.edgeLabel} x={edge.labelX} y={edge.labelY} textAnchor="middle">
        {truncate(edge.label, 22)}
      </text>
      {edge.hero && !reducedMotion && (
        <circle className={styles.pulse} r={3.2}>
          <animateMotion dur="3.4s" repeatCount="indefinite">
            <mpath href={`#${edge.pathId}`} />
          </animateMotion>
        </circle>
      )}
    </g>
  );
}

function Node({
  node,
  onSelect,
}: {
  node: LaidOutNode;
  onSelect: (node: LaidOutNode) => void;
}) {
  const colorClass = styles[`node_${node.delta}`];
  const mark = node.delta === 'added' ? '+' : node.delta === 'removed' ? '−' : node.delta === 'modified' ? '~' : '';
  const glyph = node.kind === 'source' ? 'IN' : node.kind === 'sink' ? 'OUT' : 'ƒ';

  return (
    <g
      className={cx(styles.node, colorClass)}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}，${DELTA_LABEL[node.delta]}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(node);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect(node);
        }
      }}
    >
      <title>
        {node.label} · {node.sub} · {DELTA_LABEL[node.delta]}
      </title>
      <rect className={styles.card} width={node.width} height={node.height} rx={10} />
      <rect className={styles.glyphBox} x={12} y={13} width={30} height={30} rx={8} />
      <text className={styles.glyph} x={27} y={33} textAnchor="middle">
        {glyph}
      </text>
      <text className={styles.nodeTitle} x={51} y={25}>
        {truncate(node.label, 18)}
      </text>
      <text className={styles.nodeSub} x={51} y={42}>
        {truncate(node.sub, 24)}
      </text>
      {mark && (
        <text className={styles.nodeMark} x={node.width - 14} y={20} textAnchor="end">
          {mark}
        </text>
      )}
    </g>
  );
}

export function GraphView() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review } = useReviewData();
  const [notesOpen, setNotesOpen] = useState(false);
  const reducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const graph = useMemo(() => {
    if (!review) return null;
    return layoutGraph(buildGraph(review));
  }, [review]);

  if (!review || !graph) return <div className={styles.empty}>没有分析结果。</div>;

  const selectedNode = state.selected?.kind === 'node'
    ? graph.nodes.find((node) => node.id === state.selected?.id)
    : undefined;
  const selectedEdge = state.selected?.kind === 'edge'
    ? graph.edges.find((edge) => edge.id === state.selected?.id)
    : undefined;

  const openLoc = (item: GraphNode | GraphEdge) => {
    if (!item.file) {
      dispatch({ type: 'toast/show', message: '这条事实没有文件位置', kind: 'info' });
      return;
    }
    dispatch({ type: 'drawer/open', file: item.file, line: item.line, side: item.side });
  };

  const quote = (item: GraphNode | GraphEdge) => {
    const next = makeQuote(item);
    if (!next) {
      dispatch({ type: 'toast/show', message: '这条事实没有文件位置', kind: 'info' });
      return;
    }
    dispatch({ type: 'composer/quote', quote: next });
    dispatch({ type: 'toast/show', message: '引用已加入输入框', kind: 'info' });
  };

  const selectNode = (node: LaidOutNode) => {
    dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
    openLoc(node);
  };

  const selectEdge = (edge: LaidOutEdge) => {
    dispatch({ type: 'select', selected: { kind: 'edge', id: edge.id } });
    openLoc(edge);
  };

  const firstChanged = review.intent.added[0] ?? review.intent.removed[0];
  const openFirst = () => {
    if (firstChanged?.file) {
      dispatch({ type: 'drawer/open', file: firstChanged.file, line: firstChanged.line, side: 'after' });
    } else {
      dispatch({ type: 'drawer/open' });
    }
  };

  const selected = selectedNode
    ? { kind: 'node' as const, item: selectedNode }
    : selectedEdge
      ? { kind: 'edge' as const, item: selectedEdge }
      : null;

  const edges = graph.edges.map((edge) => {
    const from = graph.nodes.find((node) => node.id === edge.from);
    const to = graph.nodes.find((node) => node.id === edge.to);
    return from && to ? { edge, from, to } : null;
  }).filter((value): value is { edge: LaidOutEdge; from: LaidOutNode; to: LaidOutNode } => Boolean(value));

  return (
    <div className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>
            <IconBranch width={13} height={13} />
            意图流
          </div>
          <div className={styles.titleRow}>
            <h1>{review.intent.added.length + review.intent.removed.length} 条语义链</h1>
            <span className={styles.sub}>
              {graph.nodes.length} 节点 · {graph.edges.length} 边
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.legend}>
            <span><i className={styles.legAdd} />新增</span>
            <span><i className={styles.legDel} />移除</span>
            <span><i className={styles.legMod} />变化</span>
            <span><i className={styles.legSame} />未变</span>
          </div>
          <button type="button" className="btn btnSmall" onClick={openFirst}>
            <IconCode width={13} height={13} />
            代码
          </button>
          <button
            type="button"
            className="btn btnSmall"
            onClick={() => dispatch({ type: 'drawer/open', mode: 'search' })}
          >
            <IconSearch width={13} height={13} />
            搜索
          </button>
        </div>
      </header>

      <div className={styles.canvasWrap}>
        {graph.nodes.length === 0 ? (
          <div className={styles.empty}>
            <p>本次改动没有可绘制的意图链。</p>
            <p>可能两侧都没有命中 sink，或 SSA 未启用。</p>
          </div>
        ) : (
          <svg
            className={styles.canvas}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            role="img"
            aria-label="意图数据流图"
            style={{ minWidth: Math.min(graph.width, 760) }}
          >
            <defs>
              <marker id="arrow-added" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--green)" />
              </marker>
              <marker id="arrow-removed" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--red)" />
              </marker>
              <marker id="arrow-modified" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--amber)" />
              </marker>
              <marker id="arrow-unchanged" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--faint)" />
              </marker>
            </defs>

            {graph.lanes.map((lane) => (
              <g key={lane.label}>
                <rect
                  className={styles.lane}
                  x={lane.x}
                  y={lane.y}
                  width={lane.width}
                  height={lane.height}
                  rx={12}
                />
                <text className={styles.laneLabel} x={lane.x + 14} y={lane.y + 19}>
                  {lane.label}
                </text>
              </g>
            ))}

            {edges.map(({ edge, from, to }) => (
              <Edge
                key={edge.id}
                edge={edge}
                from={from}
                to={to}
                reducedMotion={reducedMotion}
                onSelect={selectEdge}
              />
            ))}

            {graph.nodes.map((node) => (
              <Node key={node.id} node={node} onSelect={selectNode} />
            ))}
          </svg>
        )}
      </div>

      <section className={styles.inspector}>
        {!selected ? (
          <div className={styles.hint}>
            <IconBranch width={14} height={14} />
            <span>点击节点或边查看证据。点击后代码抽屉会跳到对应行。</span>
          </div>
        ) : selected.kind === 'node' ? (
          <>
            <div className={styles.inspectorHead}>
              <span className={styles.inspectorKind}>节点</span>
              <b>{selected.item.label}</b>
              <span className={cx(styles.deltaBadge, styles[`badge_${selected.item.delta}`])}>
                {DELTA_LABEL[selected.item.delta]}
              </span>
              <code className={styles.loc}>{locText(selected.item)}</code>
            </div>
            <div className={styles.inspectorSub}>{selected.item.sub}</div>
            {selected.item.snippet && <pre className={styles.snippet}>{selected.item.snippet}</pre>}
            <div className={styles.inspectorActions}>
              <button type="button" className="btn btnSmall" onClick={() => openLoc(selected.item)}>
                <IconCode width={12} height={12} />
                查看代码
              </button>
              <button type="button" className="btn btnSmall btnPrimary" onClick={() => quote(selected.item)}>
                <IconComment width={12} height={12} />
                添加评论
              </button>
            </div>
          </>
        ) : (
          <>
            <div className={styles.inspectorHead}>
              <span className={styles.inspectorKind}>数据流</span>
              <b>
                {selected.item.from.replace(/^fn:/, '').replace(/^src:/, '').replace(/^sink:/, '')}
                {' → '}
                {selected.item.to.replace(/^fn:/, '').replace(/^src:/, '').replace(/^sink:/, '')}
              </b>
              <span className={cx(styles.deltaBadge, styles[`badge_${selected.item.delta}`])}>
                {DELTA_LABEL[selected.item.delta]}
              </span>
              <code className={styles.loc}>{locText(selected.item)}</code>
            </div>
            <div className={styles.inspectorSub}>
              {selected.item.shape ? shapeLabel(selected.item.shape) : selected.item.label}
              {selected.item.source ? ` · 来源 ${selected.item.source}` : ''}
            </div>
            {selected.item.snippet && <pre className={styles.snippet}>{selected.item.snippet}</pre>}
            <div className={styles.inspectorActions}>
              <button type="button" className="btn btnSmall" onClick={() => openLoc(selected.item)}>
                <IconCode width={12} height={12} />
                查看代码
              </button>
              <button type="button" className="btn btnSmall btnPrimary" onClick={() => quote(selected.item)}>
                <IconComment width={12} height={12} />
                添加评论
              </button>
            </div>
          </>
        )}
      </section>

      {review.notes && review.notes.length > 0 && (
        <div className={styles.notes}>
          <button type="button" className={styles.notesToggle} onClick={() => setNotesOpen((value) => !value)}>
            运行说明 ({review.notes.length})
            <span>{notesOpen ? '收起' : '展开'}</span>
          </button>
          {notesOpen && (
            <ul>
              {review.notes.map((note) => <li key={note}>{note}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
