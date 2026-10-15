import { useState } from 'react';
import type { Draft } from 'immer';
import {
  days,
  DEP_TYPE_HELP,
  DEP_TYPE_LABEL,
  displayFinishDay,
  newId,
  type ConstraintType,
  type Dependency,
  type DepType,
  type LagUnit,
  type Task,
} from '../../engine';
import { derive } from '../../store/derive';
import { useStore } from '../../store/store';
import { fmtDay, parseDuration } from '../format';
import { Modal } from './Modal';

type Tab = 'general' | 'predecessors' | 'successors' | 'notes';

const CONSTRAINTS: { v: ConstraintType; label: string }[] = [
  { v: 'ASAP', label: 'As soon as possible' },
  { v: 'SNET', label: 'Start no earlier than' },
  { v: 'SNLT', label: 'Start no later than' },
  { v: 'FNET', label: 'Finish no earlier than' },
  { v: 'FNLT', label: 'Finish no later than' },
  { v: 'MSO', label: 'Must start on' },
  { v: 'MFO', label: 'Must finish on' },
];

export function TaskDialog({ taskId, tab: initialTab }: { taskId: string; tab?: Tab }) {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const commit = useStore((s) => s.commit);
  const { outline, schedule } = derive(project);
  const task = outline.byId.get(taskId);
  const isSummary = outline.isSummary(taskId);
  const [tab, setTab] = useState<Tab>(initialTab ?? 'general');
  const [form, setForm] = useState(() => ({
    name: task?.name ?? '',
    duration: String(task?.duration ?? 0),
    calendarId: task?.calendarId ?? project.projectCalendarId,
    cType: task?.constraint.type ?? 'ASAP',
    cDate: task?.constraint.date ?? '',
    responsible: task?.responsible ?? '',
    pct: String(task?.percentComplete ?? 0),
    actualStart: task?.actualStart ?? '',
    actualFinish: task?.actualFinish ?? '',
    notes: task?.notes ?? '',
  }));
  const [links, setLinks] = useState<Dependency[]>(() =>
    project.dependencies
      .filter((d) => d.predecessorId === taskId || d.successorId === taskId)
      .map((d) => ({ ...d })),
  );
  const [error, setError] = useState<string | null>(null);
  const [newPred, setNewPred] = useState('');
  const [newSucc, setNewSucc] = useState('');

  if (!task) return null;
  const close = () => setDialog(null);
  const c = schedule.calc.get(taskId);
  const byRow = new Map(project.tasks.map((t) => [t.rowId, t]));
  const byId = outline.byId;

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const save = () => {
    const dur = parseDuration(form.duration);
    if (!isSummary && dur === null)
      return setError('Duration must be a number of working days (0 = milestone)');
    const pct = Number(form.pct);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100)
      return setError('% complete must be between 0 and 100');
    if (form.cType !== 'ASAP' && !form.cDate) return setError('Choose a date for the constraint');
    if (form.actualStart && form.actualFinish && form.actualFinish < form.actualStart) {
      return setError('Actual finish is before actual start');
    }
    const res = commit(
      'Edit task',
      (d) => {
        const t = d.tasks.find((x) => x.id === taskId) as Draft<Task>;
        t.name = form.name.trim() || 'Untitled';
        t.responsible = form.responsible.trim();
        t.notes = form.notes;
        if (!isSummary) {
          t.duration = dur!;
          t.calendarId = form.calendarId;
          t.constraint =
            form.cType === 'ASAP' ? { type: 'ASAP' } : { type: form.cType, date: form.cDate };
          t.percentComplete = Math.round(pct);
          if (form.actualStart) t.actualStart = form.actualStart;
          else delete t.actualStart;
          if (form.actualFinish) t.actualFinish = form.actualFinish;
          else delete t.actualFinish;
          if (t.percentComplete === 100 && !t.actualFinish && c) {
            // Completed without an actual finish: take the scheduled one.
            t.actualStart = t.actualStart ?? c.earlyStart;
          }
        }
        d.dependencies = [
          ...d.dependencies.filter((x) => x.predecessorId !== taskId && x.successorId !== taskId),
          ...links,
        ];
      },
      { quiet: true },
    );
    if (!res.ok) return setError(res.error ?? 'Could not save');
    close();
  };

  const addLink = (dir: 'pred' | 'succ', text: string) => {
    const rowId = parseInt(text, 10);
    const other = byRow.get(rowId);
    if (!other) return setError(`Unknown task ID ${text}`);
    if (other.id === taskId) return setError('A task cannot depend on itself');
    const predecessorId = dir === 'pred' ? other.id : taskId;
    const successorId = dir === 'pred' ? taskId : other.id;
    if (links.some((l) => l.predecessorId === predecessorId && l.successorId === successorId)) {
      return setError('These tasks are already linked');
    }
    setError(null);
    setLinks([
      ...links,
      { id: newId(), predecessorId, successorId, type: 'FS', lag: 0, lagUnit: 'wd' },
    ]);
    if (dir === 'pred') setNewPred('');
    else setNewSucc('');
  };

  const linkTable = (dir: 'pred' | 'succ') => {
    const list = links.filter((l) =>
      dir === 'pred' ? l.successorId === taskId : l.predecessorId === taskId,
    );
    const value = dir === 'pred' ? newPred : newSucc;
    return (
      <div className="modal-body">
        <table className="simple">
          <thead>
            <tr>
              <th style={{ width: 50 }}>ID</th>
              <th>Task</th>
              <th style={{ width: 80 }}>Type</th>
              <th style={{ width: 80 }}>Lag</th>
              <th style={{ width: 120 }}>Unit</th>
              <th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {list.map((l) => {
              const other = byId.get(dir === 'pred' ? l.predecessorId : l.successorId);
              const upd = (patch: Partial<Dependency>) =>
                setLinks(links.map((x) => (x.id === l.id ? { ...x, ...patch } : x)));
              return (
                <tr key={l.id}>
                  <td>{other?.rowId}</td>
                  <td>{other?.name}</td>
                  <td>
                    <select
                      className="select"
                      value={l.type}
                      onChange={(e) => upd({ type: e.target.value as DepType })}
                      aria-label="Link type"
                    >
                      {(['FS', 'SS', 'FF', 'SF'] as DepType[]).map((t) => (
                        <option key={t} value={t} title={DEP_TYPE_HELP[t]}>
                          {DEP_TYPE_LABEL[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      type="number"
                      value={l.lag}
                      style={{ width: 70 }}
                      onChange={(e) => upd({ lag: Math.round(Number(e.target.value) || 0) })}
                      aria-label="Lag"
                    />
                  </td>
                  <td>
                    <select
                      className="select"
                      value={l.lagUnit}
                      onChange={(e) => upd({ lagUnit: e.target.value as LagUnit })}
                      aria-label="Lag unit"
                    >
                      <option value="wd">working days</option>
                      <option value="ed">calendar days</option>
                    </select>
                  </td>
                  <td>
                    <button
                      className="btn icon ghost danger"
                      onClick={() => setLinks(links.filter((x) => x.id !== l.id))}
                      aria-label="Remove link"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
            {list.length === 0 && (
              <tr>
                <td colSpan={6} className="hint">
                  No {dir === 'pred' ? 'predecessors' : 'successors'}.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div className="row-inline" style={{ marginTop: 10 }}>
          <input
            className="input"
            placeholder="Task ID"
            value={value}
            style={{ width: 100 }}
            onChange={(e) => (dir === 'pred' ? setNewPred : setNewSucc)(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addLink(dir, value)}
          />
          <button className="btn" onClick={() => addLink(dir, value)}>
            Add {dir === 'pred' ? 'predecessor' : 'successor'}
          </button>
        </div>
      </div>
    );
  };

  return (
    <Modal
      title={`${task.rowId}. ${task.name}`}
      onClose={close}
      wide
      testId="task-dialog"
      footer={
        <>
          {error && (
            <span className="err" style={{ marginRight: 'auto' }}>
              {error}
            </span>
          )}
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={save}>
            OK
          </button>
        </>
      }
    >
      <div className="tabs" role="tablist">
        {(['general', 'predecessors', 'successors', 'notes'] as Tab[]).map((t) => (
          <button
            key={t}
            className={tab === t ? 'active' : ''}
            onClick={() => setTab(t)}
            role="tab"
            aria-selected={tab === t}
          >
            {t[0].toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>
      {tab === 'general' && (
        <div className="modal-body">
          <div className="form">
            <label htmlFor="td-name">Name</label>
            <input
              id="td-name"
              className="input"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
            />
            <label htmlFor="td-dur">Duration (working days)</label>
            <div className="row-inline">
              <input
                id="td-dur"
                className="input"
                value={isSummary ? String(c?.duration ?? '') : form.duration}
                disabled={isSummary}
                style={{ width: 100 }}
                onChange={(e) => set({ duration: e.target.value })}
              />
              <span className="hint">
                {isSummary
                  ? 'Computed from subtasks'
                  : '0 = milestone; accepts 10, 2 weeks, 1 month'}
              </span>
            </div>
            <label htmlFor="td-cal">Calendar</label>
            <select
              id="td-cal"
              className="select"
              value={form.calendarId}
              disabled={isSummary}
              onChange={(e) => set({ calendarId: e.target.value })}
            >
              {project.calendars.map((cal) => (
                <option key={cal.id} value={cal.id}>
                  {cal.name}
                </option>
              ))}
            </select>
            <label htmlFor="td-ct">Constraint</label>
            <div className="row-inline">
              <select
                id="td-ct"
                className="select"
                value={form.cType}
                disabled={isSummary}
                onChange={(e) => set({ cType: e.target.value as ConstraintType })}
              >
                {CONSTRAINTS.map((x) => (
                  <option key={x.v} value={x.v}>
                    {x.label}
                  </option>
                ))}
              </select>
              {form.cType !== 'ASAP' && (
                <input
                  type="date"
                  className="input"
                  value={form.cDate}
                  onChange={(e) => set({ cDate: e.target.value })}
                  aria-label="Constraint date"
                />
              )}
              {c?.constraintViolated && <span className="err">Conflicts with logic</span>}
            </div>
            <label htmlFor="td-resp">Responsible</label>
            <input
              id="td-resp"
              className="input"
              value={form.responsible}
              onChange={(e) => set({ responsible: e.target.value })}
              list="td-parties"
            />
            <datalist id="td-parties">
              {[...new Set(project.tasks.map((t) => t.responsible).filter(Boolean))].map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
            <label htmlFor="td-pct">% complete</label>
            <input
              id="td-pct"
              className="input"
              type="number"
              min={0}
              max={100}
              value={isSummary ? String(Math.round(c?.percentComplete ?? 0)) : form.pct}
              disabled={isSummary}
              style={{ width: 100 }}
              onChange={(e) => {
                const v = e.target.value;
                const n = Number(v);
                const patch: Partial<typeof form> = { pct: v };
                // Fill actuals from the schedule the first time progress is entered.
                if (n > 0 && !form.actualStart && c) patch.actualStart = c.earlyStart;
                if (n >= 100 && !form.actualFinish && c) {
                  const fin = c.ef > c.es ? c.ef - 1 : c.es;
                  patch.actualFinish = new Date(fin * 86_400_000).toISOString().slice(0, 10);
                }
                set(patch);
              }}
            />
            <label htmlFor="td-as">Actual start</label>
            <input
              id="td-as"
              type="date"
              className="input"
              value={form.actualStart}
              disabled={isSummary}
              onChange={(e) => set({ actualStart: e.target.value })}
            />
            <label htmlFor="td-af">Actual finish</label>
            <input
              id="td-af"
              type="date"
              className="input"
              value={form.actualFinish}
              disabled={isSummary}
              onChange={(e) => set({ actualFinish: e.target.value })}
            />
            {c && (
              <p className="hint full">
                Early {fmtDay(c.es)} – {fmtDay(displayFinishDay(c))} · Late {fmtDay(c.ls)} –{' '}
                {fmtDay(c.lf > c.ls ? c.lf - 1 : c.ls)} · Total float {days(c.totalFloat)} · Free
                float {days(c.freeFloat)}
              </p>
            )}
          </div>
        </div>
      )}
      {tab === 'predecessors' && linkTable('pred')}
      {tab === 'successors' && linkTable('succ')}
      {tab === 'notes' && (
        <div className="modal-body">
          <textarea
            className="textarea"
            rows={12}
            style={{ width: '100%' }}
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            aria-label="Notes"
          />
        </div>
      )}
    </Modal>
  );
}
