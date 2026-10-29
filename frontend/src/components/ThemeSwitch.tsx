import styles from './ThemeSwitch.module.css';
import { IconMonitor, IconMoon, IconSun } from './Icons';
import type { ThemePref } from '../hooks/useTheme';

interface Props {
  pref: ThemePref;
  onChange: (pref: ThemePref) => void;
}

const OPTIONS: Array<{ value: ThemePref; label: string; icon: typeof IconSun }> = [
  { value: 'system', label: '系统', icon: IconMonitor },
  { value: 'light', label: '浅色', icon: IconSun },
  { value: 'dark', label: '深色', icon: IconMoon },
];

export function ThemeSwitch({ pref, onChange }: Props) {
  return (
    <div className={styles.switch} role="group" aria-label="主题">
      {OPTIONS.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            className={styles.option}
            aria-pressed={pref === option.value}
            title={`${option.label}主题`}
            onClick={() => onChange(option.value)}
          >
            <Icon width={13} height={13} />
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
