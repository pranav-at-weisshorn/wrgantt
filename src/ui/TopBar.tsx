import { displayFinishDay } from '../engine';
import { useDerived, useStore } from '../store/store';
import { fmtDay } from './format';
import { Icon } from './icons';
import { FileMenu } from './FileMenu';

export function TopBar({ onBack }: { onBack: () => void }) {
  const project = useStore((s) => s.project)!;
  const derived = useDerived()!;
  const theme = useStore((s) => s.prefs.theme);
  const setPrefs = useStore((s) => s.setPrefs);
  const setDialog = useStore((s) => s.setDialog);
  const { schedule, outline } = derived;
  // Project finish as displayed: the latest inclusive finish of any task.
  let finish = schedule.projectStart;
  for (const id of outline.flat) {
    const c = schedule.calc.get(id);
    if (c) finish = Math.max(finish, displayFinishDay(c));
  }
  const nextTheme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
  return (
    <div className="topbar">
      <button
        className="btn icon ghost"
        onClick={onBack}
        title="All projects"
        aria-label="All projects"
      >
        <Icon name="back" />
      </button>
      <h1 title={project.name}>{project.name}</h1>
      <span className="meta" data-testid="project-dates">
        {fmtDay(schedule.projectStart)} →{' '}
        <strong data-testid="project-finish">{fmtDay(finish)}</strong>
      </span>
      {schedule.errors.length > 0 && <span className="err">{schedule.errors[0]}</span>}
      <span className="spacer" />
      <FileMenu />
      <button className="btn small" onClick={() => setDialog({ kind: 'settings' })}>
        <Icon name="settings" size={14} /> Settings
      </button>
      <button
        className="btn icon"
        onClick={() => setPrefs({ theme: nextTheme })}
        title={`Theme: ${theme} (click for ${nextTheme})`}
        aria-label="Toggle theme"
      >
        <Icon name={theme === 'dark' ? 'moon' : 'sun'} />
      </button>
    </div>
  );
}
