import { categoryLabel, shapeLabel, sourceLabel } from './labels';
import type {
  DeltaKind,
  Fact,
  GraphEdge,
  GraphModel,
  GraphNode,
  LaidOutEdge,
  LaidOutGraph,
  LaidOutNode,
  Lane,
  Review,
  Side,
} from '../types';

interface Chain {
  id: string;
  sign: '+' | '-';
  fact: Fact;
  steps: string[];
  source: string;
  category: string;
  shape: string;
}

const NODE_WIDTH = 190;
const NODE_HEIGHT = 64;
const GAP_X = 76;
const GAP_Y = 52;
const LEFT = 38;
const TOP = 92;
const BOTTOM = 38;

function parseCall(title: string): [string, string] | null {
  const parts = title.split('→').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return [parts[0], parts[1]];
}

function locForFunction(review: Review, name: string): { file?: string; line?: number; side: Side } | undefined {
  // 函数节点优先落到声明；没有声明事实时退回到这条函数自己的证据行。
  // 顺序不能反：只按 logic 边找会随机挑到函数体内任意一处调用。
  for (const fact of review.project.added) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'after' };
  }
  for (const fact of review.project.removed) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'before' };
  }
  for (const fact of review.intent.added) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'after' };
  }
  for (const fact of review.intent.removed) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'before' };
  }
  for (const fact of review.logic.added) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'after' };
  }
  for (const fact of review.logic.removed) {
    if (fact.function === name && fact.file) return { file: fact.file, line: fact.line, side: 'before' };
  }
  for (const fact of review.intent.added) {
    if (fact.path?.includes(name) && fact.file) return { file: fact.file, line: fact.line, side: 'after' };
  }
  for (const fact of review.intent.removed) {
    if (fact.path?.includes(name) && fact.file) return { file: fact.file, line: fact.line, side: 'before' };
  }
  return undefined;
}

function buildCallers(review: Review): Map<string, string[]> {
  const callers = new Map<string, string[]>();
  const facts = [...review.logic.added, ...review.logic.removed];
  for (const fact of facts) {
    const call = parseCall(fact.title);
    if (!call) continue;
    const [from, to] = call;
    if (!/^[A-Za-z_]\w*$/.test(from) || !/^[A-Za-z_]\w*$/.test(to)) continue;
    const list = callers.get(to) ?? [];
    if (!list.includes(from)) list.push(from);
    callers.set(to, list);
  }
  return callers;
}

function createChains(review: Review): Chain[] {
  const callers = buildCallers(review);
  const allSteps = new Set<string>();
  const raw: Array<{ sign: '+' | '-'; fact: Fact; steps: string[] }> = [];

  const collect = (sign: '+' | '-', facts: Fact[]) => {
    for (const fact of facts) {
      const steps = [...(fact.path ?? [])].reverse();
      if (fact.function && steps[steps.length - 1] !== fact.function) steps.push(fact.function);
      raw.push({ sign, fact, steps });
      for (const step of steps) allSteps.add(step);
    }
  };
  collect('+', review.intent.added);
  collect('-', review.intent.removed);

  return raw.map((item, index) => {
    const steps = item.steps;
    // 意图链只覆盖到 sink 函数；用 logic 的调用边把 handleSearch 补到前面。
    for (let guard = 0; guard < 4 && steps.length > 0; guard++) {
      const first = steps[0];
      const candidates = (callers.get(first) ?? []).filter((caller) => !steps.includes(caller));
      if (!candidates.length) break;
      const preferred = candidates.find((caller) => allSteps.has(caller)) ?? candidates[0];
      steps.unshift(preferred);
    }
    return {
      id: `chain-${item.sign}-${index}`,
      sign: item.sign,
      fact: item.fact,
      steps,
      source: item.fact.source ?? 'unknown',
      category: item.fact.category ?? 'unknown',
      shape: item.fact.shape ?? 'unknown',
    };
  });
}

function addUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) list.push(value);
}

function finalDelta(signs: Set<string>): DeltaKind {
  // 同一个节点被新增链和移除链同时经过，说明它的行为改了：
  // handleSearch 这种入口函数本身没有增删，但下游数据流换了形态。
  if (signs.size === 2) return 'modified';
  return signs.has('+') ? 'added' : 'removed';
}

export function buildGraph(review: Review): GraphModel {
  const chains = createChains(review);
  if (!chains.length) {
    return { nodes: [], edges: [], entry: '', primarySource: '', cols: 0, rows: 0 };
  }

  const longest = [...chains].sort((a, b) => b.steps.length - a.steps.length)[0];
  const entry = longest.steps[0] ?? longest.fact.function ?? 'entry';
  const primary = chains.find((chain) => chain.steps[0] === entry) ?? chains[0];
  const primarySource = primary.source;

  const nodeMap = new Map<string, GraphNode>();
  const touchNode = (id: string, init: () => GraphNode): GraphNode => {
    const existing = nodeMap.get(id);
    if (existing) return existing;
    const node = init();
    nodeMap.set(id, node);
    return node;
  };

  const entryLoc = locForFunction(review, entry);
  const entryNode = touchNode(`fn:${entry}`, () => ({
    id: `fn:${entry}`,
    kind: 'function',
    label: entry,
    sub: 'net/http handler',
    delta: 'unchanged',
    col: 0,
    row: 1.5,
    file: entryLoc?.file,
    line: entryLoc?.line,
    side: entryLoc?.side,
    snippet: entry,
    chains: [],
    signs: new Set(),
    shapes: new Set(),
  }));

  const sourceNode = touchNode(`src:${primarySource}`, () => ({
    id: `src:${primarySource}`,
    kind: 'source',
    label: sourceLabel(primarySource),
    sub: primarySource,
    delta: 'unchanged',
    col: 0,
    row: 0.5,
    file: entryLoc?.file,
    line: entryLoc?.line,
    side: entryLoc?.side,
    snippet: primarySource,
    chains: [],
    signs: new Set(),
    shapes: new Set(),
  }));

  const branchRows = new Map<string, number>();
  let nextRow = 1;
  chains.forEach((chain) => {
    const branchKey = chain.steps.join('>');
    if (!branchRows.has(branchKey)) branchRows.set(branchKey, nextRow++);
    const row = branchRows.get(branchKey) ?? 1;
    addUnique(entryNode.chains, chain.id);
    entryNode.signs.add(chain.sign);
    addUnique(sourceNode.chains, chain.id);

    for (let stepIndex = 1; stepIndex < chain.steps.length; stepIndex++) {
      const name = chain.steps[stepIndex];
      const id = `fn:${name}`;
      const loc = locForFunction(review, name);
      const node = touchNode(id, () => ({
        id,
        kind: 'function',
        label: name,
        sub: '函数',
        delta: 'unchanged',
        col: stepIndex,
        row,
        file: loc?.file,
        line: loc?.line,
        side: loc?.side,
        snippet: name,
        chains: [],
        signs: new Set(),
        shapes: new Set(),
      }));
      addUnique(node.chains, chain.id);
      node.signs.add(chain.sign);
      node.col = Math.max(node.col, stepIndex);
    }

    const sinkId = `sink:${chain.category}`;
    const sinkCol = Math.max(1, chain.steps.length);
    const sink = touchNode(sinkId, () => ({
      id: sinkId,
      kind: 'sink',
      label: categoryLabel(chain.category),
      sub: shapeLabel(chain.shape),
      delta: 'unchanged',
      col: sinkCol,
      row,
      file: chain.fact.file,
      line: chain.fact.line,
      side: chain.sign === '+' ? 'after' : 'before',
      snippet: chain.fact.snippet ?? chain.fact.title,
      fact: chain.fact,
      chains: [],
      signs: new Set(),
      shapes: new Set(),
    }));
    addUnique(sink.chains, chain.id);
    sink.signs.add(chain.sign);
    sink.shapes.add(chain.shape);
    sink.col = Math.max(sink.col, sinkCol);
  });

  const rows = branchRows.size;
  const entryRow = (rows + 1) / 2;
  entryNode.row = entryRow;
  sourceNode.row = 0.5;

  const nodes = [...nodeMap.values()];
  for (const node of nodes) {
    node.delta = node.kind === 'source' ? 'unchanged' : finalDelta(node.signs);
    if (node.kind === 'sink') {
      const source = node.chains
        .map((id) => chains.find((chain) => chain.id === id)?.source)
        .find((value) => value && value !== primarySource);
      const shapes = [...node.shapes].map(shapeLabel).join(' / ');
      node.sub = source ? `${shapes} · ${source}` : shapes;
    }
  }

  const edgeMap = new Map<string, GraphEdge>();
  const pushEdge = (
    id: string,
    from: string,
    to: string,
    chain: Chain,
    options: { last: boolean },
  ) => {
    const existing = edgeMap.get(id);
    const shape = options.last ? chain.shape : undefined;
    const source = options.last && chain.source !== primarySource ? chain.source : undefined;
    const label = options.last ? (source ? `${chain.shape} · ${source}` : chain.shape) : '调用';
    if (existing) {
      existing.signs.add(chain.sign);
      addUnique(existing.chains, chain.id);
      if (!existing.fact) existing.fact = chain.fact;
      return;
    }
    edgeMap.set(id, {
      id,
      from,
      to,
      delta: 'unchanged',
      label,
      shape,
      source,
      hero: false,
      fact: chain.fact,
      file: chain.fact.file,
      line: chain.fact.line,
      side: chain.sign === '+' ? 'after' : 'before',
      snippet: chain.fact.snippet ?? chain.fact.title,
      chains: [chain.id],
      signs: new Set([chain.sign]),
    });
  };

  const sourceEdgeId = `${sourceNode.id}>${entryNode.id}`;
  edgeMap.set(sourceEdgeId, {
    id: sourceEdgeId,
    from: sourceNode.id,
    to: entryNode.id,
    delta: 'unchanged',
    label: '请求',
    hero: false,
    file: entryLoc?.file,
    line: entryLoc?.line,
    side: entryLoc?.side,
    snippet: entry,
    chains: [],
    signs: new Set(),
  });

  for (const chain of chains) {
    const keys = [entry, ...chain.steps.slice(1), `sink:${chain.category}`];
    for (let index = 0; index < keys.length - 1; index++) {
      const fromKey = index === 0 ? `fn:${keys[0]}` : (index === keys.length - 2 ? `fn:${keys[keys.length - 2]}` : `fn:${keys[index]}`);
      const toKey = index === keys.length - 2 ? `sink:${chain.category}` : `fn:${keys[index + 1]}`;
      const last = index === keys.length - 2;
      if (index === 0 && chain.steps[0] !== entry) {
        // 该链的入口不是主入口；仍画出来，但不伪造主入口到它的调用边。
        continue;
      }
      const id = last
        ? `${fromKey}>${toKey}|${chain.shape}|${chain.source}`
        : `${fromKey}>${toKey}`;
      pushEdge(id, fromKey, toKey, chain, { last });
    }
  }

  const edges = [...edgeMap.values()];
  for (const edge of edges) {
    if (edge.signs.size === 2) {
      // 改动前后的调用边都经过这里：调用本身没变，但它的下游变了。
      edge.delta = 'modified';
      edge.fact = undefined;
    } else if (edge.signs.size === 0) {
      edge.delta = 'unchanged';
    } else {
      edge.delta = edge.signs.has('+') ? 'added' : 'removed';
    }
    edge.hero = edge.delta === 'added' && edge.to.startsWith('sink:');
  }

  return {
    nodes,
    edges,
    entry,
    primarySource,
    cols: Math.max(...nodes.map((node) => node.col + 1), 1),
    rows,
  };
}

export function layoutGraph(model: GraphModel): LaidOutGraph {
  if (!model.nodes.length) {
    return { nodes: [], edges: [], lanes: [], width: 0, height: 0, nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT };
  }

  const cols = Math.max(model.cols, 1);
  const rows = Math.max(model.rows, 1);
  const width = LEFT * 2 + cols * NODE_WIDTH + (cols - 1) * GAP_X;
  const height = TOP + (rows + 1) * (NODE_HEIGHT + GAP_Y) + BOTTOM - GAP_Y;

  const nodes: LaidOutNode[] = model.nodes.map((node) => ({
    ...node,
    x: LEFT + node.col * (NODE_WIDTH + GAP_X),
    y: TOP + node.row * (NODE_HEIGHT + GAP_Y),
    width: NODE_WIDTH,
    height: NODE_HEIGHT,
  }));
  const byId = new Map(nodes.map((node) => [node.id, node]));

  const lanes: Lane[] = [];
  const laneTop = 44;
  const laneHeight = height - laneTop - 18;
  const laneFor = (label: string, fromCol: number, toCol: number) => {
    const start = LEFT + fromCol * (NODE_WIDTH + GAP_X) - 18;
    const end = LEFT + toCol * (NODE_WIDTH + GAP_X) + NODE_WIDTH + 18;
    lanes.push({ label, x: start, width: end - start, y: laneTop, height: laneHeight });
  };
  laneFor('入口', 0, 0);
  if (cols > 2) laneFor('处理链', 1, cols - 2);
  laneFor('副作用', cols - 1, cols - 1);

  const parallel = new Map<string, number>();
  for (const edge of model.edges) {
    const key = `${edge.from}>${edge.to}`;
    parallel.set(key, (parallel.get(key) ?? 0) + 1);
  }
  const parallelIndex = new Map<string, number>();
  const edges: LaidOutEdge[] = [];

  model.edges.forEach((edge, index) => {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) return;

    const key = `${edge.from}>${edge.to}`;
    const total = parallel.get(key) ?? 1;
    const slot = parallelIndex.get(key) ?? 0;
    parallelIndex.set(key, slot + 1);
    const offset = (slot - (total - 1) / 2) * 28;

    let path = '';
    let labelX = 0;
    let labelY = 0;

    if (from.col === to.col) {
      const x = from.x + from.width / 2;
      const y1 = from.y + from.height;
      const y2 = to.y;
      path = `M ${x} ${y1} L ${x} ${y2}`;
      labelX = x + 8;
      labelY = (y1 + y2) / 2;
    } else {
      const x1 = from.x + from.width;
      const y1 = from.y + from.height / 2;
      const x2 = to.x;
      const y2 = to.y + to.height / 2;
      const dx = Math.max(46, (x2 - x1) * 0.46);
      path = `M ${x1} ${y1} C ${x1 + dx} ${y1 + offset}, ${x2 - dx} ${y2 + offset}, ${x2} ${y2}`;
      labelX = (x1 + x2) / 2;
      labelY = (y1 + y2) / 2 - 10;
      if (total > 1) {
        // 平行边（同一对节点上的新增/移除链路）标签必须错开，
        // 否则 format 与 direct 会叠在同一处。
        labelX += slot === 0 ? -8 : 8;
        labelY = (y1 + y2) / 2 + (slot === 0 ? -28 : 28);
      }
    }

    edges.push({
      ...edge,
      path,
      labelX,
      labelY,
      pathId: `graph-edge-${index}`,
    });
  });

  return { nodes, edges, lanes, width, height, nodeWidth: NODE_WIDTH, nodeHeight: NODE_HEIGHT };
}
