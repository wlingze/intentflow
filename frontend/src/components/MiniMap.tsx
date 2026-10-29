import { useEffect, useRef, useState } from 'react';
import { roleLabel } from '../lib/behavior';
import type { BehaviorLayout, LaidOutNode } from '../types';
import { IconMinus, IconPlus, IconTarget } from './Icons';
import styles from './MiniMap.module.css';

interface Props {
  graph: BehaviorLayout;
  activeNodeId?: string;
  onSelect: (node: LaidOutNode) => void;
  onClose: () => void;
}

const WIDTH = 288;
const HEIGHT = 196;
const PAD = 12;

export function MiniMap({ graph, activeNodeId, onSelect, onClose }: Props) {
  const [scale, setScale] = useState(0.2);
  const [tx, setTx] = useState(0);
  const [ty, setTy] = useState(0);
  const drag = useRef<{ x: number; y: number; tx: number; ty: number; moved: boolean } | null>(null);

  const fit = () => {
    if (!graph.width || !graph.height) return;
    const next = Math.min((WIDTH - PAD * 2) / graph.width, (HEIGHT - PAD * 2) / graph.height, 1);
    setScale(next);
    setTx((WIDTH - graph.width * next) / 2);
    setTy((HEIGHT - graph.height * next) / 2);
  };

  useEffect(() => {
    fit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph.width, graph.height]);

  const zoom = (factor: number) => {
    const next = Math.min(2, Math.max(0.08, scale * factor));
    const cx = WIDTH / 2;
    const cy = HEIGHT / 2;
    setTx(cx - ((cx - tx) * next) / scale);
    setTy(cy - ((cy - ty) * next) / scale);
    setScale(next);
  };

  const onWheel = (event: React.WheelEvent) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.12 : 0.89);
  };

  const onPointerDown = (event: React.PointerEvent) => {
    if (event.button !== 0) return;
    drag.current = { x: event.clientX, y: event.clientY, tx, ty, moved: false };
  };

  const onPointerMove = (event: React.PointerEvent) => {
    const state = drag.current;
    if (!state) return;
    const dx = event.clientX - state.x;
    const dy = event.clientY - state.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) state.moved = true;
    setTx(state.tx + dx);
    setTy(state.ty + dy);
  };

  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <aside className={styles.minimap} aria-label="行为图缩略图">
      <header className={styles.head}>
        <span>行为图</span>
        <span className={styles.stageCount}>{graph.stageCount} 阶段</span>
        <div className={styles.controls}>
          <button type="button" title="缩小" onClick={() => zoom(0.86)}>
            <IconMinus width={11} height={11} />
          </button>
          <button type="button" title="放大" onClick={() => zoom(1.16)}>
            <IconPlus width={11} height={11} />
          </button>
          <button type="button" title="适应窗口" onClick={fit}>
            <IconTarget width={11} height={11} />
          </button>
          <button type="button" title="收起缩略图" onClick={onClose}>
            ×
          </button>
        </div>
      </header>
      <svg
        className={styles.canvas}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <g transform={`translate(${tx} ${ty}) scale(${scale})`}>
          {graph.edges.map((edge) => (
            <path
              key={edge.id}
              d={edge.path}
              className={`${styles.edge} ${styles[`edge_${edge.delta}`]}`}
            />
          ))}
          {graph.nodes.map((node) => (
            <g
              key={node.id}
              className={styles.node}
              onClick={(event) => {
                event.stopPropagation();
                onSelect(node);
              }}
            >
              <title>
                {roleLabel(node.role)} · {node.label} · {node.delta}
              </title>
              <rect
                x={node.x}
                y={node.y}
                width={node.width}
                height={node.height}
                rx={10}
                className={`${styles.card} ${styles[`node_${node.role}`]} ${
                  node.id === activeNodeId ? styles.active : ''
                } ${styles[`delta_${node.delta}`]}`}
              />
              <text x={node.x + 12} y={node.y + 28} className={styles.label}>
                {node.label.slice(0, 24)}
              </text>
              <text x={node.x + 12} y={node.y + 46} className={styles.role}>
                {roleLabel(node.role)}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </aside>
  );
}
