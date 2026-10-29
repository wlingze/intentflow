export type Confidence = 'EXTRACTED' | 'DERIVED' | 'INFERRED' | 'ASSERTED' | 'UNKNOWN';
export type Layer = 'project' | 'logic' | 'intent';
export type Severity = 'info' | 'warn' | 'high';
export type Side = 'before' | 'after';
export type DeltaKind = 'added' | 'removed' | 'modified' | 'unchanged';
export type CodeStatus = 'added' | 'removed' | 'modified' | 'unchanged';

export interface Fact {
  identity: string;
  layer: Layer;
  kind: string;
  title: string;
  detail?: string;
  file?: string;
  line?: number;
  function?: string;
  confidence: Confidence;
  path?: string[];
  source?: string;
  category?: string;
  shape?: string;
  snippet?: string;
}

export interface Delta {
  added: Fact[];
  removed: Fact[];
}

export interface Signal {
  id: string;
  severity: Severity;
  title: string;
  detail?: string;
  evidence: string[];
  confidence: Confidence;
}

export interface Review {
  before: string;
  after: string;
  project: Delta;
  logic: Delta;
  intent: Delta;
  signals?: Signal[];
  notes?: string[];
}

export interface CodeFile {
  path: string;
  status: CodeStatus;
  language?: string;
  before?: string;
  after?: string;
}

export interface CodeBundle {
  root: string;
  files: CodeFile[];
  truncated?: boolean;
}

export interface Payload {
  review: Review;
  code: CodeBundle;
}

export interface Quote {
  file: string;
  side: Side;
  start: number;
  end: number;
  snippet: string;
}

export interface Comment {
  id: string;
  text: string;
  quote?: Quote;
  source: 'manual' | 'signal';
  signalId?: string;
  title?: string;
  createdAt: number;
}

export interface PersistedReview {
  comments: Comment[];
  dismissed: string[];
  kept: string[];
}

export interface GraphNode {
  id: string;
  kind: 'source' | 'function' | 'sink';
  label: string;
  sub: string;
  delta: DeltaKind;
  col: number;
  row: number;
  file?: string;
  line?: number;
  side?: Side;
  snippet?: string;
  fact?: Fact;
  chains: string[];
  signs: Set<string>;
  shapes: Set<string>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  delta: DeltaKind;
  label: string;
  shape?: string;
  source?: string;
  hero: boolean;
  fact?: Fact;
  file?: string;
  line?: number;
  side?: Side;
  snippet?: string;
  chains: string[];
  signs: Set<string>;
}

export interface GraphModel {
  nodes: GraphNode[];
  edges: GraphEdge[];
  entry: string;
  primarySource: string;
  cols: number;
  rows: number;
}

export interface LaidOutNode extends GraphNode {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LaidOutEdge extends GraphEdge {
  path: string;
  labelX: number;
  labelY: number;
  pathId: string;
}

export interface Lane {
  label: string;
  x: number;
  width: number;
  y: number;
  height: number;
}

export interface LaidOutGraph {
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  lanes: Lane[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
}
