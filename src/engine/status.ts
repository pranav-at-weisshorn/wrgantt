import type { Task, TaskCalc, TaskStatus } from './types';

export const TASK_STATUSES: TaskStatus[] = [
  'notStarted',
  'inProgress',
  'onHold',
  'blocked',
  'complete',
];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  notStarted: 'Not started',
  inProgress: 'In progress',
  onHold: 'On hold',
  blocked: 'Blocked',
  complete: 'Complete',
};

/**
 * The status a task is in. Progress wins where it is unambiguous (100 % or an actual finish is
 * Complete; any progress is In progress); On hold and Blocked are set by the user and are kept
 * until the task is complete.
 */
export function statusOf(
  task: Pick<Task, 'status' | 'percentComplete' | 'actualStart' | 'actualFinish'>,
): TaskStatus {
  if ((task.percentComplete ?? 0) >= 100 || task.actualFinish) return 'complete';
  if (task.status === 'onHold' || task.status === 'blocked') return task.status;
  if ((task.percentComplete ?? 0) > 0 || task.actualStart || task.status === 'inProgress') {
    return 'inProgress';
  }
  return 'notStarted';
}

/** Status of a summary from its subtasks' statuses. */
export function rollUpStatus(statuses: TaskStatus[]): TaskStatus {
  if (!statuses.length) return 'notStarted';
  if (statuses.every((s) => s === 'complete')) return 'complete';
  if (statuses.includes('blocked')) return 'blocked';
  if (statuses.some((s) => s === 'inProgress' || s === 'complete')) return 'inProgress';
  if (statuses.includes('onHold')) return 'onHold';
  return 'notStarted';
}

/** Management signal for a task or phase. */
export type ScheduleHealth = 'complete' | 'onTrack' | 'atRisk' | 'late';

export const HEALTH_SIGNAL_LABEL: Record<ScheduleHealth, string> = {
  complete: 'Complete',
  onTrack: 'On track',
  atRisk: 'At risk',
  late: 'Late',
};

/**
 * - Late: negative total float, or a critical task finishing after its baseline.
 * - At risk: finishing after its baseline, blocked / on hold, or a constraint conflict.
 * - On track: otherwise.
 * `finishVariance` is working days against the active baseline (null without one).
 */
export function scheduleHealth(
  status: TaskStatus,
  calc: Pick<TaskCalc, 'totalFloat' | 'critical' | 'constraintViolated'> | undefined,
  finishVariance: number | null,
): ScheduleHealth {
  if (status === 'complete') return 'complete';
  if (!calc) return 'onTrack';
  const slipped = finishVariance !== null && finishVariance > 0;
  if (calc.totalFloat < 0 || (slipped && calc.critical)) return 'late';
  if (slipped || status === 'blocked' || status === 'onHold' || calc.constraintViolated) {
    return 'atRisk';
  }
  return 'onTrack';
}
