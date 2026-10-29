import { useMemo } from 'react';
import { layoutBehavior, stageLabels, roleLabel } from '../lib/behavior';
import { baseName, cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, DeltaKind, Fact, LaidOutEdge, LaidOutNode, Side } from '../types';
import { CodePeek } from './CodePeek';
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
      <rect className={styles.card} width={node.width} height={node.height} rx={10} />
      <rect className={styles.glyphBox} x={12} y={15} width={30} height={30} rx={8} />
      <text className={styles.glyph} x={27} y={35} textAnchor="middle">
        {ROLE_MARK[node.role] ?? '·'}
      </text>
      <text className={styles.nodeTitle} x={51} y={27}>
        {truncate(node.label, 18)}
      </text>
      <text className={styles.nodeSub} x={51} y={44}>
        {truncate(node.detail, 18)}
      </text>
      {node.change && (
        <text className={styles.nodeChange} x={51} y={59}>
          {truncate(node.change, 25)}
        </text>
      )}
      <text className={styles.nodeMark} x={node.width - 14} y={21} textAnchor="end">
        {node.delta === 'added' ? '+' : node.delta === 'removed' ? '−' : node.delta === 'modified' ? '~' : ''}
      </text>
    </g>
  );
}

function FactColumn({
  title,
  added,
  removed,
  showShape = false,
}: {
  title: string;
  added: Fact[];
  removed: Fact[];
  showShape?: boolean;
}) {
  const dispatch = useAppDispatch();
  const rows = [
    ...added.map((fact) => ({ fact, side: 'after' as Side })),
    ...removed.map((fact) => ({ fact, side: 'before' as Side })),
  ];
  return (
    <div className={styles.factCol}>
      <h4>
        {title}
        <span>
          {added.length > 0 && <b className={styles.plus}>+{added.length}</b>}
          {removed.length > 0 && <b className={styles.minus}>−{removed.length}</b>}
        </span>
      </h4>
      <div className={styles.factRows}>
        {rows.length === 0 ? (
          <span className={styles.factEmpty}>无变化</span>
        ) : (
          rows.map(({ fact, side }) => (
            <button
              key={`${side}-${fact.identity}`}
              type="button"
              className={styles.factRow}
              title={fact.detail || fact.title}
              onClick={() => {
                if (fact.file) {
                  dispatch({
                    type: 'code/open',
                    file: fact.file,
                    line: fact.line,
                    side,
                  });
                }
              }}
            >
              <span className={side === 'after' ? styles.plus : styles.minus}>
                {side === 'after' ? '+' : '−'}
              </span>
              <span className={styles.factTitle}>{fact.title}</span>
              {showShape && fact.shape && <em className={styles.factShape}>{fact.shape}</em>}
              {fact.file && (
                <span className={styles.factLoc}>
                  {baseName(fact.file)}
                  {fact.line ? `:${fact.line}` : ''}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
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

  const selectedNode = state.peek.nodeId
    ? graph.nodes.find((node) => node.id === state.peek.nodeId)
    : undefined;
  const selectedEdge = state.peek.edgeId
    ? graph.edges.find((edge) => edge.id === state.peek.edgeId)
    : undefined;
  const anchorNode = selectedEdge
    ? graph.nodes.find((node) => node.id === selectedEdge.to)
    : undefined;
  const labels = stageLabels(review.behavior);

  const openPeek = (node: BehaviorNode) => {
    dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
    dispatch({
      type: 'peek/open',
      nodeId: node.id,
      file: node.file,
      line: node.line,
      side: node.delta === 'removed' ? 'before' : 'after',
    });
  };

  const openEdgePeek = (edge: BehaviorEdge) => {
    dispatch({ type: 'select', selected: { kind: 'edge', id: edge.id } });
    const to = graph.nodes.find((node) => node.id === edge.to);
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
    if (firstChanged?.file) {
      dispatch({ type: 'code/open', file: firstChanged.file, line: firstChanged.line, side: 'after' });
    } else {
      dispatch({ type: 'code/open' });
    }
  };

  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  const edges = graph.edges
    .map((edge) => {
      const from = nodeById.get(edge.from);
      const to = nodeById.get(edge.to);
      return from && to ? { edge, from, to } : null;
    })
    .filter((value): value is { edge: LaidOutEdge; from: LaidOutNode; to: LaidOutNode } => Boolean(value));

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div className={styles.titleGroup}>
          <div className={styles.eyebrow}>行为视图</div>
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

      <div className={styles.canvasWrap} onClick={() => dispatch({ type: 'peek/close' })}>
        {graph.nodes.length === 0 ? (
          <div className={styles.empty}>
            <p>本次改动没有可绘制的行为。</p>
            <p>可能两侧都没有命中 sink，或 SSA 未启用。</p>
          </div>
        ) : (
          <svg
            className={styles.canvas}
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            role="img"
            aria-label="行为数据流图"
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
                  <path
                    d="M 0 0 L 10 5 L 0 10 z"
                    className={styles[`marker_${delta}`]}
                  />
                </marker>
              ))}
            </defs>

            {labels.map((label, stage) => {
              if (!label) return null;
              const node = graph.nodes.find((candidate) => candidate.stage === stage);
              if (!node) return null;
              return (
                <text
                  key={stage}
                  className={styles.stageLabel}
                  x={node.x + node.width / 2}
                  y={28}
                  textAnchor="middle"
                >
                  {label}
                </text>
              );
            })}

            {edges.map(({ edge, from, to }) => (
              <Edge
                key={edge.id}
                edge={edge}
                from={from}
                to={to}
                onSelect={() => openEdgePeek(edge)}
              />
            ))}

            {graph.nodes.map((node) => (
              <Node
                key={node.id}
                node={node}
                selected={state.peek.nodeId === node.id || anchorNode?.id === node.id}
                onSelect={() => openPeek(node)}
              />
            ))}
          </svg>
        )}

        {state.peek.open && (selectedNode || selectedEdge) && (
          <div onClick={(event) => event.stopPropagation()}>
            <CodePeek
              node={selectedNode}
              edge={selectedEdge}
              anchor={
                anchorNode
                  ? {
                      file: anchorNode.file,
                      line: anchorNode.line,
                      side: anchorNode.delta === 'removed' ? 'before' : 'after',
                    }
                  : undefined
              }
            />
          </div>
        )}

        {!state.peek.open && (
          <div className={styles.hint}>
            点击节点查看代码与证据。判定节点可以展开分支；效果节点对齐在最右列。
          </div>
        )}
      </div>

      <section className={styles.scenarios}>
        <header className={styles.scenarioHead}>
          <span className={styles.eyebrow}>行为清单</span>
          <span className={styles.scenarioHint}>每条 scenario 从触发走到效果，按因果阶段排列</span>
        </header>
        <div className={styles.scenarioGrid}>
          {review.behavior.scenarios.map((scenario) => {
            const trigger = nodeById.get(scenario.trigger);
            const effect = nodeById.get(scenario.effect);
            const pathNodes = scenario.nodes
              .map((id) => nodeById.get(id))
              .filter((node): node is LaidOutNode => Boolean(node));
            return (
              <button
                key={scenario.id}
                type="button"
                className={styles.scenarioCard}
                onClick={() => (effect ? openPeek(effect) : trigger && openPeek(trigger))}
              >
                <span className={cx(styles.scenarioDelta, styles[`scenario_${scenario.delta}`])}>
                  {DELTA_LABEL[scenario.delta]}
                </span>
                <span className={styles.scenarioTitle}>{scenario.title}</span>
                <span className={styles.scenarioMeta}>
                  {scenario.source || '未知来源'} · {scenario.shape || '—'}
                </span>
                <span className={styles.scenarioPath}>
                  {pathNodes.map((node) => (
                    <i key={`${scenario.id}-${node.id}`} className={styles[`dot_${node.role}`]} title={roleLabel(node.role)} />
                  ))}
                </span>
              </button>
            );
          })}
        </div>
        <div className={styles.ledger}>
          <FactColumn
            title="项目结构"
            added={review.project.added}
            removed={review.project.removed}
          />
          <FactColumn
            title="逻辑"
            added={review.logic.added}
            removed={review.logic.removed}
            showShape
          />
          <FactColumn
            title="意图"
            added={review.intent.added}
            removed={review.intent.removed}
            showShape
          />
        </div>
        <div className={styles.basis}>
          <b>分析依据</b>
          <span>go/ast 调用边 · SSA 追源 · SyntaxFlow sink · 无 LLM 参与</span>
          <span className={styles.basisCount}>
            {review.intent.added.length + review.intent.removed.length} 条意图事实 ·{' '}
            {review.signals.length} 个关注点
          </span>
        </div>
      </section>

      <footer className={styles.foot}>
        <span>
          {review.behavior.entry
            ? `入口：${review.behavior.entry.replace('trigger:', '')}`
            : '未识别入口'}
        </span>
        <span>{files.filter((file) => file.status !== 'unchanged').length} 个变更文件</span>
        <span>{review.behavior.stageCount} 个因果阶段</span>
      </footer>
    </section>
  );
}
