import { useApp, useAppDispatch } from '../state/AppProvider';
import { shortPath } from '../lib/format';
import type { ThemePref } from '../hooks/useTheme';
import { CommitPicker } from './CommitPicker';
import { SubmitMenu } from './SubmitMenu';
import { ThemeSwitch } from './ThemeSwitch';
import { IconBranch, IconCode, IconFiles, IconPanel } from './Icons';
import styles from './TopBar.module.css';

interface Props {
  pref: ThemePref;
  onPrefChange: (pref: ThemePref) => void;
}

export function TopBar({ pref, onPrefChange }: Props) {
  const { payload, comments, view, drawer } = useApp();
  const dispatch = useAppDispatch();
  const review = payload?.review;
  const comparison = review?.comparison;
  const facts = review
    ? [review.project, review.logic, review.intent].reduce(
        (sum, delta) => sum + delta.added.length + delta.removed.length,
        0,
      )
    : 0;
  const signals = review?.signals?.length ?? 0;
  const risks = review?.ai?.status === 'ok' ? review.ai.risks.length : 0;

  return (
    <header className={styles.top}>
      <div className={styles.brand}>
        <span className={styles.mark}>if</span>
        <span className={styles.name}>intentflow</span>
        <span className={styles.kicker}>semantic review</span>
      </div>

      {review && (
        <div className={styles.compare} title={`${review.before} → ${review.after}`}>
          <span className={styles.branch}>
            <IconBranch width={11} height={11} />
            <code>{shortPath(comparison?.beforeLabel || review.before, 22)}</code>
          </span>
          <span className={styles.arrow}>→</span>
          <span className={styles.branch}>
            <code>{shortPath(comparison?.afterLabel || review.after, 26)}</code>
          </span>
          <CommitPicker />
        </div>
      )}

      <div className={styles.spacer} />

      <div className={styles.narrowOnly} role="group" aria-label="窄屏面板">
        <button
          type="button"
          aria-pressed={drawer === 'left'}
          onClick={() => dispatch({ type: 'drawer/set', drawer: drawer === 'left' ? null : 'left' })}
          title="文件与行为图"
        >
          <IconFiles width={12} height={12} />
        </button>
        <button
          type="button"
          aria-pressed={drawer === 'right'}
          onClick={() => dispatch({ type: 'drawer/set', drawer: drawer === 'right' ? null : 'right' })}
          title="分析与 Review"
        >
          <IconPanel width={12} height={12} />
        </button>
      </div>

      <div className={styles.views} role="group" aria-label="工作台视图">
        <button
          type="button"
          aria-pressed={view === 'code'}
          className={view === 'code' ? styles.viewActive : ''}
          onClick={() => dispatch({ type: 'view/set', view: 'code' })}
        >
          <IconCode width={12} height={12} />
          代码
        </button>
        <button
          type="button"
          aria-pressed={view === 'graph'}
          className={view === 'graph' ? styles.viewActive : ''}
          onClick={() => dispatch({ type: 'view/set', view: 'graph' })}
        >
          <IconBranch width={12} height={12} />
          全文图
        </button>
      </div>

      {review && (
        <div className={styles.stats} aria-label="改动统计">
          <span className={styles.stat}>
            <b className={styles.plus}>+{review.intent.added.length}</b>
            <b className={styles.minus}>−{review.intent.removed.length}</b>
            <em>意图</em>
          </span>
          <span className={styles.stat}>
            <b>{facts}</b>
            <em>事实</em>
          </span>
          <span className={styles.stat}>
            <b>{signals}</b>
            <em>告警</em>
          </span>
          <span className={styles.stat}>
            <b>{risks}</b>
            <em>AI</em>
          </span>
          <span className={styles.stat}>
            <b>{comments.length}</b>
            <em>评论</em>
          </span>
        </div>
      )}

      <ThemeSwitch pref={pref} onChange={onPrefChange} />
      <SubmitMenu />
    </header>
  );
}
