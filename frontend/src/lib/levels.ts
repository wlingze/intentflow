import type {
  BehaviorEdge,
  BehaviorGraph,
  BehaviorNode,
  BehaviorRole,
  BehaviorLayout,
  DeltaKind,
  GraphGroup,
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

const GROUP_PAD = 14;
const GROUP_HEAD = 34;
const GROUP_W = NODE_W + GROUP_PAD * 2;
const GROUP_GAP = 24;

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
  }

  const edgeMap = new Map<string, PackedEdge>();
  for (const edge of graph.edges) {
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

function edgePath(from: LaidOutNode, to: LaidOutNode): { path: string; labelX: number; labelY: number } {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const bend = Math.max(34, Math.abs(x2 - x1) * 0.38);
  return {
    path: `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`,
    labelX: (x1 + x2) / 2,
    labelY: (y1 + y2) / 2 - 7,
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
  for (const edge of edges) {
    const from = laidOut.find((node) => node.id === edge.from);
    const to = laidOut.find((node) => node.id === edge.to);
    if (!from || !to) continue;
    const geometry = edgePath(from, to);
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

/** 函数层：函数节点按文件分组成列；保留函数之间的调用/数据关系。 */
export function layoutFunctionGraph(graph: BehaviorGraph): BehaviorLayout {
  const fn = buildFunctionGraph(graph);
  const groupsByFile = new Map<string, PackedNode[]>();
  for (const node of fn.nodes) {
    const key = fileKey(node);
    const list = groupsByFile.get(key) ?? [];
    list.push(node);
    groupsByFile.set(key, list);
  }

  const ordered = [...groupsByFile.entries()].sort((left, right) => {
    const byDelta = DELTA_ORDER[mergeDelta(left[1].map((node) => node.delta))] -
      DELTA_ORDER[mergeDelta(right[1].map((node) => node.delta))];
    return byDelta !== 0 ? byDelta : left[0].localeCompare(right[0]);
  });

  const groups: GraphGroup[] = [];
  const laidOut: LaidOutNode[] = [];
  const nodeById = new Map<string, LaidOutNode>();
  let x = LEFT;
  let maxHeight = 0;

  for (const [file, list] of ordered) {
    list.sort((left, right) => {
      const byRole = ROLE_ORDER[left.role] - ROLE_ORDER[right.role];
      return byRole !== 0 ? byRole : left.label.localeCompare(right.label);
    });
    const height = GROUP_HEAD + list.length * NODE_H + Math.max(0, list.length - 1) * GAP_Y + GROUP_PAD;
    const delta = mergeDelta(list.map((node) => node.delta));
    groups.push({
      id: `group:${file}`,
      label: baseName(file),
      file,
      x,
      y: TOP,
      width: GROUP_W,
      height,
      count: list.length,
      delta,
    });
    list.forEach((node, index) => {
      const laid: LaidOutNode = {
        ...node,
        x: x + GROUP_PAD,
        y: TOP + GROUP_HEAD + index * (NODE_H + GAP_Y),
        width: NODE_W,
        height: NODE_H,
        rowKey: 'function',
        scenarioId: '',
      };
      nodeById.set(node.id, laid);
      laidOut.push(laid);
    });
    x += GROUP_W + GROUP_GAP;
    maxHeight = Math.max(maxHeight, TOP + height);
  }

  const laidEdges: LaidOutEdge[] = [];
  for (const edge of fn.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from || !to) continue;
    const geometry = edgePath(from, to);
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
    groups,
    width: Math.max(760, x + LEFT - GROUP_GAP),
    height: Math.max(300, maxHeight + 24),
    nodeWidth: NODE_W,
    nodeHeight: NODE_H,
  };
}
