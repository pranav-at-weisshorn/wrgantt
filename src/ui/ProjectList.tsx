import { useCallback, useEffect, useState } from 'react';
import { newId, type Project } from '../engine';
import {
  deleteProject,
  listProjects,
  loadProject,
  saveProject,
  type ProjectMeta,
} from '../io/persist';
import { useStore } from '../store/store';
import { defaultStartDate, emptyProject, projectFromTemplate } from '../template/load';
import { Modal } from './dialogs/Modal';
import { fmtIso } from './format';
import { Icon } from './icons';
import { ImportButtons } from './ImportButtons';

type Pending =
  | { kind: 'new'; template: boolean }
  | { kind: 'rename'; meta: ProjectMeta }
  | { kind: 'delete'; meta: ProjectMeta }
  | null;

export function ProjectList({ onOpen }: { onOpen: (id: string) => void }) {
  const [list, setList] = useState<ProjectMeta[] | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [name, setName] = useState('');
  const [start, setStart] = useState(defaultStartDate());
  const toast = useStore((s) => s.toast);

  const refresh = useCallback(() => {
    listProjects()
      .then(setList)
      .catch((e) => {
        setList([]);
        toast(`Could not read saved projects: ${e instanceof Error ? e.message : e}`, 'error');
      });
  }, [toast]);
  useEffect(refresh, [refresh]);

  const create = async (p: Project) => {
    await saveProject(p);
    onOpen(p.id);
  };

  const duplicate = async (meta: ProjectMeta) => {
    const p = await loadProject(meta.id);
    if (!p) return;
    const copy: Project = { ...p, id: newId(), name: `${p.name} (copy)` };
    await saveProject(copy);
    refresh();
    toast(`Duplicated “${p.name}”`);
  };

  const confirm = async () => {
    if (!pending) return;
    if (pending.kind === 'new') {
      const n = name.trim() || (pending.template ? 'Condo development' : 'New project');
      const p = pending.template ? projectFromTemplate(n, start) : emptyProject(n, start);
      setPending(null);
      await create(p);
    } else if (pending.kind === 'rename') {
      const p = await loadProject(pending.meta.id);
      if (p) await saveProject({ ...p, name: name.trim() || p.name });
      setPending(null);
      refresh();
    } else if (pending.kind === 'delete') {
      await deleteProject(pending.meta.id);
      setPending(null);
      refresh();
      toast(`Deleted “${pending.meta.name}”`);
    }
  };

  return (
    <div className="app" style={{ overflow: 'auto' }}>
      <div className="plist">
        <div className="plist-brand">
          <span className="wordmark">Villa Felstead</span>
          <span className="hint">A real estate project by Weisshorn</span>
        </div>
        <h1>Project schedules</h1>
        <p className="hint">
          Projects are saved in this browser (IndexedDB). Export to .gantt.json to back up or share.
        </p>
        <div className="actions">
          <button
            className="btn primary"
            onClick={() => {
              setName('Condo development');
              setStart(defaultStartDate());
              setPending({ kind: 'new', template: true });
            }}
            data-testid="new-from-template"
          >
            <Icon name="plus" size={14} /> New project from template
          </button>
          <button
            className="btn"
            onClick={() => {
              setName('New project');
              setStart(defaultStartDate());
              setPending({ kind: 'new', template: false });
            }}
          >
            New blank project
          </button>
          <ImportButtons onImported={create} />
        </div>
        {list === null ? (
          <p className="hint">Loading…</p>
        ) : list.length === 0 ? (
          <div className="empty">
            No projects yet. Start from the condominium template to get the full development
            lifecycle.
          </div>
        ) : (
          <table data-testid="project-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Start</th>
                <th>Tasks</th>
                <th>Last saved</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((m) => (
                <tr key={m.id}>
                  <td className="name">
                    <button onClick={() => onOpen(m.id)}>{m.name}</button>
                  </td>
                  <td>{fmtIso(m.startDate)}</td>
                  <td>{m.taskCount}</td>
                  <td>{new Date(m.updatedAt).toLocaleString()}</td>
                  <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    <button
                      className="btn small ghost"
                      onClick={() => {
                        setName(m.name);
                        setPending({ kind: 'rename', meta: m });
                      }}
                    >
                      Rename
                    </button>
                    <button className="btn small ghost" onClick={() => duplicate(m)}>
                      Duplicate
                    </button>
                    <button
                      className="btn small ghost danger"
                      onClick={() => setPending({ kind: 'delete', meta: m })}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {pending && (
        <Modal
          title={
            pending.kind === 'new'
              ? pending.template
                ? 'New project from condo template'
                : 'New blank project'
              : pending.kind === 'rename'
                ? 'Rename project'
                : 'Delete project?'
          }
          onClose={() => setPending(null)}
          footer={
            <>
              <button className="btn" onClick={() => setPending(null)}>
                Cancel
              </button>
              <button className="btn primary" onClick={confirm} data-testid="confirm">
                {pending.kind === 'delete'
                  ? 'Delete'
                  : pending.kind === 'rename'
                    ? 'Rename'
                    : 'Create'}
              </button>
            </>
          }
        >
          <div className="modal-body">
            {pending.kind === 'delete' ? (
              <p>
                Permanently delete “{pending.meta.name}” from this browser? This cannot be undone.
                Export it first if you might need it.
              </p>
            ) : (
              <div className="form">
                <label htmlFor="pl-name">Name</label>
                <input
                  id="pl-name"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && confirm()}
                />
                {pending.kind === 'new' && (
                  <>
                    <label htmlFor="pl-start">Start date</label>
                    <input
                      id="pl-start"
                      className="input"
                      type="date"
                      value={start}
                      onChange={(e) => setStart(e.target.value)}
                    />
                  </>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  );
}
