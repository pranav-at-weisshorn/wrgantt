import { useState } from 'react';
import type { Draft } from 'immer';
import { isValidIso, newId, type Calendar, type Project } from '../../engine';
import { useStore } from '../../store/store';
import { fmtIso, parseDateInput } from '../format';
import { Modal } from './Modal';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SettingsDialog() {
  const project = useStore((s) => s.project)!;
  const setDialog = useStore((s) => s.setDialog);
  const commit = useStore((s) => s.commit);
  const [name, setName] = useState(project.name);
  const [startDate, setStartDate] = useState(project.startDate);
  const [projCal, setProjCal] = useState(project.projectCalendarId);
  const [threshold, setThreshold] = useState(String(project.criticalFloatThreshold));
  const [cals, setCals] = useState<Calendar[]>(() =>
    project.calendars.map((c) => ({ ...c, holidays: [...c.holidays] })),
  );
  const [calId, setCalId] = useState(project.projectCalendarId);
  const [holidayText, setHolidayText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const close = () => setDialog(null);
  const cal = cals.find((c) => c.id === calId) ?? cals[0];

  const updCal = (patch: Partial<Calendar>) =>
    setCals(cals.map((c) => (c.id === cal.id ? { ...c, ...patch } : c)));

  const addHolidays = () => {
    // Accept one or many dates separated by commas, semicolons or new lines.
    const parts = holidayText
      .split(/[\n,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    const bad: string[] = [];
    const add: string[] = [];
    for (const p of parts) {
      const iso = parseDateInput(p);
      if (iso) add.push(iso);
      else bad.push(p);
    }
    if (bad.length) return setError(`Could not read: ${bad.join(', ')}`);
    setError(null);
    updCal({ holidays: [...new Set([...cal.holidays, ...add])].sort() });
    setHolidayText('');
  };

  const save = () => {
    if (!isValidIso(startDate)) return setError('Enter a valid start date');
    const th = Number(threshold);
    if (!Number.isFinite(th)) return setError('Critical float threshold must be a number');
    if (cals.some((c) => c.workingWeekdays.length === 0))
      return setError('Every calendar needs at least one working weekday');
    const r = commit('Project settings', (d: Draft<Project>) => {
      d.name = name.trim() || d.name;
      // Moving the start also moves the status date if it was still at the old start.
      if (d.statusDate === d.startDate) d.statusDate = startDate;
      d.startDate = startDate;
      d.criticalFloatThreshold = Math.round(th);
      d.calendars = cals as Draft<Calendar>[];
      const ids = new Set(cals.map((c) => c.id));
      d.projectCalendarId = ids.has(projCal) ? projCal : cals[0].id;
      for (const t of d.tasks) if (!ids.has(t.calendarId)) t.calendarId = d.projectCalendarId;
    });
    if (r.ok) close();
    else setError(r.error ?? 'Could not save');
  };

  return (
    <Modal
      title="Project settings"
      onClose={close}
      wide
      testId="settings-dialog"
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
            Save
          </button>
        </>
      }
    >
      <div className="modal-body">
        <div className="form">
          <label htmlFor="ps-name">Project name</label>
          <input
            id="ps-name"
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <label htmlFor="ps-start">Start date</label>
          <input
            id="ps-start"
            className="input"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
          />
          <label htmlFor="ps-cal">Project calendar</label>
          <select
            id="ps-cal"
            className="select"
            value={projCal}
            onChange={(e) => setProjCal(e.target.value)}
          >
            {cals.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label htmlFor="ps-th">Critical if total float ≤</label>
          <div className="row-inline">
            <input
              id="ps-th"
              className="input"
              type="number"
              value={threshold}
              style={{ width: 80 }}
              onChange={(e) => setThreshold(e.target.value)}
            />
            <span className="hint">working days</span>
          </div>
        </div>

        <h3 style={{ fontSize: 14, margin: '20px 0 8px' }}>Calendars</h3>
        <div className="row-inline" style={{ marginBottom: 10 }}>
          <select
            className="select"
            value={cal.id}
            onChange={(e) => setCalId(e.target.value)}
            aria-label="Calendar to edit"
          >
            {cals.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className="input"
            value={cal.name}
            onChange={(e) => updCal({ name: e.target.value })}
            aria-label="Calendar name"
          />
          <button
            className="btn"
            onClick={() => {
              const c: Calendar = {
                id: newId(),
                name: `${cal.name} copy`,
                workingWeekdays: [...cal.workingWeekdays],
                holidays: [...cal.holidays],
              };
              setCals([...cals, c]);
              setCalId(c.id);
            }}
          >
            Duplicate
          </button>
          <button
            className="btn danger"
            disabled={cals.length <= 1 || cal.id === projCal}
            title={cal.id === projCal ? 'The project calendar cannot be deleted' : undefined}
            onClick={() => {
              const rest = cals.filter((c) => c.id !== cal.id);
              setCals(rest);
              setCalId(rest[0].id);
            }}
          >
            Delete
          </button>
        </div>
        <div className="form">
          <label>Working days</label>
          <div className="row-inline">
            {DAYS.map((d, i) => (
              <label key={d} className="row-inline" style={{ gap: 4, color: 'var(--fg)' }}>
                <input
                  type="checkbox"
                  checked={cal.workingWeekdays.includes(i)}
                  onChange={(e) =>
                    updCal({
                      workingWeekdays: e.target.checked
                        ? [...cal.workingWeekdays, i].sort()
                        : cal.workingWeekdays.filter((x) => x !== i),
                    })
                  }
                />
                {d}
              </label>
            ))}
          </div>
          <label htmlFor="ps-hol">Add holidays</label>
          <div className="row-inline">
            <textarea
              id="ps-hol"
              className="textarea"
              rows={2}
              style={{ flex: 1, minWidth: 220 }}
              placeholder="One or more dates, e.g. 2027-01-01, 25.12.2027"
              value={holidayText}
              onChange={(e) => setHolidayText(e.target.value)}
            />
            <button className="btn" onClick={addHolidays} disabled={!holidayText.trim()}>
              Add
            </button>
          </div>
          <label>Holidays ({cal.holidays.length})</label>
          <div
            style={{
              maxHeight: 160,
              overflow: 'auto',
              border: '1px solid var(--border)',
              borderRadius: 6,
              padding: 4,
            }}
          >
            {cal.holidays.length === 0 && <span className="hint">None yet.</span>}
            {cal.holidays.map((h) => (
              <div
                key={h}
                className="row-inline"
                style={{ justifyContent: 'space-between', padding: '2px 4px' }}
              >
                <span>{fmtIso(h)}</span>
                <button
                  className="btn small ghost danger"
                  onClick={() => updCal({ holidays: cal.holidays.filter((x) => x !== h) })}
                  aria-label={`Remove ${h}`}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}
