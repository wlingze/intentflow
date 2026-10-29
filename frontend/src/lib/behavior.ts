import type {
  BehaviorEdge,
  BehaviorGraph,
  BehaviorNode,
  BehaviorRole,
  BehaviorLayout,
  LaidOutEdge,
  LaidOutNode,
} from '../types';

const NODE_WIDTH = 176;
const NODE_HEIGHT = 78;
const GAP_X = 50;
const GAP_Y = 36;
const LEFT = 28;
const TOP = 54;
const BOTTOM = 24;

const ROLE_ORDER: Record<BehaviorRole, number> = {
  trigger: 0,
  decision: 1,
  transform: 2,
  effect: 3,
};

function nodeOrder(node: BehaviorNode, graph: BehaviorGraph): number {
  const index = graph.scenarios.findIndex((scenario) => scenario.nodes.includes(node.id));
  return index === -1 ? graph.scenarios.length : index;
}

export function layoutBehavior(graph: BehaviorGraph): BehaviorLayout {
  if (!graph.nodes.length) {
    return {
      nodes: [],
      edges: [],
      width: 0,
      height: 0,
      stageCount: 0,
      nodeWidth: NODE_WIDTH,
      nodeHeight: NODE_HEIGHT,
    };
  }

  const stages = Math.max(graph.stageCount, 1);
  const columns = new Map<number, BehaviorNode[]>();
  for (const node of graph.nodes) {
    const stage = Math.max(0, Math.min(stages - 1, node.stage));
    const list = columns.get(stage) ?? [];
    list.push(node);
    columns.set(stage, list);
  }
  for (const list of columns.values()) {
    list.sort((a, b) => {
      const byScenario = nodeOrder(a, graph) - nodeOrder(b, graph);
      if (byScenario !== 0) return byScenario;
      const byRole = ROLE_ORDER[a.role] - ROLE_ORDER[b.role];
      if (byRole !== 0) return byRole;
      return a.label.localeCompare(b.label);
    });
  }

  let tallest = 0;
  for (const list of columns.values()) {
    const height = list.length * NODE_HEIGHT + Math.max(0, list.length - 1) * GAP_Y;
    tallest = Math.max(tallest, height);
  }
  const height = TOP + tallest + BOTTOM;
  const width = LEFT * 2 + stages * NODE_WIDTH + Math.max(0, stages - 1) * GAP_X;

  const nodes: LaidOutNode[] = [];
  for (const [stage, list] of columns) {
    const columnHeight = list.length * NODE_HEIGHT + Math.max(0, list.length - 1) * GAP_Y;
    const startY = TOP + (tallest - columnHeight) / 2;
    list.forEach((node, index) => {
      nodes.push({
        ...node,
        x: LEFT + stage * (NODE_WIDTH + GAP_X),
        y: startY + index * (NODE_HEIGHT + GAP_Y),
        width: NODE_WIDTH,
        height: NODE_HEIGHT,
      });
    });
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const parallel = new Map<string, number>();
  for (const edge of graph.edges) {
    const key = `${edge.from}>${edge.to}`;
    parallel.set(key, (parallel.get(key) ?? 0) + 1);
  }
  const slot = new Map<string, number>();
  const edges: LaidOutEdge[] = [];

  graph.edges.forEach((edge, index) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return;

    const key = `${edge.from}>${edge.to}`;
    const total = parallel.get(key) ?? 1;
    const current = slot.get(key) ?? 0;
    slot.set(key, current + 1);
    const offset = (current - (total - 1) / 2) * 24;

    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2;
    const x2 = to.x;
    const y2 = to.y + to.height / 2;

    let path: string;
    let labelX = (x1 + x2) / 2;
    let labelY = (y1 + y2) / 2 - 9 + offset;
    if (x2 <= x1) {
      const midX = Math.max(x1, x2) + 38;
      path = `M ${x1} ${y1} C ${midX} ${y1 + offset}, ${midX} ${y2 + offset}, ${x2} ${y2}`;
      labelX = midX;
    } else {
      const dx = Math.max(54, (x2 - x1) * 0.46);
      path = `M ${x1} ${y1} C ${x1 + dx} ${y1 + offset}, ${x2 - dx} ${y2 + offset}, ${x2} ${y2}`;
    }

    edges.push({
      ...edge,
      path,
      labelX,
      labelY,
      pathId: `behavior-edge-${index}`,
    });
  });

  return {
    nodes,
    edges,
    width,
    height,
    stageCount: stages,
    nodeWidth: NODE_WIDTH,
    nodeHeight: NODE_HEIGHT,
  };
}

export function stageLabels(graph: BehaviorGraph): string[] {
  const labels: string[] = [];
  for (let stage = 0; stage < Math.max(graph.stageCount, 1); stage += 1) {
    const roles = new Set(graph.nodes.filter((node) => node.stage === stage).map((node) => node.role));
    if (roles.size === 0) {
      labels.push('');
    } else if (roles.size === 1) {
      labels.push(roleLabel([...roles][0]));
    } else {
      labels.push([...roles].map(roleLabel).join(' / '));
    }
  }
  return labels;
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
  if (edge.kind === 'data') {
    return edge.label || '数据';
  }
  if (edge.kind === 'control') {
    return edge.label || '控制';
  }
  return edge.label || '调用';
}
