import { memo, useMemo } from 'react';
import { getIcon } from 'material-file-icons';
import { cx } from '../lib/format';
import styles from './FileTypeIcon.module.css';

// One material icon per file type. The icon set ships the SVG markup as a
// string, so it is injected as-is; filenames come from git, never user input.
function FileTypeIcon({ name, size = 14, className }: { name: string; size?: number; className?: string }) {
  const svg = useMemo(() => getIcon(name).svg, [name]);
  return <span className={cx(styles.icon, className)} style={{ width: size, height: size }} aria-hidden dangerouslySetInnerHTML={{ __html: svg }} />;
}

export const FileIcon = memo(FileTypeIcon);
