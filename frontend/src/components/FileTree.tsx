import { useMemo } from 'react';
import { buildTree, countChanged, type TreeNode } from '../lib/tree';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { DiffStats } from '../lib/diff';
import { IconChevronRight, IconFile, IconFolder } from './Icons';
import styles from './FileTree.module.css';

const STATUS_CLASS: Record<string, string> = {
  added: styles.added,
  removed: styles.removed,
  modified: styles.modified,
  unchanged: styles.unchanged,
};

const STATUS_LETTER: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  unchanged: '',
};

function FileRows({ nodes, depth = 0 }: { nodes: TreeNode[]; depth?: number }) {
  const dispatch = useAppDispatch();
  const { stats } = useReviewData();

  return (
    <>
      {nodes.map((node) => {
        if (node.type === 'dir') {
          const changed = countChanged(node);
          const aggregate = collectStats(node.children, stats);
          return (
            <details key={node.path} className={styles.dir} open={depth < 4}>
              <summary className={styles.dirRow} style={{ paddingLeft: 6 + depth * 12 }}>
                <IconChevronRight className={styles.chevron} width={12} height={12} />
                <IconFolder width={13} height={13} className={styles.folder} />
                <span className={styles.dirName}>{node.name}</span>
                {aggregate.adds > 0 && <b className={styles.plus}>+{aggregate.adds}</b>}
                {aggregate.dels > 0 && <b className={styles.minus}>−{aggregate.dels}</b>}
                {changed > 0 && <span className={styles.count}>{changed}</span>}
              </summary>
              <FileRows nodes={node.children} depth={depth + 1} />
            </details>
          );
        }

        const stat = stats.get(node.path);
        const status = node.file.status;
        return (
          <button
            key={node.path}
            type="button"
            className={styles.fileRow}
            style={{ paddingLeft: 22 + depth * 12 }}
            title={node.path}
            onClick={() => dispatch({ type: 'code/open', file: node.path })}
          >
            <IconFile width={13} height={13} className={styles.fileIcon} />
            <span className={styles.fileName}>{node.name}</span>
            {status !== 'unchanged' && (
              <span className={`${styles.status} ${STATUS_CLASS[status]}`}>{STATUS_LETTER[status]}</span>
            )}
            {stat && (stat.adds > 0 || stat.dels > 0) && (
              <span className={styles.diffstat}>
                {stat.adds > 0 && <b className={styles.plus}>+{stat.adds}</b>}
                {stat.dels > 0 && <b className={styles.minus}>−{stat.dels}</b>}
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}

function collectStats(nodes: TreeNode[], stats: Map<string, DiffStats>): { adds: number; dels: number; changed: number; files: number } {
  let adds = 0;
  let dels = 0;
  let changed = 0;
  let files = 0;
  for (const node of nodes) {
    if (node.type === 'dir') {
      const nested = collectStats(node.children, stats);
      adds += nested.adds;
      dels += nested.dels;
      changed += nested.changed;
      files += nested.files;
      continue;
    }
    files += 1;
    if (node.file.status !== 'unchanged') changed += 1;
    const stat = stats.get(node.path);
    adds += stat?.adds ?? 0;
    dels += stat?.dels ?? 0;
  }
  return { adds, dels, changed, files };
}

export function FileTree({ variant = 'project' }: { variant?: 'project' | 'files' }) {
  const { payload, onlyChanged } = useApp();
  const dispatch = useAppDispatch();
  const { review, files, stats } = useReviewData();
  const tree = useMemo(() => buildTree(files, onlyChanged), [files, onlyChanged]);
  const changed = files.filter((file) => file.status !== 'unchanged').length;
  const totals = collectStats(buildTree(files, true), stats);
  const added = files.filter((file) => file.status === 'added').length;
  const removed = files.filter((file) => file.status === 'removed').length;
  const modified = files.filter((file) => file.status === 'modified').length;
  const all = Math.max(1, added + modified + removed);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>{variant === 'project' ? '项目改动' : '变更文件'}</div>
          <div className={styles.sub}>
            {changed} 个变更 · {files.length} 个文件
            <span className={styles.factCount}>
              <b>代码</b> +{totals.adds}/−{totals.dels}
              {' · '}
              <b>结构</b> +{review?.project.added.length ?? 0}/−{review?.project.removed.length ?? 0}
              {' · '}
              <b>调用</b> +{review?.logic.added.length ?? 0}/−{review?.logic.removed.length ?? 0}
            </span>
          </div>
        </div>
        <button
          type="button"
          className={`btn btnGhost btnSmall ${styles.toggle}`}
          aria-pressed={onlyChanged}
          onClick={() => dispatch({ type: 'onlyChanged', value: !onlyChanged })}
        >
          只看变更
        </button>
      </div>

      <div className={styles.summaryWrap} aria-label="改动构成">
        <div className={styles.summaryBar}>
          <i className={styles.summaryAdded} style={{ width: `${(added / all) * 100}%` }} />
          <i className={styles.summaryModified} style={{ width: `${(modified / all) * 100}%` }} />
          <i className={styles.summaryRemoved} style={{ width: `${(removed / all) * 100}%` }} />
        </div>
        <div className={styles.summaryLegend}>
          <span><i className={styles.legendAdded} />新增 {added}</span>
          <span><i className={styles.legendModified} />修改 {modified}</span>
          <span><i className={styles.legendRemoved} />删除 {removed}</span>
        </div>
      </div>

      <div className={styles.scroll}>
        {tree.length ? (
          <div className={styles.tree}>
            <FileRows nodes={tree} />
          </div>
        ) : (
          <div className={styles.empty}>没有可显示的文件</div>
        )}

      </div>

      <div className={styles.foot}>
        <span title={payload?.code.root}>{payload?.code.root}</span>
        {payload?.code.truncated && <b>已截断</b>}
      </div>
    </div>
  );
}
