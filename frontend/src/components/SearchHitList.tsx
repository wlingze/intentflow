import { Fragment, type Ref } from 'react';
import type { SearchHit } from '../lib/searchDiff';
import { groupTotals, kindLabel, snippet } from '../lib/searchHits';
import { cx } from '../lib/format';
import { FileIcon } from './FileTypeIcon';
import styles from './SearchHitList.module.css';

interface Props {
  results: SearchHit[];
  visibleCount: number;
  activeIndex?: number;
  activeRef?: Ref<HTMLButtonElement>;
  onSelect: (index: number) => void;
  onMore?: () => void;
  variant?: 'popup' | 'panel';
}

function kindClass(kind: SearchHit['kind']) {
  return kind === 'add' ? styles.kindAdd : kind === 'del' ? styles.kindDel : styles.kindContext;
}

function rowClass(kind: SearchHit['kind']) {
  return kind === 'add' ? styles.hitAdd : kind === 'del' ? styles.hitDel : undefined;
}

export function SearchHitList({ results, visibleCount, activeIndex = -1, activeRef, onSelect, onMore, variant = 'popup' }: Props) {
  const totals = groupTotals(results);
  let previous = '';
  return <div className={cx(styles.results, variant === 'panel' && styles.panel)}>
    {results.slice(0, visibleCount).map((hit, index) => {
      const showHeader = hit.path !== previous;
      previous = hit.path;
      const parts = snippet(hit);
      return <Fragment key={`${hit.path}:${hit.side}:${hit.line}`}>
        {showHeader && <div className={styles.group}><FileIcon name={hit.path} size={12} /><span>{hit.path}</span><b>{totals.get(hit.path)}</b></div>}
        <button
          ref={index === activeIndex ? activeRef : undefined}
          type="button"
          data-kind={hit.kind}
          className={cx(styles.hit, rowClass(hit.kind), index === activeIndex && styles.active)}
          aria-current={index === activeIndex ? 'true' : undefined}
          title={hit.text.trim()}
          onClick={() => onSelect(index)}
        >
          <span className={styles.line}>{hit.line}</span>
          <span className={cx(styles.kind, kindClass(hit.kind))}>{kindLabel(hit.kind)}</span>
          <span className={styles.code}>{parts.before}<mark>{parts.match}</mark>{parts.after}</span>
        </button>
      </Fragment>;
    })}
    {results.length > visibleCount && onMore && <button type="button" className={styles.more} onClick={onMore}>
      显示更多（还有 {results.length - visibleCount} 行）
    </button>}
  </div>;
}
