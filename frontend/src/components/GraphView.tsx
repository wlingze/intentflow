import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { roleLabel } from '../lib/behavior';
import { layoutFunctionGraph } from '../lib/levels';
import { cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type {
  BehaviorEdge,
  DeltaKind,
  LaidOutEdge,
  LaidOutNode,
} from '../types';
import { CodeDock } from './CodeDock';
import { IconCode, IconSearch } from './Icons';
import styles from './GraphView.module.css';

const DELTA_LABEL: Record<DeltaKind, string> = {
  modified: '变化',
  added: '新增',
  removed: '移除',
  unchanged: '未变',
};

const VIEW_W = 1200;
const VIEW_H = 720;

const ROLE_MARK: Record<string, string> = {
  trigger: 'IN',
  decision: '??',
  transform: 'ƒ',
  effect: 'OUT',
};

interface ViewState {
  x: number;
  y: number;
  k: number;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function toWorld(svg: SVGSVGElement, clientX: number, clientY: number): { x: number; y: number } {
  const point = svg.createSVGPoint();
  point.x = clientX;
  point.y = clientY;
  const matrix = svg.getScreenCTM();
  if (!matrix) return { x: 0, y: 0 };
  const result = point.matrixTransform(matrix.inverse());
  return { x: result.x, y: result.y };
}

function displayLabel(node: LaidOutNode): string {
  if (node.display === 'file') return '文件';
  return roleLabel(node.role);
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
  const isAggregatedCall = edge.kind === 'call' && (edge.count ?? 1) > 1;
  const showLabel =
    (edge.kind === 'data' && edge.delta !== 'removed') ||
    (edge.kind === 'control' && !edge.label.includes('进入判定')) ||
    isAggregatedCall;
  const label = edge.kind === 'data' ? edge.shape || edge.label : edge.label;
  return (
    <g
      className={cx(styles.edge, styles[`edge_${edge.delta}`], styles[`kind_${edge.kind}`])}
      role="button"
      tabIndex={0}
      aria-label={`${from.label} 到 ${to.label}，${DELTA_LABEL[edge.delta]}，${edge.label}`}
      onPointerDown={(event) => event.stopPropagation()}
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
        {edge.count && edge.count > 1 ? ` · ${edge.count} 条关系` : ''}
      </title>
      <path className={styles.edgeHit} d={edge.path} />
      <path className={styles.edgeLine} d={edge.path} markerEnd={`url(#arrow-${edge.delta})`} />
      {showLabel && (
        <text className={styles.edgeLabel} x={edge.labelX} y={edge.labelY} textAnchor="middle">
          {truncate(edge.count && edge.count > 1 ? `${label} ${edge.count}` : label, 22)}
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
  const mark = node.display === 'file' ? 'DIR' : ROLE_MARK[node.role] ?? '·';
  return (
    <g
      className={cx(styles.node, styles[`role_${node.role}`], styles[`delta_${node.delta}`], selected && styles.selected)}
      transform={`translate(${node.x} ${node.y})`}
      role="button"
      tabIndex={0}
      aria-label={`${node.label}，${displayLabel(node)}，${DELTA_LABEL[node.delta]}`}
      onPointerDown={(event) => event.stopPropagation()}
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
        {node.label} · {node.file || '—'} · {node.detail} · {DELTA_LABEL[node.delta]}
      </title>
      <rect className={styles.card} width={node.width} height={node.height} rx={9} />
      <rect className={styles.glyphBox} x={11} y={14} width={node.display === 'file' ? 32 : 28} height={28} rx={7} />
      <text className={styles.glyph} x={node.display === 'file' ? 27 : 25} y={33} textAnchor="middle">
        {mark}
      </text>
      <text className={styles.nodeTitle} x={51} y={26}>
        {truncate(node.label, 19)}
      </text>
      <text className={styles.nodeSub} x={51} y={42}>
        {truncate(
          node.count && node.count > 1
            ? node.display === 'file'
              ? `${node.count} 个函数`
              : `${node.count} 个角色`
            : node.detail,
          20,
        )}
      </text>
      {node.change && (
        <text className={styles.nodeChange} x={51} y={57}>
          {truncate(node.change, 25)}
        </text>
      )}
      <text className={styles.nodeMark} x={node.width - 12} y={20} textAnchor="end">
        {node.delta === 'added' ? '+' : node.delta === 'removed' ? '−' : node.delta === 'modified' ? '~' : ''}
      </text>
    </g>
  );
}

export function GraphView({ compact = false }: { compact?: boolean }) {
  const state = useApp();
  const dispatch = useAppDispatch();
  const { review, files } = useReviewData();
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const [focusId, setFocusId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
  const movedRef = useRef(false);

  const layout = useMemo(
    () => (review ? layoutFunctionGraph(review.behavior) : null),
    [review],
  );

  useEffect(() => {
    if (!layout) return;
    const k = Math.min(1, (VIEW_W / layout.width) * 0.92, (VIEW_H / layout.height) * 0.92);
    setView({
      x: (VIEW_W - layout.width * k) / 2,
      y: (VIEW_H - layout.height * k) / 2,
      k,
    });
  }, [layout]);

  if (!review || !layout) return <div className={styles.empty}>没有分析结果。</div>;
  const changedFiles = files.filter((file) => file.status !== 'unchanged').length;
  const firstChanged = review.intent.added[0] ?? review.intent.removed[0];

  const openNode = (node: LaidOutNode) => {
    if (compact) dispatch({ type: 'view/set', view: 'graph' });
    setFocusId(node.id);
    dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
    dispatch({
      type: 'peek/open',
      function: node.function,
      file: node.file,
      line: node.line,
      side: node.delta === 'removed' ? 'before' : 'after',
      delta: node.delta,
    });
  };

  const openEdge = (edge: BehaviorEdge) => {
    const target = layout.nodes.find((node) => node.id === edge.to);
    const realEdge = review.behavior.edges.find((item) => item.id === edge.id);
    if (realEdge) {
      dispatch({ type: 'select', selected: { kind: 'edge', id: realEdge.id } });
      dispatch({
        type: 'peek/open',
        edgeId: realEdge.id,
        file: target?.file,
        line: target?.line,
        side: realEdge.delta === 'removed' ? 'before' : 'after',
        delta: realEdge.delta,
      });
      return;
    }
    if (target) {
      dispatch({ type: 'select', selected: { kind: 'edge', id: edge.id } });
      dispatch({
        type: 'peek/open',
        file: target.file,
        line: target.line,
        side: edge.delta === 'removed' ? 'before' : 'after',
        delta: edge.delta,
      });
    }
  };

  const openCode = () => {
    if (firstChanged?.file) {
      dispatch({
        type: 'code/open',
        file: firstChanged.file,
        line: firstChanged.line,
        side: 'after',
      });
    } else {
      dispatch({ type: 'code/open' });
    }
  };

  const wheelZoom = (event: React.WheelEvent<SVGSVGElement>) => {
    event.preventDefault();
    const svg = svgRef.current;
    if (!svg) return;
    const point = toWorld(svg, event.clientX, event.clientY);
    const factor = event.deltaY < 0 ? 1.12 : 0.9;
    setView((previous) => {
      const nextK = Math.max(0.35, Math.min(2.8, previous.k * factor));
      const ratio = nextK / previous.k;
      return {
        k: nextK,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      };
    });
  };

  const startDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button !== 0) return;
    const svg = svgRef.current;
    if (!svg) return;
    const start = toWorld(svg, event.clientX, event.clientY);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: start.x,
      startY: start.y,
      originX: view.x,
      originY: view.y,
    };
    movedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    const svg = svgRef.current;
    if (!drag || !svg || drag.pointerId !== event.pointerId) return;
    const point = toWorld(svg, event.clientX, event.clientY);
    const dx = point.x - drag.startX;
    const dy = point.y - drag.startY;
    if (Math.abs(dx) + Math.abs(dy) > 1) movedRef.current = true;
    setView((previous) => ({
      ...previous,
      x: drag.originX + dx,
      y: drag.originY + dy,
    }));
  };

  const endDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  };

  const zoomAtCenter = (factor: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const point = toWorld(svg, rect.left + rect.width / 2, rect.top + rect.height / 2);
    setView((previous) => {
      const nextK = Math.max(0.35, Math.min(2.8, previous.k * factor));
      const ratio = nextK / previous.k;
      return {
        k: nextK,
        x: point.x - (point.x - previous.x) * ratio,
        y: point.y - (point.y - previous.y) * ratio,
      };
    });
  };

  const fit = () => {
    const k = Math.min(1, (VIEW_W / layout.width) * 0.92, (VIEW_H / layout.height) * 0.92);
    setView({
      x: (VIEW_W - layout.width * k) / 2,
      y: (VIEW_H - layout.height * k) / 2,
      k,
    });
  };
  const resetFocus = () => setFocusId(null);
  const headerHint = '函数关系 · 点击函数，在下方看内部行为';
  const fileCount = new Set(layout.nodes.map((node) => node.file).filter(Boolean)).size;
  const nodeCount = layout.nodes.length;
  const edgeCount = layout.edges.length;

  return (
    <section className={cx(styles.panel, compact && styles.panelCompact)}>
      {!compact && (
      <header className={styles.head}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>{headerHint}</div>
          <div className={styles.titleRow}>
            <h1>{nodeCount} 个函数</h1>
            <span className={styles.sub}>
              {fileCount ? `${fileCount} 个文件 · ` : ''}
              {edgeCount} 条调用 · 点击函数展开内部行为
            </span>
          </div>
        </div>
        <div className={styles.actions}>
          <div className={styles.deltaLegend}>
            {(['added', 'removed', 'modified', 'unchanged'] as const).map((delta) => (
              <span key={delta} className={styles[`legendDelta_${delta}`]}>
                <i />
                {DELTA_LABEL[delta]}
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
      )}

      <div className={styles.canvasWrap}>
        {layout.nodes.length === 0 ? (
          <div className={styles.empty}>
            <p>本次改动没有可绘制的行为。</p>
            <p>可能两侧都没有命中 sink，或 SSA 未启用。</p>
          </div>
        ) : (
          <>
            <svg
              ref={svgRef}
              className={styles.canvas}
              width="100%"
              height="100%"
              viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
              preserveAspectRatio="xMinYMin meet"
              role="img"
              aria-label="函数关系图"
              onPointerDown={startDrag}
              onPointerMove={moveDrag}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onWheel={wheelZoom}
              onClick={() => {
                if (!movedRef.current) resetFocus();
              }}
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

              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {layout.edges.map((edge) => {
                  const from = layout.nodes.find((node) => node.id === edge.from);
                  const to = layout.nodes.find((node) => node.id === edge.to);
                  if (!from || !to) return null;
                  return <Edge key={edge.pathId} edge={edge} from={from} to={to} onSelect={() => openEdge(edge)} />;
                })}

                {layout.nodes.map((node) => (
                  <Node
                    key={node.id}
                    node={node}
                    selected={focusId === node.id || (state.selected?.kind === 'node' && state.selected.id === node.id)}
                    onSelect={() => openNode(node)}
                  />
                ))}
              </g>
            </svg>

            <div className={styles.viewControls} aria-label="画布缩放">
              <button type="button" onClick={() => zoomAtCenter(1.16)} aria-label="放大">+</button>
              <span>{Math.round(view.k * 100)}%</span>
              <button type="button" onClick={() => zoomAtCenter(0.86)} aria-label="缩小">−</button>
              <button type="button" className={styles.fitButton} onClick={fit}>适应</button>
            </div>
            <div className={styles.canvasHint}>拖拽画布 · 滚轮缩放 · 点击函数看内部行为</div>
          </>
        )}
      </div>

      {!compact && <CodeDock />}

      {!compact && (
      <footer className={styles.foot}>
        <span>
          {review.behavior.entry
            ? `主入口：${review.behavior.entry.replace('trigger:', '').split(':')[0]}`
            : '未识别入口'}
        </span>
        <span>{changedFiles} 个变更文件</span>
        <span>{edgeCount} 条调用 · 点击函数在下方展开内部行为</span>
      </footer>
      )}
    </section>
  );
}
