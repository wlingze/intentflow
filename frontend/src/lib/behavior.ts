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

const DELTA_ORDER: Record<DeltaKind, number> = {
  modified: 0,
  added: 1,
  removed: 2,
  unchanged: 3,
};

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
  const scenarios = [...graph.scenarios].sort((left, right) => {
    const byTitle = left.title.localeCompare(right.title);
    if (byTitle !== 0) return byTitle;
    return DELTA_ORDER[left.delta] - DELTA_ORDER[right.delta];
  });

  const maxNodes = Math.max(...scenarios.map((scenario) => scenario.nodes.length), 1);
  const width = Math.max(760, LEFT * 2 + maxNodes * NODE_WIDTH + Math.max(0, maxNodes - 1) * GAP_X);
  const rows: BehaviorRow[] = [];
  const allNodes: LaidOutNode[] = [];
  const allEdges: LaidOutEdge[] = [];
  let y = TOP;

  scenarios.forEach((scenario, index) => {
    const ids = scenario.nodes.filter((id) => base.has(id));
    const rowKey = scenario.id;
    const rowY = y + HEADER;
    const nodes: LaidOutNode[] = ids.map((id, slot) => {
      const node = base.get(id)!;
      // 每行按自己的步骤数从左往右排；短链路不再被拉到全局最右列。
      const x = LEFT + slot * (NODE_WIDTH + GAP_X);
      return {
        ...node,
        x,
        y: rowY,
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
        rowKey,
        scenarioId: scenario.id,
      };
    });
    const byId = new Map(nodes.map((node) => [node.id, node]));

    const edges: LaidOutEdge[] = [];
    const scenarioEdges = graph.edges.filter((edge) => edge.scenario === scenario.id);
    const controls = scenarioEdges.filter((edge) => edge.kind === 'control');
    // 调用边与判定路径同时存在时，只画判定路径。调用边保留在数据里，
    // 但不让它绕过判定卡片，造成「守卫被跳过」的错觉。
    const visibleEdges = scenarioEdges.filter(
      (edge) =>
        edge.kind !== 'call' ||
        !controls.some((control) => control.from === edge.from || control.to === edge.to),
    );
    visibleEdges
      .forEach((edge, edgeIndex) => {
        const from = byId.get(edge.from);
        const to = byId.get(edge.to);
        if (!from || !to) return;
        edges.push(layEdge(edge, from, to, rowKey, edgeIndex));
      });

    const row: BehaviorRow = {
      id: scenario.id,
      index,
      title: scenario.title,
      delta: scenario.delta,
      source: scenario.source,
      shape: scenario.shape,
      category: scenario.category,
      x: LEFT,
      y,
      width,
      height: HEADER + NODE_HEIGHT + ARC,
      nodes,
      edges,
    };
    rows.push(row);
    allNodes.push(...nodes);
    allEdges.push(...edges);
    y += row.height + ROW_GAP;
  });

  return {
    rows,
    nodes: allNodes,
    edges: allEdges,
    width,
    height: Math.max(y + 18, 260),
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  };
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
