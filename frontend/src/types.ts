import type { components } from './api/schema.gen';

type Schemas = components['schemas'];

export type Confidence = Schemas['Confidence'];
export type Layer = Schemas['Layer'];
export type Severity = Schemas['Severity'];
export type DeltaKind = Schemas['DeltaKind'];
export type CodeStatus = Schemas['CodeStatus'];
export type BehaviorRole = Schemas['BehaviorRole'];
export type BehaviorEdgeKind = Schemas['BehaviorEdgeKind'];
export type Side = Schemas['Side'];

export type Fact = Schemas['Fact'];
export type Delta = Schemas['Delta'];
export type Signal = Schemas['Signal'];
export type BehaviorNode = Schemas['BehaviorNode'];
export type BehaviorEdge = Schemas['BehaviorEdge'];
export type BehaviorScenario = Schemas['BehaviorScenario'];
export type BehaviorLane = Schemas['BehaviorLane'];
export type BehaviorStats = Schemas['BehaviorStats'];
export type BehaviorGraph = Schemas['BehaviorGraph'];
export type AISummary = Schemas['AiSummary'];
export type AIRisk = Schemas['AiRisk'];
export type Review = Schemas['Review'];
export type CodeFile = Schemas['CodeFile'];
export type CodeBundle = Schemas['CodeBundle'];
export type Payload = Schemas['Payload'];
export type Quote = Schemas['Quote'];
export type Comment = Schemas['Comment'];
export type ReviewState = Schemas['ReviewState'];

export interface PersistedReview {
  comments: Comment[];
  dismissed: string[];
  kept: string[];
}

export type ViewMode = 'graph' | 'code';
export type DiffLayout = 'split' | 'unified';
export type CodeMode = 'diff' | 'search';

export interface Selection {
  kind: 'node' | 'edge';
  id: string;
}

export interface LaidOutNode extends BehaviorNode {
  x: number;
  y: number;
  width: number;
  height: number;
  rowKey: string;
  scenarioId: string;
}

export interface LaidOutEdge extends BehaviorEdge {
  path: string;
  labelX: number;
  labelY: number;
  pathId: string;
  rowKey: string;
}

export interface BehaviorRow {
  id: string;
  index: number;
  title: string;
  delta: DeltaKind;
  source: string;
  shape: string;
  category: string;
  x: number;
  y: number;
  width: number;
  height: number;
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
}

export interface BehaviorLayout {
  rows: BehaviorRow[];
  nodes: LaidOutNode[];
  edges: LaidOutEdge[];
  width: number;
  height: number;
  nodeWidth: number;
  nodeHeight: number;
}
