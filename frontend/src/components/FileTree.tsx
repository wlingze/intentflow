import { useMemo } from 'react';
import { buildTree, countChanged, type TreeNode } from '../lib/tree';
import { baseName } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { Fact, Side } from '../types';
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
          return (
            <details key={node.path} className={styles.dir} open={depth < 2}>
              <summary className={styles.dirRow} style={{ paddingLeft: 6 + depth * 12 }}>
                <IconChevronRight className={styles.chevron} width={12} height={12} />
                <IconFolder width={13} height={13} className={styles.folder} />
                <span className={styles.dirName}>{node.name}</span>
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
            onClick={() => dispatch({ type: 'drawer/open', file: node.path })}
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

function ProjectFact({ fact, side }: { fact: Fact; side: Side }) {
  const dispatch = useAppDispatch();
  return (
    <button
      type="button"
      className={styles.projectFact}
      title={fact.detail ?? fact.title}
      onClick={() => {
        if (fact.file) dispatch({ type: 'drawer/open', file: fact.file, line: fact.line, side });
      }}
    >
      <span className={`${styles.sign} ${side === 'after' ? styles.plus : styles.minus}`}>
        {side === 'after' ? '+' : '−'}
      </span>
      <span className={styles.factTitle}>{fact.title}</span>
      {fact.file && (
        <span className={styles.factLoc}>
          {baseName(fact.file)}
          {fact.line ? `:${fact.line}` : ''}
        </span>
      )}
    </button>
  );
}

export function FileTree() {
  const { payload, onlyChanged } = useApp();
  const dispatch = useAppDispatch();
  const { review, files } = useReviewData();
  const tree = useMemo(() => buildTree(files, onlyChanged), [files, onlyChanged]);
  const changed = files.filter((file) => file.status !== 'unchanged').length;
  const projectAdded = review?.project.added ?? [];
  const projectRemoved = review?.project.removed ?? [];

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div>
          <div className={styles.title}>文件</div>
          <div className={styles.sub}>
            {changed} 个变更 · {files.length} 个文件
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

      <div className={styles.scroll}>
        {tree.length ? (
          <div className={styles.tree}>
            <FileRows nodes={tree} />
          </div>
        ) : (
          <div className={styles.empty}>没有可显示的文件</div>
        )}

        {(projectAdded.length > 0 || projectRemoved.length > 0) && (
          <section className={styles.project}>
            <div className={styles.sectionTitle}>
              项目结构
              <span>
                {projectAdded.length > 0 && <b className={styles.plus}>+{projectAdded.length}</b>}
                {projectRemoved.length > 0 && <b className={styles.minus}>−{projectRemoved.length}</b>}
              </span>
            </div>
            {projectAdded.map((fact) => (
              <ProjectFact key={fact.identity} fact={fact} side="after" />
            ))}
            {projectRemoved.map((fact) => (
              <ProjectFact key={fact.identity} fact={fact} side="before" />
            ))}
          </section>
        )}
      </div>

      <div className={styles.foot}>
        <span title={payload?.code.root}>{payload?.code.root}</span>
        {payload?.code.truncated && <b>已截断</b>}
      </div>
    </div>
  );
}
