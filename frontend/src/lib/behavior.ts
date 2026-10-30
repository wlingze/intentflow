import type {
  BehaviorEdge,
  BehaviorGraph,
  BehaviorNode,
  BehaviorRole,
  BehaviorRow,
  BehaviorLayout,
  DeltaKind,
  LaidOutEdge,
  LaidOutNode,
} from '../types';

const NODE_WIDTH = 168;
const NODE_HEIGHT = 74;
const GAP_X = 46;
const LEFT = 26;
const TOP = 42;
const ROW_GAP = 34;
const HEADER = 34;
const ARC = 42;

function nodeMap(graph: BehaviorGraph): Map<string, BehaviorNode> {
  return new Map(graph.nodes.map((node) => [node.id, node]));
}

/**
 * 每条 scenario 独占一行。行内按 scenario.nodes 排步骤，效果贴到右边界。
 * 不同行之间不画边，所以一条行为的判定不会连到另一条行为的步骤。
 */
export function layoutBehavior(graph: BehaviorGraph): BehaviorLayout {
  if (!graph.nodes.length || !graph.scenarios.length) {
    return { rows: [], nodes: [], edges: [], width: 0, height: 0, nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT };
  }

  const base = nodeMap(graph);
  const groups = new Map<string, {
    trigger: string;
    scenarios: typeof graph.scenarios;
    nodeIds: string[];
    edgeKeys: Set<string>;
    nodes: BehaviorNode[];
    edges: BehaviorEdge[];
  }>();

  for (const scenario of graph.scenarios) {
    const group = groups.get(scenario.trigger) ?? {
      trigger: scenario.trigger,
      scenarios: [],
      nodeIds: [],
      edgeKeys: new Set<string>(),
      nodes: [],
      edges: [],
    };
    group.scenarios.push(scenario);
    for (const id of scenario.nodes) {
      if (!group.nodeIds.includes(id)) {
        const node = base.get(id);
        if (node) {
          group.nodeIds.push(id);
          group.nodes.push(node);
        }
      }
    }
    for (const edge of graph.edges.filter((item) => item.scenario === scenario.id)) {
      const key = `${edge.from}>${edge.to}:${edge.kind}`;
      if (!group.edgeKeys.has(key)) {
        group.edgeKeys.add(key);
        group.edges.push(edge);
      }
    }
    groups.set(scenario.trigger, group);
  }

  const ordered = [...groups.values()].sort((left, right) => {
    const leftNode = base.get(left.trigger);
    const rightNode = base.get(right.trigger);
    const byTitle = (leftNode?.label ?? left.trigger).localeCompare(rightNode?.label ?? right.trigger);
    if (byTitle !== 0) return byTitle;
    return mergeDelta(left.scenarios.map((item) => item.delta)) <
      mergeDelta(right.scenarios.map((item) => item.delta)) ? -1 : 1;
  });

  const rows: BehaviorRow[] = [];
  const allNodes: LaidOutNode[] = [];
  const allEdges: LaidOutEdge[] = [];
  let y = TOP;

  ordered.forEach((group, index) => {
    const triggerNode = base.get(group.trigger);
    const nodes = orderGroupNodes(group.nodes, group.edges);
    const rowKey = `group:${group.trigger}`;
    const rowY = y + HEADER;
    const laidOut = nodes.map((node, slot) => ({
      ...node,
      x: LEFT + slot * (NODE_WIDTH + GAP_X),
      y: rowY,
      width: NODE_WIDTH,
      height: NODE_HEIGHT,
      rowKey,
      scenarioId: rowKey,
    }));
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const controls = group.edges.filter((edge) => edge.kind === 'control');
    const visibleEdges = group.edges.filter(
      (edge) =>
        edge.kind !== 'call' ||
        !controls.some((control) => control.from === edge.from || control.to === edge.to),
    );
    const edges: LaidOutEdge[] = [];
    visibleEdges.forEach((edge, edgeIndex) => {
      const from = byId.get(edge.from);
      const to = byId.get(edge.to);
      if (!from || !to) return;
      edges.push(layEdge(edge, from, to, rowKey, edgeIndex));
    });

    const delta = mergeDelta(group.scenarios.map((scenario) => scenario.delta));
    const sources = unique(group.scenarios.map((scenario) => scenario.source).filter(Boolean));
    const shapes = unique(group.scenarios.map((scenario) => scenario.shape).filter(Boolean));
    const row: BehaviorRow = {
      id: rowKey,
      index,
      title: `${triggerNode?.label ?? group.trigger} · ${group.scenarios.length} 条行为`,
      delta,
      source: sources.join(' / '),
      shape: shapes.join(' / '),
      category: unique(group.scenarios.map((scenario) => scenario.category).filter(Boolean)).join(' / '),
      x: LEFT,
      y,
      width: Math.max(
        760,
        LEFT * 2 + laidOut.length * NODE_WIDTH + Math.max(0, laidOut.length - 1) * GAP_X,
      ),
      height: HEADER + NODE_HEIGHT + ARC,
      nodes: laidOut,
      edges,
    };
    rows.push(row);
    allNodes.push(...laidOut);
    allEdges.push(...edges);
    y += row.height + ROW_GAP;
  });

  return {
    rows,
    nodes: allNodes,
    edges: allEdges,
    width: Math.max(760, ...rows.map((row) => row.width)),
    height: Math.max(y + 18, 260),
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  };
}

function mergeDelta(values: DeltaKind[]): DeltaKind {
  const set = new Set(values);
  if (set.size === 0) return 'unchanged';
  if (set.size === 1) return values[0];
  return 'modified';
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function orderGroupNodes(nodes: BehaviorNode[], edges: BehaviorEdge[]): BehaviorNode[] {
  const ids = new Set(nodes.map((node) => node.id));
  const depth = new Map<string, number>();
  for (const node of nodes) depth.set(node.id, node.role === 'trigger' ? 0 : 0);
  for (let pass = 0; pass < nodes.length + 1; pass += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) continue;
      const from = depth.get(edge.from) ?? 0;
      const to = depth.get(edge.to) ?? 0;
      if (to < from + 1) {
        depth.set(edge.to, from + 1);
        changed = true;
      }
    }
    if (!changed) break;
  }
  const maxDepth = Math.max(0, ...nodes.map((node) => depth.get(node.id) ?? 0));
  const roleOrder: Record<string, number> = { trigger: 0, decision: 1, transform: 2, effect: 3 };
  return [...nodes].sort((left, right) => {
    const leftDepth = left.role === 'effect' ? maxDepth + 1 : depth.get(left.id) ?? 0;
    const rightDepth = right.role === 'effect' ? maxDepth + 1 : depth.get(right.id) ?? 0;
    if (leftDepth !== rightDepth) return leftDepth - rightDepth;
    const byRole = (roleOrder[left.role] ?? 9) - (roleOrder[right.role] ?? 9);
    return byRole !== 0 ? byRole : left.label.localeCompare(right.label);
  });
}

function layEdge(
  edge: BehaviorEdge,
  from: LaidOutNode,
  to: LaidOutNode,
  rowKey: string,
  index: number,
): LaidOutEdge {
  const x1 = from.x + from.width;
  const y1 = from.y + from.height / 2;
  const x2 = to.x;
  const y2 = to.y + to.height / 2;
  const sameRow = Math.abs(y1 - y2) < 2;
  const skipsNode = x2 - (from.x + from.width) > 180;
  let path: string;
  let labelX = (x1 + x2) / 2;
  let labelY = (y1 + y2) / 2 - 7;

  if (sameRow && skipsNode) {
    // 数据边跨过判定节点时从下方绕行，避免被判定卡片遮住。
    const arcY = from.y + from.height + 26;
    path = `M ${x1} ${y1} C ${x1 + 42} ${arcY}, ${x2 - 42} ${arcY}, ${x2} ${y2}`;
    labelY = arcY + 2;
  } else if (sameRow) {
    path = `M ${x1} ${y1} C ${x1 + 24} ${y1}, ${x2 - 24} ${y2}, ${x2} ${y2}`;
  } else {
    const midX = (x1 + x2) / 2;
    path = `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
    labelX = midX;
  }
  return { ...edge, path, labelX, labelY, pathId: `edge-${rowKey}-${index}`, rowKey };
}

export function roleLabel(role: BehaviorRole): string {
  switch (role) {
    case 'trigger':
      return '触发';
    case 'decision':
      return '判定';
    case 'transform':
      return '变换';
    case 'effect':
      return '效果';
  }
}

export function edgeLabel(edge: BehaviorEdge): string {
  if (edge.kind === 'data') return edge.label || '数据';
  if (edge.kind === 'control') return edge.label || '控制';
  return edge.label || '调用';
}
