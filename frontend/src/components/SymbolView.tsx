import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { baseName, cx, shortPath } from '../lib/format';
import { inducedSubgraph, layoutSymbols, scopedSubgraph, type PlacedSymbol, type SymbolScope } from '../lib/symbolLayout';
import { useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { DeltaKind, SymbolNode } from '../types';
import { IconCode, IconSearch } from './Icons';
import styles from './SymbolView.module.css';

const VIEW_W = 1440;
const VIEW_H = 880;

const DELTA_LABEL: Record<DeltaKind, string> = {
  added: '新增',
  removed: '删除',
  modified: '修改',
  unchanged: '未变',
};

interface ViewState {
  x: number;
  y: number;
  k: number;
}

function kindMark(node: SymbolNode): string {
  if (node.kind === 'type') return 'T';
  if (node.name.startsWith('AnonymousFunc')) return 'λ';
  return 'ƒ';
}

function SymbolCard({
  node,
  active,
  onSelect,
}: {
  node: PlacedSymbol;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <g
      transform={`translate(${node.x} ${node.y})`}
      className={cx(styles.node, styles[`node_${node.delta}`], active && styles.nodeActive)}
      role="button"
      tabIndex={0}
      aria-label={`${node.kind} ${node.name}`}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') onSelect();
      }}
    >
      <rect className={styles.card} width={node.width} height={node.height} rx={8} />
      <rect className={styles.glyphBox} x={11} y={14} width={26} height={26} rx={6} />
      <text className={styles.glyph} x={24} y={32} textAnchor="middle">
        {kindMark(node)}
      </text>
      <text className={styles.name} x={47} y={29}>
        {node.name.length > 22 ? `${node.name.slice(0, 21)}…` : node.name}
      </text>
      <text className={styles.meta} x={47} y={45}>
        {node.kind === 'type' ? node.package : `${node.callees}↓ ${node.callers}↑`}
      </text>
      {node.delta !== 'unchanged' && (
        <text className={styles.delta} x={node.width - 10} y={18} textAnchor="end">
          {DELTA_LABEL[node.delta]}
        </text>
      )}
    </g>
  );
}

export function SymbolView({ compact = false }: { compact?: boolean }) {
  const dispatch = useAppDispatch();
  const { review } = useReviewData();
  const symbols = review?.symbols;
  const [scope, setScope] = useState<SymbolScope>('changed');
  const [focusId, setFocusId] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const svgRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; ox: number; oy: number } | null>(null);

  const subgraph = useMemo(() => {
    if (!symbols) return { nodes: [], edges: [] };
    if (focusId) {
      const focus = symbols.nodes.find((node) => node.id === focusId);
      if (focus) return inducedSubgraph(symbols.nodes, symbols.edges, focusId);
    }
    return scopedSubgraph(symbols.nodes, symbols.edges, scope);
  }, [symbols, scope, focusId]);

  const layout = useMemo(() => layoutSymbols(subgraph), [subgraph]);

  const fit = () => {
    if (!layout.width || !layout.height) return;
    const k = Math.min(1, (VIEW_W / layout.width) * 0.94, (VIEW_H / layout.height) * 0.94);
    setView({
      x: (VIEW_W - layout.width * k) / 2,
      y: (VIEW_H - layout.height * k) / 2,
      k,
    });
  };

  useEffect(() => {
    fit();
    // 只在子图尺寸变化时重新适配，拖拽过程中不跳。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout.width, layout.height]);

  useEffect(() => {
    setPicked(null);
  }, [focusId]);

  if (!symbols || symbols.nodes.length === 0) {
    return (
      <section className={cx(styles.panel, compact && styles.compact)}>
        <div className={styles.empty}>
          <p>这次比较没有可绘制的函数或类型。</p>
          <p>符号图只来自 SSA 索引；目录模式下可能两侧都没有 Go 函数。</p>
        </div>
      </section>
    );
  }

  const pickedNode = symbols.nodes.find((node) => node.id === picked) ?? null;
  const focusNode = focusId ? symbols.nodes.find((node) => node.id === focusId) ?? null : null;
  const fileCount = new Set(subgraph.nodes.map((node) => node.file)).size;
  const typeCount = subgraph.nodes.filter((node) => node.kind === 'type').length;

  const openSource = (node: SymbolNode) => {
    if (!node.file) return;
    dispatch({
      type: 'code/open',
      file: node.file,
      line: node.line,
      side: node.delta === 'removed' ? 'before' : 'after',
    });
  };

  const neighbors = focusId
    ? symbols.edges.filter((edge) => edge.from === focusId || edge.to === focusId)
    : [];

  return (
    <section className={cx(styles.panel, compact && styles.compact)}>
      {!compact && (
        <header className={styles.head}>
          <div>
            <div className={styles.eyebrow}>{focusNode ? '内部调用图' : '符号关系图'}</div>
            <div className={styles.titleRow}>
              <h1>{focusNode ? focusNode.name : `${subgraph.nodes.length} 个符号`}</h1>
              <span className={styles.sub}>
                {focusNode
                  ? `${neighbors.length} 条直接调用 · 共享节点已合并`
                  : `${typeCount} 个类型 · ${fileCount} 个文件 · ${layout.edges.length} 条调用`}
              </span>
            </div>
          </div>
          <div className={styles.actions}>
            {focusId && (
              <button type="button" className="btn btnSmall" onClick={() => setFocusId(null)}>
                ← 返回全部
              </button>
            )}
            <div className={styles.scope} role="group" aria-label="显示范围">
              {(
                [
                  ['changed', '仅改动'],
                  ['context', '改动+邻居'],
                  ['all', '全部'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={scope === value}
                  className={scope === value ? styles.scopeActive : ''}
                  onClick={() => {
                    setScope(value);
                    setFocusId(null);
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="btn btnSmall" onClick={() => dispatch({ type: 'view/set', view: 'code' })}>
              <IconCode width={12} height={12} />
              代码
            </button>
            <button type="button" className="btn btnSmall" onClick={() => dispatch({ type: 'code/open', mode: 'search' })}>
              <IconSearch width={12} height={12} />
              搜索
            </button>
          </div>
        </header>
      )}

      <div className={styles.canvasWrap}>
        <svg
          ref={svgRef}
          className={styles.canvas}
          width="100%"
          height="100%"
          viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label="函数与类型关系图"
          data-zoom={view.k < 0.35 ? 'far' : view.k < 0.7 ? 'mid' : 'near'}
          onPointerDown={(event: ReactPointerEvent<SVGSVGElement>) => {
            event.currentTarget.setPointerCapture(event.pointerId);
            dragRef.current = {
              pointerId: event.pointerId,
              x: event.clientX,
              y: event.clientY,
              ox: view.x,
              oy: view.y,
            };
          }}
          onPointerMove={(event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const scale = VIEW_W / (svgRef.current?.clientWidth || VIEW_W);
            setView((current) => ({
              ...current,
              x: drag.ox + (event.clientX - drag.x) * scale,
              y: drag.oy + (event.clientY - drag.y) * scale,
            }));
          }}
          onPointerUp={() => {
            dragRef.current = null;
          }}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onWheel={(event) => {
            event.preventDefault();
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            const px = ((event.clientX - rect.left) / rect.width) * VIEW_W;
            const py = ((event.clientY - rect.top) / rect.height) * VIEW_H;
            setView((current) => {
              const next = Math.min(3, Math.max(0.12, current.k * (event.deltaY < 0 ? 1.12 : 0.89)));
              return {
                k: next,
                x: px - (px - current.x) * (next / current.k),
                y: py - (py - current.y) * (next / current.k),
              };
            });
          }}
          onClick={() => setPicked(null)}
        >
          <defs>
            {(['added', 'removed', 'modified', 'unchanged'] as const).map((delta) => (
              <marker
                key={delta}
                id={`sym-arrow-${delta}`}
                viewBox="0 0 10 10"
                refX="9"
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
            {layout.groups.map((group) => (
              <g key={group.id}>
                <rect
                  className={cx(styles.group, group.added + group.removed + group.modified > 0 && styles.groupChanged)}
                  x={group.x}
                  y={group.y}
                  width={group.width}
                  height={group.height}
                  rx={14}
                />
                <text className={styles.groupLabel} x={group.x + 14} y={group.y + 21}>
                  {baseName(group.file)}
                  <tspan className={styles.groupPath}> · {shortPath(group.file, 46)}</tspan>
                </text>
                {group.added + group.removed + group.modified > 0 && (
                  <text className={styles.groupDelta} x={group.x + group.width - 14} y={group.y + 21} textAnchor="end">
                    {group.added ? `+${group.added}` : ''} {group.removed ? `−${group.removed}` : ''}{' '}
                    {group.modified ? `~${group.modified}` : ''}
                  </text>
                )}
                {compact && (
                  <text className={styles.groupCount} x={group.x + 14} y={group.y + 40}>
                    {group.nodes.length} 个符号
                  </text>
                )}
              </g>
            ))}

            {!compact && <g className={styles.edges}>
              {layout.edges.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.path}
                  className={cx(
                    styles.edge,
                    styles[`edge_${edge.delta}`],
                    edge.crossGroup && styles.edgeCross,
                  )}
                  markerEnd={`url(#sym-arrow-${edge.delta})`}
                />
              ))}
            </g>}

            {!compact && layout.nodes.map((node) => (
              <SymbolCard
                key={node.id}
                node={node}
                active={picked === node.id || focusId === node.id}
                onSelect={() => {
                  setPicked(node.id);
                  if (node.kind === 'function') setFocusId(node.id);
                }}
              />
            ))}
          </g>
        </svg>

        {!compact && (
          <>
            <div className={styles.legend}>
              {(['added', 'removed', 'modified', 'unchanged'] as const).map((delta) => (
                <span key={delta} className={styles[`legend_${delta}`]}>
                  <i />
                  {DELTA_LABEL[delta]}
                </span>
              ))}
            </div>

            <div className={styles.viewControls} aria-label="画布缩放">
              <button type="button" onClick={() => setView((current) => ({ ...current, k: Math.min(3, current.k * 1.16) }))} aria-label="放大">+</button>
              <span>{Math.round(view.k * 100)}%</span>
              <button type="button" onClick={() => setView((current) => ({ ...current, k: Math.max(0.12, current.k * 0.86) }))} aria-label="缩小">−</button>
              <button type="button" className={styles.fitButton} onClick={fit}>适应</button>
            </div>

            <div className={styles.geometry}>
              交叉 {layout.crossings} · 穿卡 {layout.occlusions} · 范围内边 {layout.edges.length}/{symbols.edges.length}
            </div>

            {pickedNode && (
              <aside className={styles.detail}>
                <div className={styles.detailHead}>
                  <span className={cx(styles.kind, styles[`kind_${pickedNode.kind}`])}>
                    {pickedNode.kind === 'type' ? '类型' : '函数'}
                  </span>
                  <span className={styles[`pill_${pickedNode.delta}`]}>{DELTA_LABEL[pickedNode.delta]}</span>
                  <button type="button" className={styles.detailClose} onClick={() => setPicked(null)} aria-label="关闭">
                    ×
                  </button>
                </div>
                <h3>{pickedNode.name}</h3>
                <code className={styles.signature}>{pickedNode.signature || pickedNode.package}</code>
                <div className={styles.detailMeta}>
                  <span title={pickedNode.file}>{shortPath(pickedNode.file, 40)}:{pickedNode.line}</span>
                  <span>
                    {pickedNode.callers} 个调用者 · {pickedNode.callees} 个被调用
                  </span>
                </div>
                {(pickedNode.members ?? []).length > 0 && (
                  <div className={styles.members}>
                    {(pickedNode.members ?? []).slice(0, 12).map((member) => (
                      <code key={member}>{member}</code>
                    ))}
                    {(pickedNode.members ?? []).length > 12 && <em>+{(pickedNode.members ?? []).length - 12}</em>}
                  </div>
                )}
                <div className={styles.detailActions}>
                  <button type="button" className="btn btnSmall" onClick={() => openSource(pickedNode)}>
                    打开源码
                  </button>
                  {pickedNode.kind === 'function' && (
                    <button type="button" className="btn btnSmall btnPrimary" onClick={() => setFocusId(pickedNode.id)}>
                      展开内部调用
                    </button>
                  )}
                </div>
              </aside>
            )}
          </>
        )}
      </div>
    </section>
  );
}
