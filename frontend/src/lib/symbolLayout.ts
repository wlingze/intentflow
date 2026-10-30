import type { DeltaKind, SymbolEdge, SymbolNode } from '../types';

export interface SymbolGroup {
  id: string;
  file: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodes: string[];
  added: number;
  removed: number;
  modified: number;
}

export interface PlacedSymbol extends SymbolNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PlacedCall extends SymbolEdge {
  path: string;
  labelX: number;
  labelY: number;
  crossGroup: boolean;
}

export interface SymbolLayout {
  nodes: PlacedSymbol[];
  edges: PlacedCall[];
  groups: SymbolGroup[];
  width: number;
  height: number;
  crossings: number;
  occlusions: number;
  hiddenEdges: number;
}

export interface SymbolLayoutInput {
  nodes: SymbolNode[];
  edges: SymbolEdge[];
}

// 节点尺寸按类型区分：类型节点略矮，一眼能和函数分开。
const NODE_W = 188;
const NODE_H = 54;
const TYPE_H = 46;
const GROUP_PAD = 22;
const GROUP_HEAD = 34;
const GAP_X = 26;
const GAP_Y = 22;
const GROUP_GAP = 46;

const DELTA_ORDER: Record<DeltaKind, number> = {
  modified: 0,
  added: 1,
  removed: 2,
  unchanged: 3,
};

function nodeHeight(node: SymbolNode): number {
  return node.kind === 'type' ? TYPE_H : NODE_H;
}

function groupKey(node: SymbolNode): string {
  return node.file || node.package || '(unknown)';
}

export function layoutSymbols(input: SymbolLayoutInput): SymbolLayout {
  const visible = new Map(input.nodes.map((node) => [node.id, node]));
  const edges = input.edges.filter((edge) => visible.has(edge.from) && visible.has(edge.to));

  const buckets = new Map<string, SymbolNode[]>();
  for (const node of input.nodes) {
    const key = groupKey(node);
    const list = buckets.get(key) ?? [];
    list.push(node);
    buckets.set(key, list);
  }

  // 先算每个文件内部的网格，再按面积从大到小做货架式装箱。
  const inDegree = new Map<string, number>();
  for (const edge of edges) {
    inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
  }

  interface Draft {
    key: string;
    nodes: SymbolNode[];
    cols: number;
    rows: number;
    width: number;
    height: number;
  }

  const drafts: Draft[] = [];
  for (const [key, list] of buckets) {
    const sorted = [...list].sort((left, right) => {
      const byDelta = DELTA_ORDER[left.delta] - DELTA_ORDER[right.delta];
      if (byDelta !== 0) return byDelta;
      const byDegree = (inDegree.get(right.id) ?? 0) - (inDegree.get(left.id) ?? 0);
      if (byDegree !== 0) return byDegree;
      return left.line - right.line || left.name.localeCompare(right.name);
    });
    const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length * 1.45)));
    const rows = Math.ceil(sorted.length / cols);
    drafts.push({
      key,
      nodes: sorted,
      cols,
      rows,
      width: GROUP_PAD * 2 + cols * NODE_W + (cols - 1) * GAP_X,
      height: GROUP_HEAD + GROUP_PAD + rows * NODE_H + (rows - 1) * GAP_Y,
    });
  }
  drafts.sort((left, right) => right.width * right.height - left.width * left.height);

  const totalArea = drafts.reduce((sum, draft) => sum + (draft.width + GROUP_GAP) * (draft.height + GROUP_GAP), 0);
  const targetWidth = Math.max(1200, Math.sqrt(totalArea * 1.55));
  const groups: SymbolGroup[] = [];
  const placed = new Map<string, PlacedSymbol>();

  let cursorX = 0;
  let cursorY = 0;
  let shelfHeight = 0;
  for (const draft of drafts) {
    if (cursorX > 0 && cursorX + draft.width > targetWidth) {
      cursorX = 0;
      cursorY += shelfHeight + GROUP_GAP;
      shelfHeight = 0;
    }
    const groupX = cursorX;
    const groupY = cursorY;
    const groupNodes: string[] = [];
    let added = 0;
    let removed = 0;
    let modified = 0;

    draft.nodes.forEach((node, index) => {
      const col = index % draft.cols;
      const row = Math.floor(index / draft.cols);
      const x = groupX + GROUP_PAD + col * (NODE_W + GAP_X);
      const y = groupY + GROUP_HEAD + GROUP_PAD + row * (NODE_H + GAP_Y);
      placed.set(node.id, {
        ...node,
        x,
        y,
        width: NODE_W,
        height: nodeHeight(node),
      });
      groupNodes.push(node.id);
      if (node.delta === 'added') added++;
      else if (node.delta === 'removed') removed++;
      else if (node.delta === 'modified') modified++;
    });

    groups.push({
      id: `group:${draft.key}`,
      file: draft.key,
      x: groupX,
      y: groupY,
      width: draft.width,
      height: draft.height,
      nodes: groupNodes,
      added,
      removed,
      modified,
    });

    cursorX += draft.width + GROUP_GAP;
    shelfHeight = Math.max(shelfHeight, draft.height);
  }

  const width = Math.max(
    800,
    groups.reduce((max, group) => Math.max(max, group.x + group.width), 0),
  );
  const height = Math.max(
    600,
    groups.reduce((max, group) => Math.max(max, group.y + group.height), 0),
  );

  // 小图（钻取视图）用网格 A* 绕开卡片；大图只用曲线，
  // 否则 1400 条边逐条寻路会把主线程卡住。
  const smallGraph = edges.length <= 90;
  const placedEdges: PlacedCall[] = [];
  for (const edge of edges) {
    const from = placed.get(edge.from);
    const to = placed.get(edge.to);
    if (!from || !to) continue;
    const fromGroup = groupOf(groups, from.x + from.width / 2, from.y + from.height / 2);
    const toGroup = groupOf(groups, to.x + to.width / 2, to.y + to.height / 2);
    const crossGroup = fromGroup?.id !== toGroup?.id;
    const path = smallGraph
      ? routeAround(from, to, [...placed.values()])
      : crossGroup
        ? groupEdge(from, to)
        : nodeEdge(from, to);
    placedEdges.push({
      ...edge,
      crossGroup,
      path,
      labelX: (from.x + from.width / 2 + to.x + to.width / 2) / 2,
      labelY: (from.y + from.height / 2 + to.y + to.height / 2) / 2,
    });
  }

  const crossings = countCrossings(placedEdges);
  const occlusions = countOcclusions([...placed.values()], placedEdges);
  return {
    nodes: [...placed.values()],
    edges: placedEdges,
    groups,
    width,
    height,
    crossings,
    occlusions,
    hiddenEdges: input.edges.length - edges.length,
  };
}

function groupOf(groups: SymbolGroup[], x: number, y: number): SymbolGroup | undefined {
  return groups.find(
    (group) => x >= group.x && x <= group.x + group.width && y >= group.y && y <= group.y + group.height,
  );
}

// 同文件内直接连中心，跨文件绕到分组边界，避免线从卡片中间穿过。
function nodeEdge(from: PlacedSymbol, to: PlacedSymbol): string {
  const start = edgePoint(from, to);
  const end = edgePoint(to, from);
  const mx = (start.x + end.x) / 2;
  const my = (start.y + end.y) / 2;
  return `M ${start.x} ${start.y} Q ${mx} ${my - 14} ${end.x} ${end.y}`;
}

// routeAround 在 6px 网格上跑 A*，障碍是所有其他卡片。
// 起终点从卡片最近的一边出发，路径用直角折线，转角圆角化。
function routeAround(from: PlacedSymbol, to: PlacedSymbol, all: PlacedSymbol[]): string {
  const cell = 6;
  const pad = 40;
  const minX = Math.min(from.x, to.x) - pad;
  const minY = Math.min(from.y, to.y) - pad;
  const maxX = Math.max(from.x + from.width, to.x + to.width) + pad;
  const maxY = Math.max(from.y + from.height, to.y + to.height) + pad;
  const cols = Math.ceil((maxX - minX) / cell);
  const rows = Math.ceil((maxY - minY) / cell);
  if (cols <= 0 || rows <= 0 || cols * rows > 90_000) {
    return groupEdge(from, to);
  }
  const blocked = new Uint8Array(cols * rows);
  const mark = (node: PlacedSymbol) => {
    const x0 = Math.max(0, Math.floor((node.x - minX) / cell) - 1);
    const x1 = Math.min(cols - 1, Math.ceil((node.x + node.width - minX) / cell) + 1);
    const y0 = Math.max(0, Math.floor((node.y - minY) / cell) - 1);
    const y1 = Math.min(rows - 1, Math.ceil((node.y + node.height - minY) / cell) + 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) blocked[y * cols + x] = 1;
    }
  };
  for (const node of all) {
    if (node.id !== from.id && node.id !== to.id) mark(node);
  }
  const start = edgePoint(from, to);
  const end = edgePoint(to, from);
  const toCell = (point: { x: number; y: number }) => ({
    x: Math.max(0, Math.min(cols - 1, Math.round((point.x - minX) / cell))),
    y: Math.max(0, Math.min(rows - 1, Math.round((point.y - minY) / cell))),
  });
  const s = toCell(start);
  const t = toCell(end);
  const startIndex = s.y * cols + s.x;
  const goalIndex = t.y * cols + t.x;
  // 起终点自身的格子解锁，否则贴着卡片边时无路可走。
  blocked[startIndex] = 0;
  blocked[goalIndex] = 0;

  const dist = new Float64Array(cols * rows).fill(Infinity);
  const prev = new Int32Array(cols * rows).fill(-1);
  const open: number[] = [startIndex];
  dist[startIndex] = 0;
  const heuristic = (index: number) => {
    const x = index % cols;
    const y = (index - x) / cols;
    return Math.abs(x - t.x) + Math.abs(y - t.y);
  };
  while (open.length > 0) {
    let best = 0;
    for (let i = 1; i < open.length; i++) {
      if (dist[open[i]] + heuristic(open[i]) < dist[open[best]] + heuristic(open[best])) best = i;
    }
    const current = open.splice(best, 1)[0];
    if (current === goalIndex) break;
    const cx = current % cols;
    const cy = (current - cx) / cols;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const next = ny * cols + nx;
      if (blocked[next]) continue;
      const cost = dist[current] + 1;
      if (cost < dist[next]) {
        dist[next] = cost;
        prev[next] = current;
        if (!open.includes(next)) open.push(next);
      }
    }
  }
  if (prev[goalIndex] === -1) return groupEdge(from, to);
  const points: { x: number; y: number }[] = [];
  for (let index = goalIndex; index !== -1; index = prev[index]) {
    const x = index % cols;
    const y = (index - x) / cols;
    points.push({ x: minX + x * cell, y: minY + y * cell });
    if (index === startIndex) break;
  }
  points.reverse();
  points.unshift(start);
  points.push(end);
  return roundedPath(points, 4);
}

function roundedPath(points: { x: number; y: number }[], radius: number): string {
  const clean: { x: number; y: number }[] = [];
  for (const point of points) {
    const last = clean[clean.length - 1];
    if (!last || Math.abs(last.x - point.x) > 0.5 || Math.abs(last.y - point.y) > 0.5) {
      clean.push(point);
    }
  }
  if (clean.length < 3) {
    return `M ${clean.map((point) => `${point.x} ${point.y}`).join(' L ')}`;
  }
  let d = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const prev = clean[i - 1];
    const point = clean[i];
    const next = clean[i + 1];
    const r = Math.min(radius, Math.hypot(point.x - prev.x, point.y - prev.y) / 2, Math.hypot(next.x - point.x, next.y - point.y) / 2);
    const before = { x: point.x + Math.sign(prev.x - point.x) * r, y: point.y + Math.sign(prev.y - point.y) * r };
    const after = { x: point.x + Math.sign(next.x - point.x) * r, y: point.y + Math.sign(next.y - point.y) * r };
    d += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  const last = clean[clean.length - 1];
  return `${d} L ${last.x} ${last.y}`;
}

function groupEdge(from: PlacedSymbol, to: PlacedSymbol): string {
  const start = edgePoint(from, to);
  const end = edgePoint(to, from);
  const midX = (start.x + end.x) / 2;
  return `M ${start.x} ${start.y} C ${midX} ${start.y} ${midX} ${end.y} ${end.x} ${end.y}`;
}

function edgePoint(node: PlacedSymbol, towards: PlacedSymbol): { x: number; y: number } {
  const cx = node.x + node.width / 2;
  const cy = node.y + node.height / 2;
  const tx = towards.x + towards.width / 2;
  const ty = towards.y + towards.height / 2;
  const dx = tx - cx;
  const dy = ty - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const halfW = node.width / 2 + 2;
  const halfH = node.height / 2 + 2;
  const scale = Math.min(halfW / Math.abs(dx || 1e-6), halfH / Math.abs(dy || 1e-6));
  return { x: cx + dx * scale, y: cy + dy * scale };
}

// 用采样后的折线做精确相交统计。1472 条边约 100 万次比较，
// 只在布局变化时跑一次，不进入滚动路径。
function countCrossings(edges: PlacedCall[]): number {
  const segments = edges.map((edge) => samplePath(edge.path, 6));
  let crossings = 0;
  for (let i = 0; i < segments.length; i++) {
    for (let j = i + 1; j < segments.length; j++) {
      if (intersects(segments[i], segments[j])) crossings++;
    }
  }
  return crossings;
}

function countOcclusions(nodes: PlacedSymbol[], edges: PlacedCall[]): number {
  let hits = 0;
  for (const edge of edges) {
    const points = samplePath(edge.path, 10);
    for (const node of nodes) {
      if (points.some((point) => insideNode(point, node))) {
        hits++;
        break;
      }
    }
  }
  return hits;
}

function insideNode(point: { x: number; y: number }, node: PlacedSymbol): boolean {
  return (
    point.x > node.x + 2 &&
    point.x < node.x + node.width - 2 &&
    point.y > node.y + 2 &&
    point.y < node.y + node.height - 2
  );
}

// 采样 SVG 路径：解析 M/L/Q/C，用于几何检测。只支持本文件生成的命令集。
function samplePath(path: string, steps: number): { x: number; y: number }[] {
  const tokens = path.match(/[MLQC]|-?\d+(\.\d+)?/g) ?? [];
  const points: { x: number; y: number }[] = [];
  let cursor = { x: 0, y: 0 };
  let index = 0;
  const next = () => Number(tokens[index++]);
  while (index < tokens.length) {
    const command = tokens[index++];
    if (command === 'M') {
      cursor = { x: next(), y: next() };
      points.push(cursor);
    } else if (command === 'L') {
      cursor = { x: next(), y: next() };
      points.push(cursor);
    } else if (command === 'Q') {
      const control = { x: next(), y: next() };
      const end = { x: next(), y: next() };
      const from = cursor;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        points.push({
          x: u * u * from.x + 2 * u * t * control.x + t * t * end.x,
          y: u * u * from.y + 2 * u * t * control.y + t * t * end.y,
        });
      }
      cursor = end;
    } else if (command === 'C') {
      const c1 = { x: next(), y: next() };
      const c2 = { x: next(), y: next() };
      const end = { x: next(), y: next() };
      const from = cursor;
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const u = 1 - t;
        points.push({
          x: u * u * u * from.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * end.x,
          y: u * u * u * from.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * end.y,
        });
      }
      cursor = end;
    } else {
      break;
    }
  }
  return points;
}

function intersects(a: { x: number; y: number }[], b: { x: number; y: number }[]): boolean {
  for (let i = 1; i < a.length; i++) {
    for (let j = 1; j < b.length; j++) {
      if (segmentsCross(a[i - 1], a[i], b[j - 1], b[j])) return true;
    }
  }
  return false;
}

function segmentsCross(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  p3: { x: number; y: number },
  p4: { x: number; y: number },
): boolean {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function cross(
  a: { x: number; y: number },
  b: { x: number; y: number },
  c: { x: number; y: number },
): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

// 1-hop 诱导子图：钻取时只看这个节点和它的直接邻居，共享节点按 id 合并。
export function inducedSubgraph(
  nodes: SymbolNode[],
  edges: SymbolEdge[],
  focusId: string,
): SymbolLayoutInput {
  const keep = new Set<string>([focusId]);
  for (const edge of edges) {
    if (edge.from === focusId) keep.add(edge.to);
    if (edge.to === focusId) keep.add(edge.from);
  }
  return {
    nodes: nodes.filter((node) => keep.has(node.id)),
    edges: edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
  };
}

export type SymbolScope = 'changed' | 'context' | 'all';

// 三种范围：
//   changed  只画变更的符号，边只保留两端都在范围内的；最容易读。
//   context  变更符号 + 一跳邻居，用来看影响面。
//   all      全部符号。
// 范围内的边一条不删；范围外的数量在图例里如实显示。
export function scopedSubgraph(
  nodes: SymbolNode[],
  edges: SymbolEdge[],
  scope: SymbolScope,
): SymbolLayoutInput {
  if (scope === 'all') return { nodes, edges };
  const keep = new Set<string>();
  for (const node of nodes) {
    if (node.delta !== 'unchanged') keep.add(node.id);
  }
  if (scope === 'context') {
    for (const edge of edges) {
      if (keep.has(edge.from) || keep.has(edge.to)) {
        keep.add(edge.from);
        keep.add(edge.to);
      }
    }
  }
  return {
    nodes: nodes.filter((node) => keep.has(node.id)),
    edges: edges.filter((edge) => keep.has(edge.from) && keep.has(edge.to)),
  };
}
