import { useApp } from '../state/AppProvider';
import styles from './Toast.module.css';

export function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className={`${styles.toast} ${styles[toast.kind]}`} role="status" aria-live="polite">
      <span className={styles.dot} />
      {toast.message}
    </div>
  );
}
