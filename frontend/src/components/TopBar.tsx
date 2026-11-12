import { useApp, useAppDispatch } from '../state/AppProvider';
import { RevisionPicker } from './RevisionPicker';
import { useReviewData } from '../state/selectors';
import { SubmitMenu } from './SubmitMenu';
import { IconBranch, IconFiles, IconPanel, IconSearch } from './Icons';
import styles from './TopBar.module.css';

export function TopBar({ onSearch }: { onSearch: () => void }) {
  const { payload, drawer, panels, viewed } = useApp();
  const dispatch = useAppDispatch();
  const { files, stats } = useReviewData();
  const ctx = payload?.session.context;
  const adds = [...stats.values()].reduce((sum, stat) => sum + stat.adds, 0);
  const dels = [...stats.values()].reduce((sum, stat) => sum + stat.dels, 0);
  return <header className={styles.top}>
    <span className={styles.mark} title="intentflow">if</span>
    <div className={styles.identity}>
      <div className={styles.repo} title={ctx?.repository}>{ctx?.repository.split('/').filter(Boolean).slice(-2).join('/') || 'intentflow'}</div>
      <div className={styles.branchRow}><IconBranch width={13} height={13} /><span className={styles.branch} title={ctx?.branch}>{ctx?.branch}</span><span className={styles.local}>本地 PR</span></div>
    </div>
    <RevisionPicker />
    <div className={styles.stats}><span>{viewed.length}/{files.length} 已查看</span><b className={styles.plus}>+{adds}</b><b className={styles.minus}>−{dels}</b></div>
    <div className={styles.actions}>
      <div className={styles.searchWrap}>
        <button type="button" aria-label="搜索全部 diff" title="搜索全部 diff (Ctrl+F)" onClick={onSearch}><IconSearch width={16} height={16} /></button>
      </div>
      <div className={styles.wideOnly} role="group" aria-label="面板开关">
        <button type="button" aria-label="文件导航" aria-pressed={panels.files} title="文件导航" onClick={() => dispatch({ type: 'panel/toggle', panel: 'files' })}><IconFiles width={16} height={16} /></button>
        <button type="button" aria-label="评审信息" aria-pressed={panels.right} title="评审信息" onClick={() => dispatch({ type: 'panel/toggle', panel: 'right' })}><IconPanel width={16} height={16} /></button>
      </div>
      <div className={styles.narrowOnly} role="group" aria-label="窄屏面板">
        <button type="button" aria-label="文件导航" aria-pressed={drawer === 'left'} onClick={() => dispatch({ type: 'drawer/set', drawer: drawer === 'left' ? null : 'left' })}><IconFiles width={16} height={16} /></button>
        <button type="button" aria-label="评审信息" aria-pressed={drawer === 'right'} onClick={() => dispatch({ type: 'drawer/set', drawer: drawer === 'right' ? null : 'right' })}><IconPanel width={16} height={16} /></button>
      </div>
      <SubmitMenu />
    </div>
  </header>;
}
