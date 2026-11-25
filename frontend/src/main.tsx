import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { AppProvider } from './state/AppProvider';
import { applyTheme } from './lib/theme';
import './styles/tokens.css';
import './styles/global.css';

// 先定主题再挂载，避免首帧闪成深色。
applyTheme();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppProvider>
      <App />
    </AppProvider>
  </StrictMode>,
);
