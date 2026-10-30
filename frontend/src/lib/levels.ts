import type {
  BehaviorEdge,
  BehaviorGraph,
  BehaviorNode,
  BehaviorRole,
  BehaviorLayout,
  DeltaKind,
  LaidOutEdge,
  LaidOutNode,
} from '../types';
import { baseName } from './format';

const NODE_W = 196;
const NODE_H = 68;
const GAP_X = 54;
const GAP_Y = 26;
const LEFT = 36;
const TOP = 36;

const ROLE_ORDER: Record<BehaviorRole, number> = {
  trigger: 0,
  transform: 1,
  effect: 2,
  decision: 3,
};

const DELTA_ORDER: Record<DeltaKind, number> = {
  modified: 0,
  added: 1,
  removed: 2,
  unchanged: 3,
};

type PackedNode = BehaviorNode & {
  count?: number;
  members?: string[];
  display?: 'file' | 'function' | 'behavior';
  sourceNodeId?: string;
};

type PackedEdge = BehaviorEdge & { count?: number };

function mergeDelta(values: DeltaKind[]): DeltaKind {
  const set = new Set(values);
  if (set.size === 0) return 'unchanged';
  if (set.size === 1) return values[0];
  return 'modified';
}

function union<T>(left: T[] | undefined, right: T[] | undefined): T[] {
  return Array.from(new Set([...(left ?? []), ...(right ?? [])]));
}

function roleOf(node: BehaviorNode): string {
  switch (node.role) {
    case 'trigger': return '触发';
    case 'decision': return '判定';
    case 'transform': return '变换';
    case 'effect': return '效果';
  }
}

function functionKey(node: BehaviorNode): string {
  return `${node.file}\u0000${node.function || node.label}`;
}

function buildFunctionGraph(graph: BehaviorGraph): { nodes: PackedNode[]; edges: PackedEdge[] } {
  const merged = new Map<string, PackedNode>();
  const originalToMerged = new Map<string, string>();

  for (const node of graph.nodes) {
    if (node.role === 'decision') continue;
    const key = functionKey(node);
    const id = `fn:${key}`;
    originalToMerged.set(node.id, id);
    const old = merged.get(id);
    if (!old) {
      merged.set(id, {
        ...node,
        id,
        label: node.function || node.label,
        detail: roleOf(node),
        delta: node.delta,
        count: 1,
        members: [roleOf(node)],
        display: 'function',
        sourceNodeId: node.id,
      });
      continue;
    }
    const wasUnchanged = old.delta === 'unchanged';
    old.delta = mergeDelta([old.delta, node.delta]);
    if (wasUnchanged && node.delta !== 'unchanged') {
      old.sourceNodeId = node.id;
      old.line = node.line;
    }
    old.count = (old.count ?? 1) + 1;
    old.members = union(old.members, [node.function || node.label]);
    old.evidence = union(old.evidence, node.evidence);
    old.tags = union(old.tags, node.tags);
    if (ROLE_ORDER[node.role] < ROLE_ORDER[old.role]) old.role = node.role;
    old.source = old.source || node.source;
    old.shape = old.shape || node.shape;
    old.category = old.category || node.category;
    old.line = old.line || node.line;
  }

  for (const node of merged.values()) {
    node.detail = roleOf(node);
    node.change = node.change || baseName(node.file);
  }

  const edgeMap = new Map<string, PackedEdge>();
  for (const edge of graph.edges) {
    // 函数层只回答“谁调用谁”。判定和数据边留给下方内部行为。
    if (edge.kind !== 'call') continue;
    const from = originalToMerged.get(edge.from);
    const to = originalToMerged.get(edge.to);
    if (!from || !to || from === to) continue;
    const key = `${from}>${to}`;
    const old = edgeMap.get(key);
    if (!old) {
      edgeMap.set(key, {
        ...edge,
        id: `fn-edge:${key}`,
        from,
        to,
        scenario: '',
        label: edge.kind === 'call' ? '调用' : edge.label || edge.kind,
        source: '',
        shape: '',
        count: 1,
      });
      continue;
    }
    old.count = (old.count ?? 1) + 1;
    old.delta = mergeDelta([old.delta, edge.delta]);
    old.evidence = union(old.evidence, edge.evidence);
    if (edge.kind === 'call') {
      old.kind = 'call';
      old.label = '调用';
    }
  }

  return {
    nodes: [...merged.values()].sort((left, right) => {
      const byRole = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
      return byRole !== 0 ? byRole : left.label.localeCompare(right.label);
    }),
    edges: [...edgeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function fileKey(node: BehaviorNode): string {
  return node.file || '(no file)';
}

function buildFileGraph(fn: { nodes: PackedNode[]; edges: PackedEdge[] }): {
  nodes: PackedNode[];
  edges: PackedEdge[];
} {
  const byId = new Map(fn.nodes.map((node) => [node.id, node]));
  const groups = new Map<string, PackedNode>();

  for (const node of fn.nodes) {
    const key = fileKey(node);
    const id = `file:${key}`;
    const old = groups.get(id);
    if (!old) {
      groups.set(id, {
        id,
        role: 'trigger',
        label: baseName(key),
        detail: '文件',
        file: node.file,
        line: node.line,
        function: '',
        package: node.package,
        confidence: node.confidence,
        evidence: [],
        tags: ['file'],
        snippet: '',
        source: '',
        shape: '',
        category: '',
        change: '',
        stage: 0,
        delta: node.delta,
        count: 1,
        members: [node.function || node.label],
        display: 'file',
      });
      continue;
    }
    old.delta = mergeDelta([old.delta, node.delta]);
    old.count = (old.count ?? 1) + 1;
    old.members = union(old.members, [node.function || node.label]);
    old.evidence = union(old.evidence, node.evidence);
    old.tags = union(old.tags, node.tags);
    old.line = old.line || node.line;
    old.package = old.package || node.package;
  }

  for (const node of groups.values()) {
    node.detail = `${node.count ?? 1} 个函数`;
  }

  const edgeMap = new Map<string, PackedEdge>();
  for (const edge of fn.edges) {
    const fromNode = byId.get(edge.from);
    const toNode = byId.get(edge.to);
    if (!fromNode || !toNode) continue;
    const from = `file:${fileKey(fromNode)}`;
    const to = `file:${fileKey(toNode)}`;
    if (from === to) continue;
    const key = `${from}>${to}`;
    const old = edgeMap.get(key);
    if (!old) {
      edgeMap.set(key, {
        ...edge,
        id: `file-edge:${key}`,
        from,
        to,
        scenario: '',
        kind: 'call',
        label: '关系',
        source: '',
        shape: '',
        count: 1,
      });
      continue;
    }
    old.count = (old.count ?? 1) + 1;
    old.delta = mergeDelta([old.delta, edge.delta]);
    old.evidence = union(old.evidence, edge.evidence);
  }

  return {
    nodes: [...groups.values()].sort((left, right) => {
      const byDelta = DELTA_ORDER[left.delta] - DELTA_ORDER[right.delta];
      return byDelta !== 0 ? byDelta : left.label.localeCompare(right.label);
    }),
    edges: [...edgeMap.values()].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function orthPath(sx: number, sy: number, laneX: number, ey: number, ex: number): string {
  if (Math.abs(ey - sy) < 2) return `M ${sx} ${sy} H ${ex}`;
  const vertical = Math.sign(ey - sy) || 1;
  const startDir = Math.sign(laneX - sx) || 1;
  const endDir = Math.sign(ex - laneX) || 1;
  const radius = Math.min(
    9,
    Math.abs(laneX - sx) / 2,
    Math.abs(ey - sy) / 2,
    Math.abs(ex - laneX) / 2,
  );
  if (radius < 1) {
    return `M ${sx} ${sy} H ${laneX} V ${ey} H ${ex}`;
  }
  const y1 = sy + vertical * radius;
  const y2 = ey - vertical * radius;
  return [
    `M ${sx} ${sy}`,
    `H ${laneX - startDir * radius}`,
    `Q ${laneX} ${sy} ${laneX} ${y1}`,
    `V ${y2}`,
    `Q ${laneX} ${ey} ${laneX + endDir * radius} ${ey}`,
    `H ${ex}`,
  ].join(' ');
}

/**
 * 正交走线：优先走列间空隙，不穿过卡片。
 * 同列节点从卡片右侧绕到目标右侧，避免反向曲线穿过两个卡片。
 */
function edgePath(
  from: LaidOutNode,
  to: LaidOutNode,
  lane = 0,
  bottom?: number,
): { path: string; labelX: number; labelY: number } {
  const sy = from.y + from.height / 2;
  const ey = to.y + to.height / 2;
  const sideOffset = 7 + (lane % 3) * 6;
  const backOffset = 14 + (lane % 3) * 8;
  const overlapX = to.x < from.x + from.width && to.x + to.width > from.x;
  const far = Math.abs(to.x - from.x) > NODE_W + GAP_X * 1.8;

  if (bottom !== undefined && far && !overlapX) {
    const laneY = bottom + 12 + (lane % 4) * 8;
    if (to.x > from.x) {
      const startLane = from.x + from.width + 14;
      const targetLane = to.x - 14;
      return {
        path: `M ${from.x + from.width} ${sy} H ${startLane} V ${laneY} H ${targetLane} V ${ey} H ${to.x}`,
        labelX: (startLane + targetLane) / 2,
        labelY: laneY - 7,
      };
    }
    const startLane = from.x - 14;
    const targetLane = to.x + to.width + 14;
    return {
      path: `M ${from.x} ${sy} H ${startLane} V ${laneY} H ${targetLane} V ${ey} H ${to.x + to.width}`,
      labelX: (startLane + targetLane) / 2,
      labelY: laneY - 7,
    };
  }

  if (overlapX) {
    const sx = from.x + from.width;
    const ex = to.x + to.width;
    const laneX = Math.max(sx, ex) + sideOffset;
    return {
      path: orthPath(sx, sy, laneX, ey, ex),
      labelX: laneX,
      labelY: (sy + ey) / 2 - 7,
    };
  }

  if (to.x >= from.x + from.width) {
    const sx = from.x + from.width;
    const ex = to.x;
    const gap = ex - sx;
    const laneX = sx + Math.max(10, Math.min(gap - 6, 14 + (lane % 3) * 9));
    return {
      path: orthPath(sx, sy, laneX, ey, ex),
      labelX: laneX,
      labelY: (sy + ey) / 2 - 7,
    };
  }

  const sx = from.x;
  const ex = to.x + to.width;
  const laneX = Math.min(sx, ex) - backOffset;
  return {
    path: orthPath(sx, sy, laneX, ey, ex),
    labelX: laneX,
    labelY: (sy + ey) / 2 - 7,
  };
}

function layoutDirected(
  nodes: PackedNode[],
  edges: PackedEdge[],
  level: string,
): BehaviorLayout {
  const depth = new Map<string, number>();
  for (const node of nodes) depth.set(node.id, 0);

  // 最长路径分层。图里允许环，超出节点数后停止。
  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      const from = depth.get(edge.from);
      const to = depth.get(edge.to);
      if (from === undefined || to === undefined) continue;
      if (to < from + 1) {
        depth.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const columns = new Map<number, PackedNode[]>();
  for (const node of nodes) {
    const value = Math.min(depth.get(node.id) ?? 0, Math.max(0, nodes.length - 1));
    const list = columns.get(value) ?? [];
    list.push(node);
    columns.set(value, list);
  }

  const laidOut: LaidOutNode[] = [];
  let maxY = 0;
  const sortedColumns = [...columns.entries()].sort((left, right) => left[0] - right[0]);
  for (const [column, list] of sortedColumns) {
    list.sort((left, right) => {
      const byDelta = DELTA_ORDER[left.delta] - DELTA_ORDER[right.delta];
      return byDelta !== 0 ? byDelta : left.label.localeCompare(right.label);
    });
    list.forEach((node, index) => {
      const x = LEFT + column * (NODE_W + GAP_X);
      const y = TOP + index * (NODE_H + GAP_Y);
      laidOut.push({
        ...node,
        x,
        y,
        width: NODE_W,
        height: NODE_H,
        rowKey: level,
        scenarioId: '',
      });
      maxY = Math.max(maxY, y + NODE_H);
    });
  }

  const laidEdges: LaidOutEdge[] = [];
  const lanes = new Map<string, number>();
  for (const edge of edges) {
    const from = laidOut.find((node) => node.id === edge.from);
    const to = laidOut.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    const lane = lanes.get(edge.from) ?? 0;
    lanes.set(edge.from, lane + 1);
    const geometry = edgePath(from, to, lane);
    laidEdges.push({
      ...edge,
      ...geometry,
      pathId: `path-${level}-${edge.id}`,
      rowKey: level,
    });
  }

  const maxX = laidOut.reduce((value, node) => Math.max(value, node.x + node.width), 0);
  return {
    rows: [],
    nodes: laidOut,
    edges: laidEdges,
    width: Math.max(760, maxX + LEFT),
    height: Math.max(300, maxY + TOP + 24),
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  };
}

/** 文件层：函数先按文件聚合，再画文件之间的调用关系。 */
export function layoutFileGraph(graph: BehaviorGraph): BehaviorLayout {
  const fn = buildFunctionGraph(graph);
  const file = buildFileGraph(fn);
  return layoutDirected(file.nodes, file.edges, 'file');
}

/** 函数层：按调用关系分层布局；文件只作为节点附属信息，不决定列或顺序。 */
export function layoutFunctionGraph(graph: BehaviorGraph): BehaviorLayout {
  const fn = buildFunctionGraph(graph);
  const { laidOut, width, height, bottom } = layoutCallGraph(fn.nodes, fn.edges);
  const nodeById = new Map(laidOut.map((node) => [node.id, node]));

  const laidEdges: LaidOutEdge[] = [];
  const lanes = new Map<string, number>();
  const used = new Map<string, number>();
  for (const edge of fn.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const lane = lanes.get(edge.from) ?? 0;
    lanes.set(edge.from, lane + 1);
    const geometry = routeEdge(from, to, laidOut, width, height, used) ??
      edgePath(from, to, lane, bottom);
    laidEdges.push({
      ...edge,
      ...geometry,
      pathId: `path-function-${edge.id}`,
      rowKey: 'function',
    });
  }

  return {
    rows: [],
    nodes: laidOut,
    edges: laidEdges,
    width,
    height,
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  };
}

interface Point {
  x: number;
  y: number;
}

function portPoints(from: LaidOutNode, to: LaidOutNode): [Point, Point] {
  const dx = to.x + to.width / 2 - (from.x + from.width / 2);
  const dy = to.y + to.height / 2 - (from.y + from.height / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0
      ? [{ x: from.x + from.width, y: from.y + from.height / 2 }, { x: to.x, y: to.y + to.height / 2 }]
      : [{ x: from.x, y: from.y + from.height / 2 }, { x: to.x + to.width, y: to.y + to.height / 2 }];
  }
  return dy >= 0
    ? [{ x: from.x + from.width / 2, y: from.y + from.height }, { x: to.x + to.width / 2, y: to.y }]
    : [{ x: from.x + from.width / 2, y: from.y }, { x: to.x + to.width / 2, y: to.y + to.height }];
}

function simplifyPoints(points: Point[]): Point[] {
  const result: Point[] = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (last && Math.abs(last.x - point.x) < 0.5 && Math.abs(last.y - point.y) < 0.5) continue;
    result.push(point);
  }
  for (let index = 1; index < result.length - 1; index += 1) {
    const previous = result[index - 1];
    const current = result[index];
    const next = result[index + 1];
    const sameX = Math.abs(previous.x - current.x) < 0.5 && Math.abs(current.x - next.x) < 0.5;
    const sameY = Math.abs(previous.y - current.y) < 0.5 && Math.abs(current.y - next.y) < 0.5;
    if (sameX || sameY) result.splice(index, 1);
  }
  return result;
}

/** 用障碍物网格做正交寻路，避免边穿过卡片。 */
function routeEdge(
  from: LaidOutNode,
  to: LaidOutNode,
  nodes: LaidOutNode[],
  width: number,
  height: number,
  used: Map<string, number>,
): { path: string; labelX: number; labelY: number } | null {
  const cell = 6;
  const maxX = Math.max(width, ...nodes.map((node) => node.x + node.width + 40));
  const maxY = Math.max(height, ...nodes.map((node) => node.y + node.height + 40));
  const cols = Math.ceil(maxX / cell) + 1;
  const rows = Math.ceil(maxY / cell) + 1;
  const blocked = new Set<string>();
  const key = (x: number, y: number) => `${x},${y}`;

  for (const node of nodes) {
    if (node.id === from.id || node.id === to.id) continue;
    const left = Math.floor((node.x - 3) / cell);
    const right = Math.ceil((node.x + node.width + 3) / cell);
    const top = Math.floor((node.y - 3) / cell);
    const bottom = Math.ceil((node.y + node.height + 3) / cell);
    for (let gx = left; gx <= right; gx += 1) {
      for (let gy = top; gy <= bottom; gy += 1) {
        if (gx >= 0 && gy >= 0 && gx < cols && gy < rows) blocked.add(key(gx, gy));
      }
    }
  }

  const [startPort, endPort] = portPoints(from, to);
  const outward = (point: Point, node: LaidOutNode): Point => {
    const dx = point.x - (node.x + node.width / 2);
    const dy = point.y - (node.y + node.height / 2);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return { x: point.x + Math.sign(dx) * (cell + 2), y: point.y };
    }
    return { x: point.x, y: point.y + Math.sign(dy) * (cell + 2) };
  };
  const start = outward(startPort, from);
  const end = outward(endPort, to);
  let startX = Math.round(start.x / cell);
  let startY = Math.round(start.y / cell);
  let endX = Math.round(end.x / cell);
  let endY = Math.round(end.y / cell);
  const findFree = (x: number, y: number, towardX: number, towardY: number): [number, number] => {
    let nx = x;
    let ny = y;
    for (let tries = 0; tries < 10 && blocked.has(key(nx, ny)); tries += 1) {
      nx += Math.sign(towardX - nx) || 1;
      ny += Math.sign(towardY - ny) || 0;
    }
    return [nx, ny];
  };
  [startX, startY] = findFree(startX, startY, endX, endY);
  [endX, endY] = findFree(endX, endY, startX, startY);
  if (startX === endX && startY === endY) {
    return { path: `M ${start.x} ${start.y} L ${end.x} ${end.y}`, labelX: (start.x + end.x) / 2, labelY: (start.y + end.y) / 2 - 8 };
  }

  const total = cols * rows;
  const gScore = new Map<string, number>();
  const parents = new Map<string, string>();
  const open: Array<{ x: number; y: number; g: number; f: number }> = [];
  const startKey = key(startX, startY);
  gScore.set(startKey, 0);
  open.push({ x: startX, y: startY, g: 0, f: Math.abs(endX - startX) + Math.abs(endY - startY) });
  const directions = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let found: string | null = null;
  let guard = 0;

  while (open.length > 0 && guard < total * 4) {
    guard += 1;
    let bestIndex = 0;
    for (let index = 1; index < open.length; index += 1) {
      if (open[index].f < open[bestIndex].f) bestIndex = index;
    }
    const current = open.splice(bestIndex, 1)[0];
    const currentKey = key(current.x, current.y);
    if (current.x === endX && current.y === endY) {
      found = currentKey;
      break;
    }
    for (const [dx, dy] of directions) {
      const nx = current.x + dx;
      const ny = current.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nextKey = key(nx, ny);
      if (blocked.has(nextKey)) continue;
      const extra = used.get(nextKey) ?? 0;
      const nextG = current.g + 1 + extra * 0.45;
      if (nextG >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      gScore.set(nextKey, nextG);
      parents.set(nextKey, currentKey);
      open.push({ x: nx, y: ny, g: nextG, f: nextG + Math.abs(endX - nx) + Math.abs(endY - ny) });
    }
  }

  if (!found) return null;
  const gridPoints: Point[] = [];
  let cursor: string | undefined = found;
  while (cursor) {
    const [gx, gy] = cursor.split(',').map(Number);
    gridPoints.push({ x: gx * cell, y: gy * cell });
    cursor = parents.get(cursor);
    if (gridPoints.length > total) break;
  }
  gridPoints.reverse();
  const pathPoints = simplifyPoints([
    startPort,
    start,
    ...gridPoints,
    end,
    endPort,
  ]);
  let length = 0;
  for (let index = 1; index < pathPoints.length; index += 1) {
    length += Math.hypot(pathPoints[index].x - pathPoints[index - 1].x, pathPoints[index].y - pathPoints[index - 1].y);
  }
  let walked = 0;
  let label = pathPoints[0];
  for (let index = 1; index < pathPoints.length; index += 1) {
    const previous = pathPoints[index - 1];
    const current = pathPoints[index];
    const segment = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (walked + segment >= length / 2) {
      const ratio = segment === 0 ? 0 : (length / 2 - walked) / segment;
      label = { x: previous.x + (current.x - previous.x) * ratio, y: previous.y + (current.y - previous.y) * ratio };
      break;
    }
    walked += segment;
  }
  for (const point of pathPoints) {
    const gx = Math.round(point.x / cell);
    const gy = Math.round(point.y / cell);
    const mapKey = key(gx, gy);
    used.set(mapKey, (used.get(mapKey) ?? 0) + 1);
  }
  return {
    path: pathPoints.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' '),
    labelX: label.x,
    labelY: label.y - 7,
  };
}

/** 调用图：网格初始化 + 调用边弹簧；位置由关系决定，文件不再决定列和顺序。 */
function layoutCallGraph(
  nodes: PackedNode[],
  edges: PackedEdge[],
): { laidOut: LaidOutNode[]; width: number; height: number; bottom: number } {
  const columns = Math.max(1, Math.ceil(Math.sqrt(nodes.length)));
  const gapX = 300;
  const gapY = 142;
  const positions = new Map<string, { x: number; y: number }>();
  const startX = 80;
  const startY = 90;
  nodes.forEach((node, index) => {
    positions.set(node.id, {
      x: startX + (index % columns) * gapX,
      y: startY + Math.floor(index / columns) * gapY,
    });
  });

  const idSet = new Set(nodes.map((node) => node.id));
  const linked = edges.filter((edge) => idSet.has(edge.from) && idSet.has(edge.to));
  const ideal = 278;

  for (let iteration = 0; iteration < 140; iteration += 1) {
    const shifts = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
    for (const edge of linked) {
      const a = positions.get(edge.from)!;
      const b = positions.get(edge.to)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const force = (distance - ideal) * 0.055;
      const ux = dx / distance;
      const uy = dy / distance;
      shifts.get(edge.from)!.x += ux * force;
      shifts.get(edge.from)!.y += uy * force;
      shifts.get(edge.to)!.x -= ux * force;
      shifts.get(edge.to)!.y -= uy * force;
    }
    for (const node of nodes) {
      const point = positions.get(node.id)!;
      const shift = shifts.get(node.id)!;
      shift.x += (700 - point.x) * 0.012;
      shift.y += (430 - point.y) * 0.012;
      const length = Math.max(1, Math.hypot(shift.x, shift.y));
      const step = Math.min(6, length);
      point.x += (shift.x / length) * step;
      point.y += (shift.y / length) * step;
    }
    for (let pass = 0; pass < 2; pass += 1) {
      for (let left = 0; left < nodes.length; left += 1) {
        for (let right = left + 1; right < nodes.length; right += 1) {
          const a = positions.get(nodes[left].id)!;
          const b = positions.get(nodes[right].id)!;
          const overlapX = NODE_W + 38 - Math.abs(a.x - b.x);
          const overlapY = NODE_H + 28 - Math.abs(a.y - b.y);
          if (overlapX <= 0 || overlapY <= 0) continue;
          if (overlapX < overlapY) {
            const push = (overlapX / 2 + 1) * (a.x < b.x ? -1 : 1);
            a.x += push;
            b.x -= push;
          } else {
            const push = (overlapY / 2 + 1) * (a.y < b.y ? -1 : 1);
            a.y += push;
            b.y -= push;
          }
        }
      }
    }
  }

  const minX = Math.min(...nodes.map((node) => positions.get(node.id)!.x));
  const minY = Math.min(...nodes.map((node) => positions.get(node.id)!.y));
  for (const node of nodes) {
    const point = positions.get(node.id)!;
    point.x += LEFT - minX;
    point.y += TOP - minY;
  }

  const laidOut: LaidOutNode[] = nodes.map((node) => {
    const point = positions.get(node.id)!;
    return {
      ...node,
      x: point.x,
      y: point.y,
      width: NODE_W,
      height: NODE_H,
      rowKey: 'function',
      scenarioId: '',
    };
  });

  const maxX = Math.max(...laidOut.map((node) => node.x + node.width));
  const maxY = Math.max(...laidOut.map((node) => node.y + node.height));
  const bottom = maxY + 26;
  return {
    laidOut,
    width: Math.max(760, maxX + LEFT + 28),
    height: Math.max(320, bottom + 70),
    bottom,
  };
}
