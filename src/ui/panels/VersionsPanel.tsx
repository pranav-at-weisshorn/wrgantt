import { format } from 'date-fns';
import { useCallback, useEffect, useState } from 'react';
import { days } from '../../engine';
import { downloadBlob, safeFileName } from '../../io/files';
import {
  createVersion,
  defaultVersionName,
  deleteVersion,
  diffProjects,
  listVersions,
  loadVersionFile,
  loadVersionProject,
  renameVersion,
  type ProjectDiff,
  type VersionMeta,
} from '../../io/versions';
import { useStore } from '../../store/store';
import { Modal } from '../dialogs/Modal';
import { fmtIso } from '../format';
import './versions.css';

const MAX_CHANGED = 50;
const MAX_NAMES = 8;

const when = (iso: string) => format(new Date(iso), 'd MMM yyyy, HH:mm');
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const toast = (text: string, kind: 'info' | 'error' = 'info') =>
  useStore.getState().toast(text, kind);

interface Comparison {
  version: VersionMeta;
  diff: ProjectDiff;
}

export function VersionsPanel() {
  const project = useStore((s) => s.project)!;
  const readOnly = useStore((s) => s.readOnly);
  const setDialog = useStore((s) => s.setDialog);
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);

  const reload = useCallback(async () => {
    try {
      setVersions(await listVersions(project.id));
    } catch (e) {
      setVersions([]);
      toast(`Could not read the saved versions: ${message(e)}`, 'error');
    }
  }, [project.id]);
  useEffect(() => {
    void reload();
  }, [reload]);

  const startSave = () => {
    setName(defaultVersionName(new Date()));
    setSaving(true);
  };

  const save = async () => {
    const current = useStore.getState().project;
    if (!current) return;
    try {
      const v = await createVersion(current, {
        name: name.trim() || defaultVersionName(new Date()),
        kind: 'manual',
      });
      setSaving(false);
      toast(`Saved version “${v.name}”`);
    } catch (e) {
      toast(`Could not save the version: ${message(e)}`, 'error');
    }
    await reload();
  };

  const compare = async (v: VersionMeta) => {
    try {
      const older = await loadVersionProject(v.id);
      const current = useStore.getState().project;
      if (!older || !current) throw new Error('The saved version could not be found');
      setComparison({ version: v, diff: diffProjects(older, current) });
    } catch (e) {
      toast(`Could not compare: ${message(e)}`, 'error');
    }
  };

  const restore = (v: VersionMeta) => {
    setDialog({
      kind: 'confirm',
      title: 'Restore this version?',
      message: `The project goes back to “${v.name}” (${when(v.createdAt)}): tasks, links, calendars, baselines and dates. The project name stays. The current state is saved first as an automatic version, and you can undo the restore.`,
      confirmLabel: 'Restore',
      onConfirm: () => void doRestore(v),
    });
  };

  const doRestore = async (v: VersionMeta) => {
    try {
      const snap = await loadVersionProject(v.id);
      const current = useStore.getState().project;
      if (!snap || !current) throw new Error('The saved version could not be found');
      await createVersion(current, {
        name: `Before restoring “${v.name}”`,
        kind: 'auto',
        reason: 'Created automatically before restoring a version',
      });
      const result = useStore.getState().commit(
        `Restore version “${v.name}”`,
        (draft) => {
          draft.tasks = snap.tasks;
          draft.dependencies = snap.dependencies;
          draft.calendars = snap.calendars;
          draft.baselines = snap.baselines;
          if (snap.activeBaselineId) draft.activeBaselineId = snap.activeBaselineId;
          else delete draft.activeBaselineId;
          draft.startDate = snap.startDate;
          draft.statusDate = snap.statusDate;
          draft.projectCalendarId = snap.projectCalendarId;
          draft.criticalFloatThreshold = snap.criticalFloatThreshold;
        },
        { structural: true },
      );
      if (result.ok) toast(`Restored “${v.name}”. Undo (Ctrl+Z) takes it back.`);
    } catch (e) {
      toast(`Could not restore: ${message(e)}`, 'error');
    }
    await reload();
  };

  const download = async (v: VersionMeta) => {
    try {
      const file = await loadVersionFile(v.id);
      if (!file) throw new Error('The saved version could not be found');
      downloadBlob(
        JSON.stringify(file, null, 2),
        `${safeFileName(project.name)} - ${safeFileName(v.name)}.gantt.json`,
        'application/json',
      );
    } catch (e) {
      toast(`Could not download: ${message(e)}`, 'error');
    }
  };

  const doRename = async () => {
    if (!renaming) return;
    const { id, name: next } = renaming;
    setRenaming(null);
    try {
      await renameVersion(project.id, id, next);
    } catch (e) {
      toast(`Could not rename: ${message(e)}`, 'error');
    }
    await reload();
  };

  const remove = (v: VersionMeta) => {
    setDialog({
      kind: 'confirm',
      title: 'Delete this version?',
      message: `“${v.name}” (${when(v.createdAt)}) will be deleted from this browser${v.file ? ' and from the folder' : ''}. This cannot be undone.`,
      confirmLabel: 'Delete',
      onConfirm: () => {
        void deleteVersion(project.id, v.id)
          .catch((e) => toast(`Could not delete: ${message(e)}`, 'error'))
          .then(reload);
      },
    });
  };

  return (
    <div className="versions" data-testid="versions-list">
      {saving ? (
        <form
          className="versions-save"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="version-name" className="hint">
            Name for this version
          </label>
          <input
            id="version-name"
            className="input"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setSaving(false)}
            data-testid="version-name"
          />
          <div className="row-inline">
            <button type="submit" className="btn primary small" data-testid="version-save">
              Save
            </button>
            <button type="button" className="btn small" onClick={() => setSaving(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <button className="btn primary" onClick={startSave} data-testid="version-new">
          Save version…
        </button>
      )}
      <p className="hint">
        Versions you save are kept until you delete them. The app also saves one automatic version a
        day, before restoring a version and before loading a newer file from the folder. Automatic
        versions are kept for 30 days, then one per month.
      </p>
      {readOnly && (
        <p className="hint">
          This project is read-only in this tab, so versions cannot be restored.
        </p>
      )}
      {versions === null ? (
        <p className="hint">Loading…</p>
      ) : versions.length === 0 ? (
        <p className="hint">No versions yet.</p>
      ) : (
        <ul className="version-list">
          {versions.map((v) => (
            <li key={v.id} className="version" data-testid="version-item">
              <div className="version-title">
                {renaming?.id === v.id ? (
                  <input
                    className="input"
                    value={renaming.name}
                    autoFocus
                    aria-label="Version name"
                    onChange={(e) => setRenaming({ id: v.id, name: e.target.value })}
                    onBlur={() => void doRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void doRename();
                      else if (e.key === 'Escape') setRenaming(null);
                    }}
                  />
                ) : (
                  <span className="version-name" title={v.reason}>
                    {v.name}
                  </span>
                )}
                {v.kind === 'auto' && <span className="badge">Automatic</span>}
              </div>
              <div className="hint">{when(v.createdAt)}</div>
              <div className="hint">
                {v.summary.finish ? `Finish ${fmtIso(v.summary.finish)}` : 'No tasks'} ·{' '}
                {days(v.summary.taskCount, 'task')} · {v.summary.percentComplete}% complete
              </div>
              <div className="version-actions">
                <button className="btn small ghost" onClick={() => void compare(v)}>
                  Compare
                </button>
                <button
                  className="btn small ghost"
                  disabled={readOnly}
                  onClick={() => restore(v)}
                  data-testid="version-restore"
                >
                  Restore
                </button>
                <button className="btn small ghost" onClick={() => void download(v)}>
                  Download
                </button>
                {v.kind === 'manual' && (
                  <button
                    className="btn small ghost"
                    onClick={() => setRenaming({ id: v.id, name: v.name })}
                  >
                    Rename
                  </button>
                )}
                <button className="btn small ghost danger" onClick={() => remove(v)}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {comparison && <CompareDialog c={comparison} onClose={() => setComparison(null)} />}
    </div>
  );
}

function workingDays(n: number) {
  return n === 0 ? 'no change' : `${n > 0 ? '+' : ''}${days(n, 'working day')}`;
}

function Names({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="compare-names">
      <div className="hint">{title}</div>
      <ul>
        {items.slice(0, MAX_NAMES).map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
      {items.length > MAX_NAMES && <div className="hint">and {items.length - MAX_NAMES} more</div>}
    </div>
  );
}

function CompareDialog({ c, onClose }: { c: Comparison; onClose: () => void }) {
  const { diff, version } = c;
  const shown = diff.changed.slice(0, MAX_CHANGED);
  const arrow = (a: string, b: string) => (a === b ? fmtIso(a) : `${fmtIso(a)} → ${fmtIso(b)}`);
  const nothing =
    !diff.added.length &&
    !diff.removed.length &&
    !diff.renamed.length &&
    !diff.changed.length &&
    !diff.linksAdded.length &&
    !diff.linksRemoved.length;
  return (
    <Modal
      title={`Compare with “${version.name}”`}
      onClose={onClose}
      wide
      testId="compare-dialog"
      footer={
        <button className="btn" onClick={onClose}>
          Close
        </button>
      }
    >
      <div className="modal-body compare">
        <p className="hint">
          The version saved on {when(version.createdAt)} compared with the project as it is now.
        </p>
        <div className="kpi compare-kpi">
          <div>
            <small>Project finish</small>
            <strong data-testid="compare-finish">
              {diff.finishOld && diff.finishNew
                ? diff.finishOld === diff.finishNew
                  ? `${fmtIso(diff.finishNew)} (unchanged)`
                  : `${fmtIso(diff.finishOld)} → ${fmtIso(diff.finishNew)}`
                : '—'}
            </strong>
            {diff.finishChange !== null && diff.finishOld !== diff.finishNew && (
              <span className="hint"> {workingDays(diff.finishChange)}</span>
            )}
          </div>
          <div>
            <small>Tasks</small>
            <strong>
              +{diff.added.length} added, −{diff.removed.length} removed
            </strong>
            <span className="hint"> {diff.renamed.length} renamed</span>
          </div>
          <div>
            <small>Dates or durations changed</small>
            <strong data-testid="compare-changed-count">{diff.changed.length}</strong>
          </div>
          <div>
            <small>Links</small>
            <strong>
              +{diff.linksAdded.length} added, −{diff.linksRemoved.length} removed
            </strong>
          </div>
        </div>
        {nothing && <p>The project is the same as this version.</p>}
        <Names title="Added tasks" items={diff.added.map((t) => t.name)} />
        <Names title="Removed tasks" items={diff.removed.map((t) => t.name)} />
        <Names
          title="Renamed tasks"
          items={diff.renamed.map((t) => `${t.oldName} → ${t.newName}`)}
        />
        {shown.length > 0 && (
          <>
            <p className="hint">
              {diff.changed.length > MAX_CHANGED
                ? `Showing ${MAX_CHANGED} of ${diff.changed.length} tasks with changed dates or durations.`
                : 'Tasks with changed dates or durations (version → now).'}
            </p>
            <div className="compare-table">
              <table className="simple" data-testid="compare-table">
                <thead>
                  <tr>
                    <th>Task</th>
                    <th>Start</th>
                    <th>Finish</th>
                    <th>Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((t) => (
                    <tr key={t.id}>
                      <td>{t.name}</td>
                      <td>{arrow(t.startOld, t.startNew)}</td>
                      <td>{arrow(t.finishOld, t.finishNew)}</td>
                      <td>
                        {t.durationOld === t.durationNew
                          ? days(t.durationNew)
                          : `${days(t.durationOld)} → ${days(t.durationNew)}`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
