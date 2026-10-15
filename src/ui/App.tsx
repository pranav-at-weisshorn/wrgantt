import { useEffect, useState } from 'react';
import { initDisk } from '../io/diskStore';
import { flushAutosave, openProjectById, releaseProjectLock, startAutosave } from '../io/persist';
import { ensureDailySnapshot } from '../io/versions';
import { useStore } from '../store/store';
import { ProjectList } from './ProjectList';
import { ProjectView } from './ProjectView';
import { Toasts } from './Toasts';

/** `#/` = project list, `#/p/<id>` = a project. */
function parseHash(): string | null {
  const m = /^#\/p\/([\w-]+)/.exec(window.location.hash);
  return m ? m[1] : null;
}

export function App() {
  const project = useStore((s) => s.project);
  const [routeId, setRouteId] = useState<string | null>(parseHash);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    void initDisk();
    return startAutosave();
  }, []);

  useEffect(() => {
    const onHash = () => setRouteId(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    const s = useStore.getState();
    if (!routeId) {
      if (s.project) {
        // Save first, then let another tab take the project.
        const id = s.project.id;
        void flushAutosave().finally(() => releaseProjectLock(id));
        s.closeProject();
      } else releaseProjectLock();
      return;
    }
    if (s.project?.id === routeId) return;
    let cancelled = false;
    setLoading(true);
    void flushAutosave()
      .then(() => openProjectById(routeId))
      .then((opened) => {
        if (cancelled) return;
        if (opened) {
          const st = useStore.getState();
          st.openProject(opened.project);
          if (!opened.locked) {
            // Open in another tab: look, but do not edit or save.
            st.setReadOnly(true);
          } else {
            void ensureDailySnapshot(opened.project).catch(() => undefined);
          }
        } else {
          useStore.getState().toast('Project not found', 'error');
          window.location.hash = '#/';
        }
      })
      .catch((e) => {
        useStore
          .getState()
          .toast(`Could not open project: ${e instanceof Error ? e.message : e}`, 'error');
        window.location.hash = '#/';
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [routeId]);

  const go = (id: string | null) => {
    window.location.hash = id ? `#/p/${id}` : '#/';
  };

  return (
    <>
      {routeId && project && project.id === routeId ? (
        <ProjectView onBack={() => go(null)} />
      ) : routeId ? (
        <div className="plist">{loading ? <p className="hint">Opening…</p> : null}</div>
      ) : (
        <ProjectList onOpen={go} />
      )}
      <Toasts />
    </>
  );
}
