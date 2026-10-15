import { useEffect } from 'react';
import { useStore } from '../store/store';
import { projectFromTemplate } from '../template/load';
import { ProjectView } from './ProjectView';
import { Toasts } from './Toasts';

function useTheme() {
  const theme = useStore((s) => s.prefs.theme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && mq.matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
}

export function App() {
  useTheme();
  const project = useStore((s) => s.project);
  useEffect(() => {
    if (!useStore.getState().project) {
      useStore.getState().openProject(projectFromTemplate('Condo development (template)'));
    }
  }, []);
  return (
    <>
      {project && <ProjectView onBack={() => undefined} />}
      <Toasts />
    </>
  );
}
