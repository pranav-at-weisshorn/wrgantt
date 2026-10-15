import { newId, type Project, type ScheduleResult } from '../engine';
import { readProjectFile, toProjectFile } from './schema';

/** `.gantt.json` text. Derived `calc` values are attached for consumers; import ignores them. */
export function projectToJson(project: Project, schedule?: ScheduleResult): string {
  const file = toProjectFile(project);
  if (schedule) {
    file.project = {
      ...project,
      tasks: project.tasks.map((t) => {
        const c = schedule.calc.get(t.id);
        if (!c) return t;
        const { es: _es, ef: _ef, ls: _ls, lf: _lf, ...calc } = c;
        return { ...t, calc: calc as typeof c };
      }),
    };
  }
  return JSON.stringify(file, null, 2);
}

/** Parse a `.gantt.json` file into a new project (always a fresh id, so nothing is overwritten). */
export function projectFromJson(text: string): Project {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('The file is not valid JSON');
  }
  const p = readProjectFile(data);
  return { ...p, id: newId() };
}
