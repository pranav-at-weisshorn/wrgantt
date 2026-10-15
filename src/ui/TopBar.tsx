import { displayFinishDay } from '../engine';
import { useDerived, useStore } from '../store/store';
import { fmtDay } from './format';
import { Icon } from './icons';
import { FileMenu } from './FileMenu';
import { StorageStatus } from './StorageStatus';

export function TopBar({ onBack }: { onBack: () => void }) {
  const project = useStore((s) => s.project)!;
  const derived = useDerived()!;
  const setDialog = useStore((s) => s.setDialog);
  const readOnly = useStore((s) => s.readOnly);
  const { schedule, outline } = derived;
  // Project finish as displayed: the latest inclusive finish of any task.
  let finish = schedule.projectStart;
  for (const id of outline.flat) {
    const c = schedule.calc.get(id);
    if (c) finish = Math.max(finish, displayFinishDay(c));
  }
  return (
    <>
      <div className="topbar">
        <button
          className="btn icon ghost"
          onClick={onBack}
          title="All projects"
          aria-label="All projects"
        >
          <Icon name="back" />
        </button>
        <span className="wordmark">Villa Felstead</span>
        <span className="wordmark-sep" />
        <h1 title={project.name}>{project.name}</h1>
        <span className="meta" data-testid="project-dates">
          {fmtDay(schedule.projectStart)} →{' '}
          <strong data-testid="project-finish">{fmtDay(finish)}</strong>
        </span>
        {schedule.errors.length > 0 && <span className="err">{schedule.errors[0]}</span>}
        <span className="spacer" />
        <StorageStatus />
        <FileMenu />
        <button className="btn small" onClick={() => setDialog({ kind: 'settings' })}>
          <Icon name="settings" size={14} /> Settings
        </button>
      </div>
      {readOnly && (
        <div className="readonly-banner" role="status" data-testid="readonly-banner">
          <span>This project is open in another tab. It is read-only here.</span>
          <button className="btn small" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      )}
    </>
  );
}
