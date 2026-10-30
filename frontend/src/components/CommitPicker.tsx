import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCommits, fetchPayload } from '../lib/api';
import { cx } from '../lib/format';
import { useApp, useAppDispatch } from '../state/AppProvider';
import { IconBranch, IconCheck } from './Icons';
import styles from './CommitPicker.module.css';

export function CommitPicker() {
  const state = useApp();
  const dispatch = useAppDispatch();
  const comparison = state.payload?.review.comparison;
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(comparison?.selected ?? []);
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const commits = comparison?.commits ?? [];
  const isGit = comparison?.mode === 'git';

  useEffect(() => {
    setSelected(comparison?.selected ?? []);
  }, [comparison?.selected]);

  useEffect(() => {
    if (!isGit) return;
    let cancelled = false;
    setLoading(true);
    fetchCommits()
      .then((list) => {
        if (cancelled) return;
        if (list.commits.length === 0) setError('这个范围里没有提交');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isGit]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const allSelected = selected.length === 0 || selected.length === commits.length;
  const label = useMemo(() => {
    if (!isGit) return '目录比较';
    if (allSelected) return `全部 ${commits.length} 个提交`;
    return `已选 ${selected.length} / ${commits.length} 个提交`;
  }, [allSelected, commits.length, isGit, selected.length]);

  const toggle = (sha: string) => {
    setSelected((current) => {
      const base = current.length === 0 ? commits.map((commit) => commit.sha) : current;
      return base.includes(sha) ? base.filter((item) => item !== sha) : [...base, sha];
    });
  };

  const apply = async () => {
    if (!isGit) return;
    const ordered = commits
      .filter((commit) => (selected.length === 0 ? true : selected.includes(commit.sha)))
      .map((commit) => commit.sha);
    if (ordered.length === 0) return;
    setApplying(true);
    setError(null);
    try {
      const payload = await fetchPayload(ordered.length === commits.length ? undefined : ordered);
      dispatch({ type: 'payload/refresh', payload });
      dispatch({
        type: 'toast/show',
        message: ordered.length === commits.length ? '已切换到全部提交' : `已重算 ${ordered.length} 个提交`,
        kind: 'success',
      });
      setOpen(false);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={cx(styles.trigger, open && styles.triggerOpen)}
        onClick={() => setOpen((value) => !value)}
        title={comparison?.note || '选择要比较的提交'}
      >
        <IconBranch width={12} height={12} />
        <span>{label}</span>
        <em>{open ? '▴' : '▾'}</em>
      </button>

      {open && (
        <div className={styles.popover} role="dialog" aria-label="选择提交">
          <header className={styles.head}>
            <div>
              <strong>{comparison?.baseRef || 'base'}</strong>
              <span className={styles.arrow}>→</span>
              <strong>{comparison?.headRef || 'head'}</strong>
            </div>
            <button type="button" className="btn btnGhost btnSmall" onClick={() => setOpen(false)}>
              关闭
            </button>
          </header>

          {!isGit ? (
            <p className={styles.empty}>
              当前用两个目录比较，没有 Git 历史。改用 <code>--repo --from --to</code> 启动后可以按提交选择。
            </p>
          ) : (
            <>
              <div className={styles.toolbar}>
                <button
                  type="button"
                  className="btn btnGhost btnSmall"
                  onClick={() => setSelected(commits.map((commit) => commit.sha))}
                >
                  全选
                </button>
                <button
                  type="button"
                  className="btn btnGhost btnSmall"
                  onClick={() => setSelected([commits[commits.length - 1]?.sha].filter(Boolean))}
                >
                  只选最新
                </button>
                <span className={styles.hint}>未选中的提交不会进入比较</span>
              </div>

              <div className={styles.list}>
                {commits.map((commit) => {
                  const checked = selected.length === 0 || selected.includes(commit.sha);
                  return (
                    <label key={commit.sha} className={cx(styles.row, checked && styles.rowChecked)}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(commit.sha)}
                      />
                      <span className={styles.sha}>{commit.short}</span>
                      <span className={styles.subject} title={commit.subject}>{commit.subject}</span>
                      <span className={styles.meta}>{commit.author}</span>
                    </label>
                  );
                })}
                {loading && <div className={styles.empty}>正在读取提交…</div>}
              </div>

              {error && <div className={styles.error}>{error}</div>}

              <footer className={styles.foot}>
                <span>{selected.length === 0 ? '全部提交' : `${selected.length} 个提交`}</span>
                <button
                  type="button"
                  className="btn btnSmall btnPrimary"
                  onClick={apply}
                  disabled={applying || selected.length === 0}
                >
                  <IconCheck width={12} height={12} />
                  {applying ? '正在重算…' : '应用选择'}
                </button>
              </footer>
            </>
          )}
        </div>
      )}
    </div>
  );
}
