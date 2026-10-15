import { isValidIso, isoToDay } from './dates';
import type { Outline } from './outline';
import type { Project, ScheduleResult } from './types';

export type HealthKind =
  | 'cycle'
  | 'noPredecessor'
  | 'noSuccessor'
  | 'negativeFloat'
  | 'constraintConflict'
  | 'summaryLink'
  | 'longLag'
  | 'actualAfterStatus';

export interface HealthIssue {
  kind: HealthKind;
  taskId: string;
  severity: 'error' | 'warning';
  message: string;
}

export const HEALTH_LABELS: Record<HealthKind, string> = {
  cycle: 'Circular dependencies',
  noPredecessor: 'Open ends: no predecessor',
  noSuccessor: 'Open ends: no successor',
  negativeFloat: 'Negative float',
  constraintConflict: 'Constraint conflicts',
  summaryLink: 'Links on summary tasks',
  longLag: 'Lags longer than 60 days',
  actualAfterStatus: 'Actual start after status date',
};

export const LONG_LAG_DAYS = 60;

export function checkHealth(project: Project, schedule: ScheduleResult, outline: Outline) {
  const issues: HealthIssue[] = [];
  const row = (id: string) => outline.byId.get(id)?.rowId ?? '?';

  for (const c of schedule.cycles) {
    issues.push({ kind: 'cycle', taskId: c.taskIds[0], severity: 'error', message: c.message });
  }

  // Effective links: a link on a summary counts for all of its leaves.
  const hasPred = new Set<string>();
  const hasSucc = new Set<string>();
  for (const d of project.dependencies) {
    if (!outline.byId.has(d.predecessorId) || !outline.byId.has(d.successorId)) continue;
    for (const l of outline.leavesOf(d.successorId)) hasPred.add(l);
    for (const l of outline.leavesOf(d.predecessorId)) hasSucc.add(l);
  }
  const leaves = outline.flat.filter((id) => !outline.isSummary(id));

  // The project's first and last milestones are allowed to be open ends.
  let firstMs: string | null = null;
  let lastMs: string | null = null;
  for (const id of leaves) {
    const c = schedule.calc.get(id);
    if (!c?.isMilestone) continue;
    if (!hasPred.has(id) && (!firstMs || c.es < schedule.calc.get(firstMs)!.es)) firstMs = id;
    if (!hasSucc.has(id) && (!lastMs || c.ef >= schedule.calc.get(lastMs)!.ef)) lastMs = id;
  }

  const status = isValidIso(project.statusDate) ? isoToDay(project.statusDate) : null;

  for (const id of leaves) {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    if (!hasPred.has(id) && id !== firstMs) {
      issues.push({
        kind: 'noPredecessor',
        taskId: id,
        severity: 'warning',
        message: `${row(id)} ${t.name} has no predecessor`,
      });
    }
    if (!hasSucc.has(id) && id !== lastMs) {
      issues.push({
        kind: 'noSuccessor',
        taskId: id,
        severity: 'warning',
        message: `${row(id)} ${t.name} has no successor`,
      });
    }
    if (c && c.totalFloat < 0) {
      issues.push({
        kind: 'negativeFloat',
        taskId: id,
        severity: 'error',
        message: `${row(id)} ${t.name}: total float ${c.totalFloat}d`,
      });
    }
    if (c?.constraintViolated) {
      issues.push({
        kind: 'constraintConflict',
        taskId: id,
        severity: 'error',
        message: `${row(id)} ${t.name}: ${t.constraint.type} ${t.constraint.date ?? ''} conflicts with logic`,
      });
    }
    if (
      status !== null &&
      isValidIso(t.actualStart) &&
      isoToDay(t.actualStart) > status &&
      (t.percentComplete ?? 0) < 100
    ) {
      issues.push({
        kind: 'actualAfterStatus',
        taskId: id,
        severity: 'warning',
        message: `${row(id)} ${t.name}: actual start ${t.actualStart} is after the status date`,
      });
    }
  }

  for (const d of project.dependencies) {
    const p = outline.byId.get(d.predecessorId);
    const s = outline.byId.get(d.successorId);
    if (!p || !s) continue;
    if (outline.isSummary(p.id) || outline.isSummary(s.id)) {
      issues.push({
        kind: 'summaryLink',
        taskId: outline.isSummary(s.id) ? s.id : p.id,
        severity: 'warning',
        message: `Link ${p.rowId} → ${s.rowId} is on a summary task`,
      });
    }
    if (Math.abs(d.lag) > LONG_LAG_DAYS) {
      issues.push({
        kind: 'longLag',
        taskId: s.id,
        severity: 'warning',
        message: `Link ${p.rowId} → ${s.rowId} has a ${d.lag}${d.lagUnit === 'ed' ? 'ed' : 'd'} lag`,
      });
    }
  }
  return issues;
}
