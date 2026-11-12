import { useEffect, useMemo, useRef, useState } from 'react';
import { allDirs, buildTree, countChanged, countFiles, countViewed, dirAncestors, fileRowTone, type TreeNode } from '../lib/tree';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { useReviewData } from '../state/selectors';
import type { DiffStats } from '../lib/diff';
import { IconChevronRight, IconChevrons, IconComment, IconFolder } from './Icons';
import { FileIcon } from './FileTypeIcon';
import styles from './FileTree.module.css';

const STATUS_CLASS: Record<string, string> = {
  added: styles.added,
  removed: styles.removed,
  modified: styles.modified,
  renamed: styles.renamed,
  unchanged: styles.unchanged,
};

const STATUS_LETTER: Record<string, string> = {
  added: 'A',
  removed: 'D',
  modified: 'M',
  renamed: 'R',
  unchanged: '',
};

interface RowsProps {
  nodes: TreeNode[];
  stats: Map<string, DiffStats>;
  digests: Map<string, string>;
  viewed: string[];
  commentCounts: Map<string, number>;
  expanded: Set<string>;
  onToggle: (path: string, open: boolean) => void;
  flash?: string;
  /** Files being rendered in the diff pane right now. */
  onScreen: string[];
  /** File the user opened from the tree, search or symbol panel. */
  active: string;
  depth?: number;
}

function FileRows({ nodes, stats, digests, viewed, commentCounts, expanded, onToggle, flash = '', onScreen, active, depth = 0 }: RowsProps) {
  const dispatch = useAppDispatch();
  // A viewed mark only counts while the file content still matches its digest.
  const isViewed = (path: string) => viewed.includes(`${path}#${digests.get(path) ?? ''}`);

  return (
    <>
      {nodes.map((node) => {
        if (node.type === 'dir') {
          const changed = countChanged(node);
          const aggregate = collectStats(node.children, stats);
          const comments = collectComments(node.children, commentCounts);
          const total = countFiles(node);
          const done = countViewed(node, isViewed);
          const allViewed = total > 0 && done === total;
          return (
            <details
              key={node.path}
              className={styles.dir}
              open={expanded.has(node.path)}
              onToggle={(event) => onToggle(node.path, event.currentTarget.open)}
            >
              <summary className={`${styles.dirRow} ${allViewed ? styles.dirRowDone : ''}`} style={{ paddingLeft: 6 + depth * 12 }}>
                <IconChevronRight className={styles.chevron} width={12} height={12} />
                <IconFolder width={13} height={13} className={styles.folder} />
                <span className={styles.dirName}>{node.name}</span>
                {aggregate.adds > 0 && <b className={styles.plus}>+{aggregate.adds}</b>}
                {aggregate.dels > 0 && <b className={styles.minus}>−{aggregate.dels}</b>}
                {comments > 0 && <span className={styles.commentCount} title={`${comments} 条评论`}><IconComment width={11} height={11} />{comments}</span>}
                {changed > 0 && <span className={styles.count}>{changed}</span>}
                {allViewed && <span className={styles.check} aria-label="已查看">✓</span>}
              </summary>
              <FileRows nodes={node.children} stats={stats} digests={digests} viewed={viewed} commentCounts={commentCounts} expanded={expanded} onToggle={onToggle} flash={flash} onScreen={onScreen} active={active} depth={depth + 1} />
            </details>
          );
        }

        const stat = stats.get(node.path);
        const status = node.file.status;
        const comments = commentCounts.get(node.path) ?? 0;
        const done = isViewed(node.path);
        const tone = fileRowTone(node.path, active, onScreen);
        return (
          <button
            key={node.path}
            type="button"
            className={`${styles.fileRow} ${done ? styles.fileRowDone : ''} ${flash === node.path ? styles.fileRowFlash : ''} ${tone === 'onScreen' ? styles.fileRowOnScreen : ''} ${tone === 'active' ? styles.fileRowActive : ''}`}
            data-tree-path={node.path}
            data-tone={tone || undefined}
            style={{ paddingLeft: 22 + depth * 12 }}
            title={node.file.old_path ? `${node.file.old_path} → ${node.path}` : node.path}
            onClick={() => dispatch({ type: 'code/reveal', file: node.path })}
          >
            <FileIcon name={node.name} size={14} className={styles.fileIcon} />
            <span className={styles.fileName}>{node.name}</span>
            {status !== 'unchanged' && (
              <span className={`${styles.status} ${STATUS_CLASS[status]}`}>{STATUS_LETTER[status]}</span>
            )}
            {comments > 0 && <span className={styles.commentCount} title={`${comments} 条评论`}><IconComment width={11} height={11} />{comments}</span>}
            {stat && (stat.adds > 0 || stat.dels > 0) && (
              <span className={styles.diffstat}>
                {stat.adds > 0 && <b className={styles.plus}>+{stat.adds}</b>}
                {stat.dels > 0 && <b className={styles.minus}>−{stat.dels}</b>}
              </span>
            )}
            {done && <span className={styles.check} aria-label="已查看">✓</span>}
          </button>
        );
      })}
    </>
  );
}

function collectComments(nodes: TreeNode[], commentCounts: Map<string, number>): number {
  let total = 0;
  for (const node of nodes) {
    if (node.type === 'dir') total += collectComments(node.children, commentCounts);
    else total += commentCounts.get(node.path) ?? 0;
  }
  return total;
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

export function FileTree() {
  const { viewed, comments, code, treeFocus } = useApp();
  const { files, stats, digests } = useReviewData();
  const commentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const comment of comments) {
      const file = comment.quote?.file;
      if (file) counts.set(file, (counts.get(file) ?? 0) + 1);
    }
    return counts;
  }, [comments]);
  const [filter, setFilter] = useState('');
  // Directories start collapsed; jumps and filtering open what is needed.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [flash, setFlash] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const tree = useMemo(
    () => buildTree(files.filter((file) => file.path.toLowerCase().includes(filter.toLowerCase())), true),
    [files, filter],
  );
  const totals = collectStats(buildTree(files, true), stats);
  const visibleDirs = useMemo(() => filter ? allDirs(tree) : null, [filter, tree]);
  const open = visibleDirs ?? expanded;
  const dirs = useMemo(() => allDirs(tree), [tree]);
  const allOpen = dirs.size > 0 && [...dirs].every((dir) => expanded.has(dir));

  const toggleAll = () => setExpanded((prev) => {
    const list = allDirs(tree);
    const every = list.size > 0 && [...list].every((dir) => prev.has(dir));
    return every ? new Set<string>() : list;
  });

  const onToggle = (path: string, isOpen: boolean) => setExpanded((prev) => {
    if (prev.has(path) === isOpen) return prev;
    const next = new Set(prev);
    if (isOpen) next.add(path);
    else next.delete(path);
    return next;
  });

  // 「在文件列表定位」从 diff 卡片跳到左栏：清掉过滤词、展开祖先目录、闪一下行。
  useEffect(() => {
    if (!treeFocus) return;
    setFilter('');
    const ancestors = dirAncestors(treeFocus.path);
    setExpanded((prev) => {
      if (ancestors.every((dir) => prev.has(dir))) return prev;
      const next = new Set(prev);
      for (const dir of ancestors) next.add(dir);
      return next;
    });
    setFlash(treeFocus.path);
    const timer = window.setTimeout(() => setFlash(''), 1600);
    return () => window.clearTimeout(timer);
  }, [treeFocus]);

  useEffect(() => {
    if (!flash) return;
    const row = scroller.current?.querySelector<HTMLElement>(`[data-tree-path="${CSS.escape(flash)}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [flash, tree]);

  // Revealing a file from search, the symbol panel or a comment opens its path.
  const reveal = code.reveal?.file ?? '';
  useEffect(() => {
    if (!reveal) return;
    const dirs = dirAncestors(reveal);
    if (!dirs.length) return;
    setExpanded((prev) => {
      if (dirs.every((dir) => prev.has(dir))) return prev;
      const next = new Set(prev);
      for (const dir of dirs) next.add(dir);
      return next;
    });
  }, [reveal, code.revealToken]);

  return (
    <div className={styles.panel}>
      <div className={styles.head}>
        <div className={styles.title}>变更文件</div>
        <div className={styles.sub}>
          <span>{files.length} 个</span>
          <span className={styles.factCount}><b className={styles.plus}>+{totals.adds}</b> <b className={styles.minus}>−{totals.dels}</b></span>
          {!filter && dirs.size > 0 && <button type="button" className={styles.expandAll} aria-label={allOpen ? '折叠全部目录' : '展开全部目录'} aria-pressed={allOpen} title={allOpen ? '折叠全部目录' : '展开全部目录'} onClick={toggleAll}><IconChevrons width={13} height={13} up={allOpen} /></button>}
        </div>
      </div>

      <input
        className={styles.filterInput}
        aria-label="过滤文件"
        placeholder="过滤文件…"
        value={filter}
        onChange={(event) => setFilter(event.target.value)}
      />

      <div ref={scroller} className={styles.scroll}>
        {tree.length ? (
          <div className={styles.tree}>
            <FileRows nodes={tree} stats={stats} digests={digests} viewed={viewed} commentCounts={commentCounts} expanded={open} onToggle={onToggle} flash={flash} onScreen={code.visible} active={code.reveal?.file ?? ''} />
          </div>
        ) : (
          <div className={styles.empty}>没有可显示的文件</div>
        )}
      </div>

      <div className={styles.foot}>
        {viewed.length}/{files.length} 已查看
      </div>
    </div>
  );
}
