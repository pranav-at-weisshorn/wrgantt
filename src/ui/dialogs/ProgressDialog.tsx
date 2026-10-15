import { useMemo, useState } from 'react';
import { dayToIso, displayFinishDay, isoToDay, isValidIso } from '../../engine';
import { derive } from '../../store/derive';
import { applyProgress, onSchedulePercent, type ProgressEntry } from '../../store/ops';
import { useStore } from '../../store/store';
import { fmtDay } from '../format';
import { Modal } from './Modal';

/**
 * Update progress as of the status date. Lists the leaf tasks that were scheduled to start by
 * the status date and are not yet complete (plus any already in progress).
 */
export function ProgressDialog() {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const toast = useStore((s) => s.toast);
  const [status, setStatus] = useState(project.statusDate);
  const close = () => setDialog(null);
  const { outline, schedule } = derive(project);
  const statusDay = isValidIso(status) ? isoToDay(status) : isoToDay(project.statusDate);

  const candidates = useMemo(
    () =>
      outline.flat.filter((id) => {
        if (outline.isSummary(id)) return false;
        const c = schedule.calc.get(id)!;
        const t = outline.byId.get(id)!;
        return c.percentComplete < 100 && (c.es < statusDay || t.percentComplete > 0);
      }),
    [outline, schedule, statusDay],
  );

  const [edits, setEdits] = useState<Record<string, ProgressEntry>>({});
  const entry = (id: string): ProgressEntry => {
    const t = outline.byId.get(id)!;
    return (
      edits[id] ?? {
        id,
        percentComplete: t.percentComplete,
        actualStart: t.actualStart,
        actualFinish: t.actualFinish,
      }
    );
  };
  const put = (e: ProgressEntry) => setEdits((x) => ({ ...x, [e.id]: e }));

  const markComplete = (id: string) => {
    const c = schedule.calc.get(id)!;
    const cur = entry(id);
    const start = cur.actualStart ?? dayToIso(c.es);
    // Finished by the status date at the latest, never before it started.
    const fin = Math.max(isoToDay(start), Math.min(displayFinishDay(c), statusDay - 1));
    put({ id, percentComplete: 100, actualStart: start, actualFinish: dayToIso(fin) });
  };

  const onSchedule = (id: string) => {
    const p = onSchedulePercent(project, id, statusDay);
    if (p) put(p);
  };

  const apply = () => {
    if (!isValidIso(status)) return toast('Enter a valid status date', 'error');
    const list = Object.values(edits);
    if (list.length || status !== project.statusDate) applyProgress(list, status);
    toast(
      list.length
        ? `Updated progress on ${list.length} task${list.length === 1 ? '' : 's'}`
        : 'Status date updated',
    );
    close();
  };

  return (
    <Modal
      title="Update progress"
      onClose={close}
      wide
      testId="progress-dialog"
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button className="btn primary" onClick={apply} data-testid="apply-progress">
            Apply
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="row-inline" style={{ marginBottom: 12 }}>
          <label htmlFor="pg-status">
            <strong>Status date</strong>
          </label>
          <input
            id="pg-status"
            className="input"
            type="date"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          />
          <span className="hint">
            Remaining work is scheduled from this date; unstarted tasks cannot start before it.
          </span>
        </div>
        <div className="row-inline" style={{ marginBottom: 8 }}>
          <span className="hint" style={{ flex: 1 }}>
            {candidates.length} task{candidates.length === 1 ? '' : 's'} due to have started by{' '}
            {fmtDay(statusDay)}.
          </span>
          <button
            className="btn small"
            disabled={!candidates.length}
            onClick={() => candidates.forEach(onSchedule)}
          >
            Set all to on-schedule progress
          </button>
        </div>
        <div style={{ maxHeight: '50vh', overflow: 'auto' }}>
          <table className="simple">
            <thead>
              <tr>
                <th style={{ width: 40 }}>ID</th>
                <th>Task</th>
                <th style={{ width: 100 }}>Planned</th>
                <th style={{ width: 70 }}>%</th>
                <th style={{ width: 140 }}>Actual start</th>
                <th style={{ width: 140 }}>Actual finish</th>
                <th style={{ width: 170 }} />
              </tr>
            </thead>
            <tbody>
              {candidates.length === 0 && (
                <tr>
                  <td colSpan={7} className="hint">
                    Nothing was scheduled to start before the status date. Move the status date
                    forward to record progress.
                  </td>
                </tr>
              )}
              {candidates.map((id) => {
                const t = outline.byId.get(id)!;
                const c = schedule.calc.get(id)!;
                const e = entry(id);
                return (
                  <tr key={id}>
                    <td>{t.rowId}</td>
                    <td>{t.name}</td>
                    <td className="hint">
                      {fmtDay(c.es)}
                      <br />
                      {fmtDay(displayFinishDay(c))}
                    </td>
                    <td>
                      <input
                        className="input"
                        type="number"
                        min={0}
                        max={100}
                        value={e.percentComplete}
                        style={{ width: 60 }}
                        onChange={(ev) => {
                          const v = Math.max(0, Math.min(100, Number(ev.target.value) || 0));
                          put({
                            ...e,
                            percentComplete: v,
                            actualStart: v > 0 ? (e.actualStart ?? dayToIso(c.es)) : undefined,
                            actualFinish: v === 100 ? e.actualFinish : undefined,
                          });
                        }}
                        aria-label={`% complete for ${t.name}`}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={e.actualStart ?? ''}
                        onChange={(ev) => put({ ...e, actualStart: ev.target.value || undefined })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        type="date"
                        value={e.actualFinish ?? ''}
                        onChange={(ev) =>
                          put({
                            ...e,
                            actualFinish: ev.target.value || undefined,
                            percentComplete: ev.target.value ? 100 : e.percentComplete,
                          })
                        }
                      />
                    </td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn small"
                        onClick={() => onSchedule(id)}
                        title="Progress as planned up to the status date"
                      >
                        On schedule
                      </button>{' '}
                      <button className="btn small" onClick={() => markComplete(id)}>
                        Complete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </Modal>
  );
}
