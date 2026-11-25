import { useEffect, useRef, useState } from 'react';
import { applyTheme, loadThemeMode, saveThemeMode, themeLabel, watchSystemTheme, type ThemeMode } from '../lib/theme';
import { IconCheck, IconMonitor, IconMoon, IconSun } from './Icons';
import styles from './ThemeMenu.module.css';

const MODES: ThemeMode[] = ['system', 'light', 'dark'];
const ICONS = { system: IconMonitor, light: IconSun, dark: IconMoon };

// 三态主题菜单。默认跟随系统；选择存 localStorage，独立页与油猴脚本共用
// 同一组 CSS 变量，所以两种入口的渲染完全一致。
export function ThemeMenu() {
  const [mode, setMode] = useState<ThemeMode>(loadThemeMode);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const apply = () => { applyTheme(undefined, mode); };
    apply();
    return watchSystemTheme(mode, apply);
  }, [mode]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!root.current || !event.composedPath().includes(root.current)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const pick = (next: ThemeMode) => {
    setMode(next);
    saveThemeMode(next);
    setOpen(false);
  };
  const Current = ICONS[mode];
  return <div className={styles.root} ref={root}>
    <button
      type="button"
      className="iconBtn"
      aria-label={`主题：${themeLabel(mode)}`}
      aria-haspopup="menu"
      aria-expanded={open}
      title={`主题：${themeLabel(mode)}`}
      onClick={() => setOpen((value) => !value)}
    >
      <Current width={16} height={16} />
    </button>
    {open && <div className={styles.menu} role="menu" aria-label="主题">
      {MODES.map((item) => {
        const Icon = ICONS[item];
        const active = item === mode;
        return <button key={item} type="button" role="menuitemradio" aria-checked={active} className={styles.row} data-active={active || undefined} onClick={() => pick(item)}>
          <Icon width={15} height={15} />
          <span>{themeLabel(item)}</span>
          {active && <IconCheck width={13} height={13} />}
        </button>;
      })}
    </div>}
  </div>;
}
