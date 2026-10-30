import { useMemo } from 'react';
import { roleLabel } from '../lib/behavior';
import { cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { BehaviorEdge, BehaviorNode, BehaviorScenario, DeltaKind } from '../types';
import styles from './BehaviorSidebar.module.css';

const DELTA_LABEL: Record<DeltaKind, string> = {
  modified: '变化',
  added: '新增',
  removed: '移除',
  unchanged: '未变',
};

const ORDER: Record<DeltaKind, number> = { modified: 0, added: 1, removed: 2, unchanged: 3 };
const MARK: Record<string, string> = { trigger: 'IN', decision: '??', transform: 'ƒ', effect: 'OUT' };

interface ScenarioGroup {
  trigger: string;
  title: string;
  delta: DeltaKind;
  scenarios: BehaviorScenario[];
}

function mergeDelta(values: DeltaKind[]): DeltaKind {
  const set = new Set(values);
  if (set.size === 0) return 'unchanged';
  if (set.size === 1) return values[0];
  return 'modified';
}

function groupScenarios(scenarios: BehaviorScenario[]): ScenarioGroup[] {
  const groups = new Map<string, ScenarioGroup>();
  for (const scenario of scenarios) {
    const group = groups.get(scenario.trigger) ?? {
      trigger: scenario.trigger,
      title: scenario.title,
      delta: scenario.delta,
      scenarios: [],
    };
    group.scenarios.push(scenario);
    group.delta = mergeDelta([group.delta, scenario.delta]);
    groups.set(scenario.trigger, group);
  }
  return [...groups.values()]
    .map((group) => ({
      ...group,
      scenarios: [...group.scenarios].sort((left, right) => {
        const byDelta = ORDER[left.delta] - ORDER[right.delta];
        return byDelta !== 0 ? byDelta : left.title.localeCompare(right.title);
      }),
    }))
    .sort((left, right) => {
      const byDelta = ORDER[left.delta] - ORDER[right.delta];
      return byDelta !== 0 ? byDelta : left.title.localeCompare(right.title);
    });
}

export function BehaviorSidebar() {
  const dispatch = useAppDispatch();
  const { review } = useReviewData();
  const state = useApp();

  const groups = useMemo(
    () => (review ? groupScenarios(review.behavior.scenarios) : []),
    [review],
  );

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

  const flow = (scenario: BehaviorScenario) => {
    const nodes = scenario.nodes
      .map((id) => nodeById.get(id))
      .filter((node): node is BehaviorNode => Boolean(node));
    return (
      <>
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
      </>
    );
  };

  return (
    <section className={styles.panel}>
      <header className={styles.head}>
        <div>
          <div className={styles.eyebrow}>行为导航</div>
          <div className={styles.title}>{groups.length} 组 · {review.behavior.scenarios.length} 条行为</div>
        </div>
        <span className={styles.hint}>点步骤跳代码</span>
      </header>
      <div className={styles.list}>
        {groups.map((group, index) => {
          const triggerNode = nodeById.get(group.trigger);
          const title = `${triggerNode?.label ?? group.title.split(' → ')[0]} · ${group.scenarios.length} 条`;
          return (
            <article key={group.trigger} className={cx(styles.scenario, styles[`delta_${group.delta}`])}>
              <div className={styles.scenarioHead}>
                <span className={styles.index}>{String(index + 1).padStart(2, '0')}</span>
                <span className={styles.scenarioTitle} title={group.scenarios.map((scenario) => scenario.title).join(' / ')}>
                  {title}
                </span>
                <span className={styles.delta}>{DELTA_LABEL[group.delta]}</span>
              </div>
              <details className={styles.groupDetails} open={group.scenarios.length === 1}>
                <summary>{group.scenarios.length === 1 ? '行为路径' : `展开 ${group.scenarios.length} 条同源行为`}</summary>
                {group.scenarios.map((scenario, scenarioIndex) => (
                  <div key={scenario.id} className={styles.subScenario}>
                    {group.scenarios.length > 1 && (
                      <div className={styles.subTitle}>
                        <span>{String(scenarioIndex + 1).padStart(2, '0')}</span>
                        <b>{scenario.title}</b>
                        <em>{DELTA_LABEL[scenario.delta]}</em>
                      </div>
                    )}
                    {flow(scenario)}
                  </div>
                ))}
              </details>
            </article>
          );
        })}
      </div>
    </section>
  );
}
