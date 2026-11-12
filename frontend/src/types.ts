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
export type AISummary = Schemas['AiSummary'];
export type AIRisk = Schemas['AiRisk'];
export type Review = Schemas['Review'];
export type CodeFile = Schemas['CodeFile'];
export type CodeBundle = Schemas['CodeBundle'];
export type Payload = Schemas['Payload'];
export type Quote = Schemas['Quote'];
export type Comment = Schemas['Comment'];
export type ReviewState = Schemas['ReviewState'];
export type Comparison = Schemas['Comparison'];
export type ComparisonMode = Schemas['ComparisonMode'];
export type Commit = Schemas['Commit'];
export type CommitList = Schemas['CommitList'];
export type SymbolGraph = Schemas['SymbolGraph'];
export type SymbolNode = Schemas['SymbolNode'];
export type SymbolEdge = Schemas['SymbolEdge'];
export type SymbolRef = Schemas['SymbolRef'];
export type SymbolStats = Schemas['SymbolStats'];
export type ScanState = Schemas['ScanState'];
export type ScanResponse = Schemas['ScanResponse'];
export type Finding = Schemas['Finding'];
export type Revision = Schemas['Revision'];
export type RevisionList = Schemas['RevisionList'];
export type ReviewSession = Schemas['ReviewSession'];
export type ReviewContext = Schemas['ReviewContext'];
export type ReviewDraft = Schemas['ReviewDraft'];
export type ReviewDraftList = Schemas['ReviewDraftList'];
export type RestoreResult = Schemas['RestoreResult'];

export interface PersistedReview {
  comments: Comment[];
  dismissed: string[];
  kept: string[];
}

export type DiffLayout = 'split' | 'unified';
export type CodeMode = 'diff' | 'search';
