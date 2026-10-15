export type DepType = 'FS' | 'SS' | 'FF' | 'SF';
export type LagUnit = 'wd' | 'ed';

export interface Dependency {
  id: string;
  predecessorId: string;
  successorId: string;
  type: DepType;
  lag: number;
  lagUnit: LagUnit;
}

export type TaskStatus = 'notStarted' | 'inProgress' | 'onHold' | 'blocked' | 'complete';

export type ConstraintType = 'ASAP' | 'SNET' | 'SNLT' | 'FNET' | 'FNLT' | 'MSO' | 'MFO';

export interface Constraint {
  type: ConstraintType;
  date?: string;
}

export interface TaskCalc {
  earlyStart: string;
  /** Exclusive finish (ISO). Display with `displayFinish`. */
  earlyFinish: string;
  lateStart: string;
  /** Exclusive finish (ISO). */
  lateFinish: string;
  totalFloat: number;
  freeFloat: number;
  critical: boolean;
  remainingDuration: number;
  constraintViolated?: boolean;
  // Numeric day numbers (days since 1970-01-01) used by the UI for fast rendering.
  es: number;
  ef: number;
  ls: number;
  lf: number;
  /** Inclusive finish day as displayed (summaries: latest child finish day). */
  finishDay: number;
  /** Computed duration in working days (summary tasks: project calendar). */
  duration: number;
  /** Rolled-up % complete for summaries; own value for leaves. */
  percentComplete: number;
  isSummary: boolean;
  isMilestone: boolean;
}

export interface Task {
  id: string;
  rowId: number;
  templateKey?: string;
  name: string;
  parentId: string | null;
  order: number;
  duration: number;
  calendarId: string;
  constraint: Constraint;
  responsible: string;
  notes: string;
  phaseColor?: string;

  percentComplete: number;
  /** User-set status; see `statusOf` for the effective value (progress takes precedence). */
  status?: TaskStatus;
  actualStart?: string;
  actualFinish?: string;

  calc?: TaskCalc;
}

export interface Calendar {
  id: string;
  name: string;
  workingWeekdays: number[];
  holidays: string[];
}

export interface BaselineEntry {
  start: string;
  /** Inclusive finish date (as displayed). */
  finish: string;
  duration: number;
}

export interface Baseline {
  id: string;
  name: string;
  savedAt: string;
  tasks: Record<string, BaselineEntry>;
}

export interface Project {
  id: string;
  name: string;
  startDate: string;
  statusDate: string;
  projectCalendarId: string;
  calendars: Calendar[];
  tasks: Task[];
  dependencies: Dependency[];
  baselines: Baseline[];
  activeBaselineId?: string;
  criticalFloatThreshold: number;
}

export interface CycleInfo {
  /** Task ids along the loop; the first id is repeated at the end. */
  taskIds: string[];
  message: string;
}

export interface ScheduleResult {
  calc: Map<string, TaskCalc>;
  projectStart: number;
  projectFinish: number;
  cycles: CycleInfo[];
  errors: string[];
  elapsedMs: number;
}
