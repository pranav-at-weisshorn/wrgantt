import { useMemo, useState } from 'react';
import {
  CONSTRAINT_LABEL,
  STATUS_LABEL,
  TASK_STATUSES,
  type ConstraintType,
  type TaskStatus,
} from '../../engine';
import { bulkTargets, bulkUpdate, type BulkChanges } from '../../store/ops';
import { useStore } from '../../store/store';
import { parseDuration } from '../format';
import { workingDaysPerWeek } from '../../engine';
import { responsibleParties } from '../rows';
import { Modal } from './Modal';
import './bulk-edit.css';

const SET_CONSTRAINTS = (Object.keys(CONSTRAINT_LABEL) as ConstraintType[]).filter(
  (t) => t !== 'ASAP',
);

type ResponsibleMode = 'keep' | 'set' | 'clear';

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** Change the same properties of several tasks in one step. Every field starts unchanged. */
export function BulkEditDialog({ taskIds }: { taskIds: string[] }) {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const parties = useMemo(() => responsibleParties(project), [project]);
  const targets = useMemo(() => bulkTargets(project, taskIds), [project, taskIds]);
  const [form, setForm] = useState({
    status: '' as TaskStatus | '',
    pct: '',
    respMode: 'keep' as ResponsibleMode,
    responsible: '',
    duration: '',
    worstCase: '',
    calendarId: '',
    cType: '' as ConstraintType | '',
    cDate: '',
    shift: '',
    notes: '',
  });
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setError(null);
  };

  const { all, summaries, work } = targets;
  const topLevelOnly = summaries.every((id) => !project.tasks.find((t) => t.id === id)?.parentId);
  const summaryNoun = topLevelOnly ? 'phase' : 'summary task';

  const apply = () => {
    const changes: BulkChanges = {};
    if (form.status) changes.status = form.status;
    if (form.pct.trim() !== '') {
      const n = Number(form.pct);
      if (!Number.isFinite(n) || n < 0 || n > 100) return setError('% complete must be 0 to 100');
      changes.percentComplete = n;
    }
    if (form.respMode === 'set') {
      if (!form.responsible.trim()) return setError('Enter who is responsible, or leave unchanged');
      changes.responsible = form.responsible.trim();
    } else if (form.respMode === 'clear') changes.responsible = '';
    if (form.duration.trim() !== '') {
      const d = parseDuration(form.duration, workingDaysPerWeek(project));
      if (d === null) {
        return setError('Duration must be a number of working days (0 = milestone)');
      }
      changes.duration = d;
    }
    if (form.worstCase.trim() !== '') {
      const w = Number(form.worstCase);
      if (!Number.isInteger(w) || w < 0) {
        return setError('Worst-case time must be a whole number of working days (0 removes it)');
      }
      changes.worstCaseDays = w;
    }
    if (form.calendarId) changes.calendarId = form.calendarId;
    if (form.cType === 'ASAP') changes.constraint = { type: 'ASAP' };
    else if (form.cType) {
      if (!form.cDate) return setError('Choose a date for the constraint');
      changes.constraint = { type: form.cType, date: form.cDate };
    }
    if (form.shift.trim() !== '') {
      const n = Number(form.shift);
      if (!Number.isInteger(n))
        return setError('Shift the start by a whole number of working days');
      if (n !== 0) changes.shiftStartBy = n;
    }
    if (form.notes.trim()) changes.appendNotes = form.notes;
    if (!Object.keys(changes).length) return setError('Choose at least one thing to change');
    const res = bulkUpdate(taskIds, changes, { quiet: true });
    if (!res.ok) return setError(res.error ?? 'The change could not be applied');
    setDialog(null);
  };

  const shifting = form.shift.trim() !== '' && Number(form.shift) !== 0;

  return (
    <Modal
      title={`Edit ${all.length} tasks`}
      onClose={() => setDialog(null)}
      testId="bulk-dialog"
      footer={
        <>
          <button className="btn" onClick={() => setDialog(null)}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply} data-testid="bulk-ok">
            OK
          </button>
        </>
      }
    >
      <div className="modal-body">
        {summaries.length > 0 && (
          <p className="hint bulk-note" data-testid="bulk-summary-note">
            Duration, progress and dates change the subtasks of the{' '}
            {summaries.length === 1 ? `${summaryNoun}` : plural(summaries.length, summaryNoun)}{' '}
            selected ({plural(work.length, 'work task')} in total). Responsible and notes are also
            set on the {summaryNoun} rows themselves.
          </p>
        )}
        <form
          className="form bulk-form"
          onSubmit={(e) => {
            e.preventDefault();
            apply();
          }}
        >
          <label htmlFor="bk-status">Status</label>
          <select
            id="bk-status"
            className="select"
            value={form.status}
            onChange={(e) => set({ status: e.target.value as TaskStatus | '' })}
          >
            <option value="">Leave unchanged</option>
            {TASK_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>

          <label htmlFor="bk-pct">% complete</label>
          <div className="row-inline">
            <input
              id="bk-pct"
              className="input num"
              type="number"
              min={0}
              max={100}
              placeholder="Leave unchanged"
              value={form.pct}
              onChange={(e) => set({ pct: e.target.value })}
            />
            {form.status && form.pct.trim() !== '' && (
              <span className="hint">Progress is applied first, then the status.</span>
            )}
          </div>

          <label htmlFor="bk-resp-mode">Responsible</label>
          <div className="row-inline">
            <select
              id="bk-resp-mode"
              className="select"
              value={form.respMode}
              onChange={(e) => set({ respMode: e.target.value as ResponsibleMode })}
            >
              <option value="keep">Leave unchanged</option>
              <option value="set">Set to…</option>
              <option value="clear">Clear</option>
            </select>
            {form.respMode === 'set' && (
              <input
                className="input"
                list="bk-parties"
                value={form.responsible}
                onChange={(e) => set({ responsible: e.target.value })}
                aria-label="Responsible party"
              />
            )}
            <datalist id="bk-parties">
              {parties.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          </div>

          <label htmlFor="bk-duration">Duration</label>
          <div className="row-inline">
            <input
              id="bk-duration"
              className="input num"
              placeholder="Leave unchanged"
              value={form.duration}
              onChange={(e) => set({ duration: e.target.value })}
            />
            <span className="hint">Working days; 0 = milestone</span>
          </div>

          <label htmlFor="bk-worst">Worst case</label>
          <div className="row-inline">
            <input
              id="bk-worst"
              className="input num"
              placeholder="Leave unchanged"
              value={form.worstCase}
              onChange={(e) => set({ worstCase: e.target.value })}
            />
            <span className="hint">Extra working days; 0 removes it</span>
          </div>

          <label htmlFor="bk-cal">Calendar</label>
          <select
            id="bk-cal"
            className="select"
            value={form.calendarId}
            onChange={(e) => set({ calendarId: e.target.value })}
          >
            <option value="">Leave unchanged</option>
            {project.calendars.map((cal) => (
              <option key={cal.id} value={cal.id}>
                {cal.name}
              </option>
            ))}
          </select>

          <label htmlFor="bk-ct">Constraint</label>
          <div className="row-inline">
            <select
              id="bk-ct"
              className="select"
              value={form.cType}
              onChange={(e) => set({ cType: e.target.value as ConstraintType | '' })}
            >
              <option value="">Leave unchanged</option>
              <option value="ASAP">Remove (as soon as possible)</option>
              {SET_CONSTRAINTS.map((t) => (
                <option key={t} value={t}>
                  {CONSTRAINT_LABEL[t]}
                </option>
              ))}
            </select>
            {form.cType !== '' && form.cType !== 'ASAP' && (
              <input
                type="date"
                className="input"
                value={form.cDate}
                onChange={(e) => set({ cDate: e.target.value })}
                aria-label="Constraint date"
              />
            )}
          </div>

          <label htmlFor="bk-shift">Shift start by</label>
          <div className="row-inline">
            <input
              id="bk-shift"
              className="input num"
              type="number"
              step={1}
              placeholder="Leave unchanged"
              value={form.shift}
              onChange={(e) => set({ shift: e.target.value })}
            />
            <span className="hint">
              Working days; negative moves earlier. Sets a “Start no earlier than” constraint
              {shifting && form.cType !== '' ? ', replacing the constraint chosen above' : ''}.
            </span>
          </div>

          <label htmlFor="bk-notes">Add to notes</label>
          <textarea
            id="bk-notes"
            className="textarea"
            rows={3}
            placeholder="Leave unchanged"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </form>
        {error && (
          <p className="err" role="alert" data-testid="bulk-error">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}
