/** Reads a `.gantt.json` project (read-only) and schedules it with the app's own engine. */
import { buildOutline, scheduleProject } from '../../src/engine';
import { projectFromJson } from '../../src/io/json';

export interface NewTask {
  id: string;
  rowId: number;
  name: string;
  /** Ancestor names (phase first). */
  path: string[];
  phase: string;
  isSummary: boolean;
  isMilestone: boolean;
  depth: number;
  /** Day numbers; finish is the date shown in the planner (inclusive). */
  start: number;
  finish: number;
  critical: boolean;
  /** The task has a fixed "Start No Earlier Than"-style constraint date. */
  constrained: boolean;
}

export interface NewPlan {
  name: string;
  statusDay: number;
  tasks: NewTask[];
  byId: Map<string, NewTask>;
  finish: number;
}

export function readNewPlan(text: string): NewPlan {
  const project = projectFromJson(text);
  const outline = buildOutline(project.tasks);
  const schedule = scheduleProject(project, outline);
  const tasks: NewTask[] = [];
  for (const id of outline.flat) {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id)!;
    const path = outline
      .ancestorsOf(id)
      .slice()
      .reverse()
      .map((a) => outline.byId.get(a)!.name);
    tasks.push({
      id,
      rowId: t.rowId,
      name: t.name.trim(),
      path,
      phase: path[0] ?? t.name.trim(),
      isSummary: outline.isSummary(id),
      isMilestone: c.isMilestone,
      depth: outline.depth.get(id) ?? 0,
      start: c.es,
      finish: c.finishDay,
      critical: c.critical,
      constrained: t.constraint.type !== 'ASAP',
    });
  }
  const statusIso = project.statusDate ?? project.startDate;
  return {
    name: project.name,
    statusDay: Math.round(Date.parse(statusIso) / 86_400_000),
    tasks,
    byId: new Map(tasks.map((t) => [t.id, t])),
    finish: Math.max(...tasks.map((t) => t.finish)),
  };
}
