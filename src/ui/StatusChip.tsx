import { HEALTH_SIGNAL_LABEL, STATUS_LABEL, type ScheduleHealth, type TaskStatus } from '../engine';
import './grid/grid-status.css';

/** Small pill with a coloured dot and a label: a task status. */
export function StatusChip({ status }: { status: TaskStatus }) {
  return (
    <span className={`chip status-${status}`} data-status={status}>
      <span className="chip-dot" aria-hidden="true" />
      <span className="chip-label">{STATUS_LABEL[status]}</span>
    </span>
  );
}

/** The schedule signal: On track, At risk, Late (or Complete). */
export function SignalChip({ signal }: { signal: ScheduleHealth }) {
  return (
    <span className={`chip signal-${signal}`} data-signal={signal}>
      <span className="chip-dot" aria-hidden="true" />
      <span className="chip-label">{HEALTH_SIGNAL_LABEL[signal]}</span>
    </span>
  );
}
