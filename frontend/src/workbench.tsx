import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state/AppProvider';
import { applyTheme } from './lib/theme';
import type { WorkbenchSource } from './lib/api';
import './styles/tokens.css';
import './styles/global.css';

// 独立页和油猴只提供挂载点与数据源。工作台的页面树只有这一份。
export function mountWorkbench(container: HTMLElement, source?: WorkbenchSource) {
  applyTheme();
  const root = createRoot(container);
  root.render(<StrictMode><AppProvider source={source}><App /></AppProvider></StrictMode>);
  return root;
}
