import { useMemo } from 'react';
import { roleLabel } from '../lib/behavior';
import { cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, DeltaKind } from '../types';
import styles from './BehaviorSidebar.module.css';

const DELTA_LABEL: Record<DeltaKind, string> = {
  modified: '变化',
  added: '新增',
  removed: '移除',
  unchanged: '未变',
};

const ORDER: Record<DeltaKind, number> = { modified: 0, added: 1, removed: 2, unchanged: 3 };
const MARK: Record<string, string> = { trigger: 'IN', decision: '??', transform: 'ƒ', effect: 'OUT' };

export function BehaviorSidebar() {
  const dispatch = useAppDispatch();
  const { review } = useReviewData();
  const state = useApp();

  const scenarios = useMemo(() => {
    if (!review) return [];
    return [...review.behavior.scenarios].sort((left, right) => {
      const byTitle = left.title.localeCompare(right.title);
      return byTitle !== 0 ? byTitle : ORDER[left.delta] - ORDER[right.delta];
    });
  }, [review]);

  if (!review) return null;
  const nodeById = new Map(review.behavior.nodes.map((node) => [node.id, node]));
  const edgeBetween = (scenarioId: string, from: string, to: string): BehaviorEdge | undefined =>
    review.behavior.edges.find(
      (edge) => edge.scenario === scenarioId && edge.from === from && edge.to === to,
    );

  const jump = (node: BehaviorNode) => {
    if (!node.file) {
      dispatch({ type: 'toast/show', message: '这个行为节点没有代码位置', kind: 'info' });
      return;
    }
    dispatch({ type: 'select', selected: { kind: 'node', id: node.id } });
    dispatch({
      type: 'code/open',
      file: node.file,
      line: node.line,
      side: node.delta === 'removed' ? 'before' : 'after',
    });
  };

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div>
          <div className={styles.eyebrow}>行为导航</div>
          <div className={styles.title}>{scenarios.length} 条行为</div>
        </div>
        <span className={styles.hint}>点步骤跳代码</span>
      </header>
      <div className={styles.list}>
        {scenarios.map((scenario, index) => {
          const nodes = scenario.nodes
            .map((id) => nodeById.get(id))
            .filter((node): node is BehaviorNode => Boolean(node));
          return (
            <article key={scenario.id} className={cx(styles.scenario, styles[`delta_${scenario.delta}`])}>
              <div className={styles.scenarioHead}>
                <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.scenarioTitle} title={scenario.title}>{scenario.title}</span>
                <span className={styles.delta}>{DELTA_LABEL[scenario.delta]}</span>
              </div>
              <div className={styles.flow}>
                {nodes.map((node, slot) => {
                  const previous = slot > 0 ? nodes[slot - 1] : undefined;
                  const edge = previous ? edgeBetween(scenario.id, previous.id, node.id) : undefined;
                  return (
                    <span key={`${scenario.id}-${node.id}`} className={styles.stepWrap}>
                      {edge && (
                        <span className={styles.arrow} title={edge.label}>
                          →
                          <em>{edge.kind === 'data' ? edge.shape : edge.label === '进入判定' ? '' : edge.label}</em>
                        </span>
                      )}
                      <button
                        type="button"
                        className={cx(
                          styles.chip,
                          styles[`role_${node.role}`],
                          styles[`chip_${node.delta}`],
                          state.selected?.kind === 'node' && state.selected.id === node.id && styles.active,
                        )}
                        title={`${node.label} · ${roleLabel(node.role)} · ${node.file}:${node.line}`}
                        onClick={() => jump(node)}
                      >
                        <i>{MARK[node.role]}</i>
                        <span>{node.label}</span>
                      </button>
                    </span>
                  );
                })}
              </div>
              <div className={styles.meta}>
                {scenario.source || '未知来源'} · {scenario.shape || '—'}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
