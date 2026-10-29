import { useMemo } from 'react';
import { diffLines, diffStats, type DiffStats } from '../lib/diff';
import type { CodeFile, Fact, Review, Signal } from '../types';
import { useApp } from './AppProvider';

export function buildFactMap(review: Review): Map<string, Fact> {
  const map = new Map<string, Fact>();
  for (const delta of [review.project, review.logic, review.intent]) {
    for (const fact of delta.added) map.set(fact.identity, fact);
    for (const fact of delta.removed) map.set(fact.identity, fact);
  }
  return map;
}

export function signalScope(signal: Signal, facts: Map<string, Fact>): { fact: Fact; file: string; line?: number } | null {
  for (const id of signal.evidence) {
    const fact = facts.get(id);
    if (fact?.file) return { fact, file: fact.file, line: fact.line };
  }
  return null;
}

export interface ReviewData {
  review: Review | null;
  files: CodeFile[];
  signals: Signal[];
  facts: Map<string, Fact>;
  stats: Map<string, DiffStats>;
}

export function useReviewData(): ReviewData {
  const { payload } = useApp();
  return useMemo(() => {
    const review = payload?.review ?? null;
    const files = payload?.code.files ?? [];
    const facts = review ? buildFactMap(review) : new Map<string, Fact>();
    const signals = review?.signals ?? [];
    const stats = new Map<string, DiffStats>();
    for (const file of files) {
      stats.set(file.path, diffStats(diffLines(file.before ?? '', file.after ?? '')));
    }
    return { review, files, signals, facts, stats };
  }, [payload]);
}
