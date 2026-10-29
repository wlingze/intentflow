import { useApp } from '../state/AppProvider';
import { shortPath } from '../lib/format';
import type { ThemePref } from '../hooks/useTheme';
import { SubmitMenu } from './SubmitMenu';
import { ThemeSwitch } from './ThemeSwitch';
import styles from './TopBar.module.css';

interface Props {
  pref: ThemePref;
  onPrefChange: (pref: ThemePref) => void;
}

export function TopBar({ pref, onPrefChange }: Props) {
  const { payload, comments } = useApp();
  const review = payload?.review;
  const intent = review ? review.intent.added.length + review.intent.removed.length : 0;
  const signals = review?.signals?.length ?? 0;

  return (
    <header className={styles.top}>
      <div className={styles.brand}>
        <span className={styles.mark}>if</span>
        <span className={styles.name}>intentflow</span>
        <span className={styles.kicker}>semantic review</span>
      </div>

      {review && (
        <div className={styles.path} title={`${review.before} → ${review.after}`}>
          <code>{shortPath(review.before, 30)}</code>
          <span className={styles.arrow}>→</span>
          <code>{shortPath(review.after, 30)}</code>
        </div>
      )}

      <div className={styles.spacer} />

      {review && (
        <div className={styles.stats} aria-label="改动统计">
          <span className={styles.stat}>
            <b className={styles.plus}>+{review.intent.added.length}</b>
            <b className={styles.minus}>−{review.intent.removed.length}</b>
            <em>意图</em>
          </span>
          <span className={styles.stat}>
            <b>{intent}</b>
            <em>事实</em>
          </span>
          <span className={styles.stat}>
            <b>{signals}</b>
            <em>告警</em>
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
