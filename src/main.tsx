import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import { useStore } from './store/store';

// Dev/test hook: lets Playwright inspect state. Not present in production builds.
if (import.meta.env.DEV) (window as unknown as { __store: typeof useStore }).__store = useStore;

// Ask the browser not to clear the saved projects when the disk runs low. (The project folder,
// if one is chosen, remains the backup either way.)
void navigator.storage?.persist?.().catch(() => false);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
