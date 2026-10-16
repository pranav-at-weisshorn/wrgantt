import { format } from 'date-fns';
import {
  activeBaseline,
  dayToLocalDate,
  displayFinishDay,
  finishVariance,
  isoToDay,
  isValidIso,
  rollUpStatus,
  scheduleHealth,
  statusOf,
  todayDay,
  varianceSummary,
  worstCaseEnd,
  projectCalendarOf,
  type Project,
  type ScheduleHealth,
  type TaskStatus,
} from '../engine';
import type { Derived } from '../store/derive';
import { calFor } from '../ui/cal';
import { phaseColorOf } from '../ui/rows';
import { startOfMonth, startOfQuarter, startOfWeek, ticks } from '../ui/timeline/scale';

/**
 * Report model shared by the PDF (print view), Excel and web-page exports. Pure: everything
 * the three renderers draw is decided here, so it can be unit-tested without a DOM.
 */

export type ExportFormat = 'pdf' | 'excel' | 'html';
export type ReportScope = 'all' | 'phases' | 'phasesAndMilestones' | 'milestones';
export type RangeMode = 'project' | 'custom' | 'lookAhead';
export type ScaleChoice = 'auto' | 'week' | 'month' | 'quarter';
export type ScaleUnit = 'week' | 'month' | 'quarter';
export type PdfLayout = 'fit' | 'split';
export type Paper = 'A4' | 'A3';

export interface ReportOptions {
  scope: ReportScope;
  range: RangeMode;
  /** ISO dates for `range: 'custom'`. */
  customFrom: string;
  customTo: string;
  /** Weeks after the status date for `range: 'lookAhead'`. */
  lookAheadWeeks: number;
  scale: ScaleChoice;
  includeSummary: boolean;
  includeBaseline: boolean;
  highlightCritical: boolean;
  statusColumns: boolean;
  layout: PdfLayout;
  monthsPerPage: 3 | 6 | 12;
  paper: Paper;
  /** Split layout: leave out rows that have no bar on a page. */
  hideEmptyRows: boolean;
  /** Show worst-case extra time (hatched) and worst-case dates. */
  includeWorstCase: boolean;
}

export const DEFAULT_OPTIONS: ReportOptions = {
  scope: 'all',
  range: 'project',
  customFrom: '',
  customTo: '',
  lookAheadWeeks: 12,
  scale: 'auto',
  includeSummary: true,
  includeBaseline: true,
  highlightCritical: true,
  statusColumns: true,
  layout: 'fit',
  monthsPerPage: 6,
  paper: 'A4',
  hideEmptyRows: true,
  includeWorstCase: true,
};

/** Scope that suits each format best (the dialog starts from these). */
export const DEFAULT_SCOPE: Record<ExportFormat, ReportScope> = {
  pdf: 'phasesAndMilestones',
  excel: 'all',
  html: 'all',
};

/** Printable area in CSS pixels at 96 dpi for landscape paper with 10 mm margins. */
export const PAGE_PX: Record<Paper, { width: number; height: number }> = {
  A4: { width: 1044, height: 716 },
  A3: { width: 1508, height: 1044 },
};
export const PDF_ROW_H = 18;
/** Vertical space taken by the slice heading, legend and table header on a timeline page. */
const PDF_PAGE_CHROME = 118;

export const SCOPE_LABEL: Record<ReportScope, string> = {
  all: 'All tasks',
  phases: 'Phases only',
  phasesAndMilestones: 'Phases and milestones',
  milestones: 'Milestones only',
};

export const SIGNAL_COLOR: Record<ScheduleHealth, string> = {
  complete: '#4F7A4A',
  onTrack: '#4F7A4A',
  atRisk: '#9C6B1F',
  late: '#B3261E',
};

export const STATUS_COLOR: Record<TaskStatus, string> = {
  notStarted: '#8C7067',
  inProgress: '#462F28',
  onHold: '#9C6B1F',
  blocked: '#B3261E',
  complete: '#4F7A4A',
};

export const CRITICAL_COLOR = '#B3261E';

export interface ReportTick {
  day: number;
  /** Exclusive end, clipped to the axis. */
  end: number;
  label: string;
  /** Label to use when the tick is narrow. */
  short: string;
}

export interface ReportRow {
  id: string;
  rowId: number;
  wbs: string;
  name: string;
  depth: number;
  kind: 'phase' | 'summary' | 'task' | 'milestone';
  phaseId: string;
  phaseName: string;
  color: string;
  /** Day numbers; `finish` is inclusive. Milestones have start === finish. */
  start: number;
  finish: number;
  duration: number;
  percent: number;
  status: TaskStatus;
  signal: ScheduleHealth;
  critical: boolean;
  totalFloat: number | null;
  baselineStart: number | null;
  baselineFinish: number | null;
  /** Working days against the active baseline; positive = later. */
  variance: number | null;
  responsible: string;
  /** Worst-case extra working days of this task (0 for none; summaries 0). */
  worstCaseDays: number;
  /**
   * Inclusive last day of the hatched worst-case extension: a work task's own extra time; for
   * phases, summaries and milestones the date they could reach if every task overruns
   * (null when there is nothing past the finish).
   */
  worstEnd: number | null;
  /** Inclusive finish if every task takes its worst-case time (knock-on delays included). */
  worstFinish: number | null;
}

export interface ReportSlice {
  index: number;
  count: number;
  /** Axis: `from` inclusive, `to` exclusive. */
  from: number;
  to: number;
  unit: ScaleUnit;
  top: ReportTick[];
  bottom: ReportTick[];
  title: string;
  /** Indices into `Report.rows` shown on this slice. */
  rows: number[];
}

export interface ReportKpis {
  projectStart: number;
  projectFinish: number;
  baselineName: string | null;
  baselineFinish: number | null;
  /** Working days; positive = later than the baseline. */
  finishVariance: number | null;
  statusDay: number;
  /** Duration-weighted over leaf tasks, 0 to 100. */
  percentComplete: number;
  taskCount: number;
  milestoneCount: number;
  statusCounts: Record<TaskStatus, number>;
  signalCounts: Record<ScheduleHealth, number>;
  criticalRemaining: number;
  slippedCount: number;
  /** Project finish if every task takes its worst-case time (null when none has any). */
  worstCaseFinish: number | null;
  /** Working days between the planned and the worst-case finish. */
  worstCaseDelay: number | null;
}

export interface MilestoneEntry {
  id: string;
  rowId: number;
  name: string;
  phaseName: string;
  color: string;
  planned: number;
  baseline: number | null;
  variance: number | null;
  status: TaskStatus;
  signal: ScheduleHealth;
  critical: boolean;
  /** Date in the worst case (null when it would not move). */
  worstCase: number | null;
}

export interface PhaseEntry {
  id: string;
  rowId: number;
  name: string;
  color: string;
  start: number;
  finish: number;
  duration: number;
  percent: number;
  status: TaskStatus;
  signal: ScheduleHealth;
  baselineStart: number | null;
  baselineFinish: number | null;
  variance: number | null;
  taskCount: number;
  critical: boolean;
  /** Finish in the worst case (null when it would not move). */
  worstFinish: number | null;
}

export interface WatchEntry {
  id: string;
  rowId: number;
  name: string;
  phaseName: string;
  color: string;
  start: number;
  finish: number;
  baselineFinish: number | null;
  variance: number | null;
  totalFloat: number | null;
  percent: number;
  status: TaskStatus;
  signal: ScheduleHealth;
  critical: boolean;
  isMilestone: boolean;
}

export interface NextEntry extends WatchEntry {
  /** What happens in the next four weeks. */
  event: 'starts' | 'finishes' | 'starts and finishes' | 'milestone';
  /** Day of the first event inside the window. */
  date: number;
}

export interface Report {
  options: ReportOptions;
  projectName: string;
  generatedDay: number;
  statusDay: number;
  /** Requested window; `to` is exclusive. */
  window: { from: number; to: number };
  /** Window aligned to whole scale units. */
  axis: { from: number; to: number };
  unit: ScaleUnit;
  rows: ReportRow[];
  slices: ReportSlice[];
  /** One shared time axis across the whole project (summary page, phase bars). */
  overview: {
    from: number;
    to: number;
    unit: ScaleUnit;
    top: ReportTick[];
    bottom: ReportTick[];
  };
  kpis: ReportKpis;
  milestones: MilestoneEntry[];
  phases: PhaseEntry[];
  slipping: WatchEntry[];
  nextWeeks: NextEntry[];
  /** Days after the status date covered by `nextWeeks`. */
  nextWindow: { from: number; to: number };
}

// ---------------------------------------------------------------------------------- helpers

const SIGNAL_RANK: Record<ScheduleHealth, number> = { complete: 0, onTrack: 1, atRisk: 2, late: 3 };

/** Worst signal of a set; Complete only when everything is complete. */
export function worstSignal(signals: ScheduleHealth[]): ScheduleHealth {
  const open = signals.filter((s) => s !== 'complete');
  if (!open.length) return 'complete';
  return open.reduce((a, b) => (SIGNAL_RANK[b] > SIGNAL_RANK[a] ? b : a));
}

export function resolveUnit(choice: ScaleChoice, spanDays: number): ScaleUnit {
  if (choice !== 'auto') return choice;
  const months = spanDays / 30.4375;
  if (months <= 4.05) return 'week';
  if (months <= 24.05) return 'month';
  return 'quarter';
}

const startOfUnit = { week: startOfWeek, month: startOfMonth, quarter: startOfQuarter };

/** First unit boundary at or after `day`. */
function alignUp(unit: ScaleUnit, day: number): number {
  const start = startOfUnit[unit](day);
  if (start === day) return day;
  const t = ticks(unit, day, day + 1, 'bottom');
  return t.length ? t[0].end : day;
}

function tickLabel(
  unit: 'week' | 'month' | 'quarter' | 'year',
  day: number,
  tier: 'top' | 'bottom',
) {
  const date = dayToLocalDate(day);
  switch (unit) {
    case 'week':
      return { label: format(date, 'd MMM'), short: format(date, 'd') };
    case 'month':
      return tier === 'top'
        ? { label: format(date, 'MMM yyyy'), short: format(date, 'MMM yy') }
        : { label: format(date, 'MMM'), short: format(date, 'MMM')[0] };
    case 'quarter': {
      const q = `Q${Math.floor(date.getMonth() / 3) + 1}`;
      return tier === 'top'
        ? { label: `${q} ${format(date, 'yyyy')}`, short: `${q} ${format(date, 'yy')}` }
        : { label: q, short: q };
    }
    case 'year':
      return { label: format(date, 'yyyy'), short: format(date, 'yy') };
  }
}

const TIER_UNITS: Record<ScaleUnit, { top: 'month' | 'quarter' | 'year'; bottom: ScaleUnit }> = {
  week: { top: 'month', bottom: 'week' },
  month: { top: 'quarter', bottom: 'month' },
  quarter: { top: 'year', bottom: 'quarter' },
};

export type TickUnit = 'week' | 'month' | 'quarter' | 'year';

/** Ticks of one unit over `[from, to)`, clipped to it, labelled for the given header tier. */
export function tickList(
  unit: TickUnit,
  from: number,
  to: number,
  tier: 'top' | 'bottom',
): ReportTick[] {
  return ticks(unit, from, to, tier)
    .map((t) => ({
      day: Math.max(t.day, from),
      end: Math.min(t.end, to),
      ...tickLabel(unit, t.day, tier),
    }))
    .filter((t) => t.end > t.day);
}

/** Tick segments for the two header tiers over `[from, to)`, clipped to it. */
export function makeTicks(unit: ScaleUnit, from: number, to: number) {
  const tiers = TIER_UNITS[unit];
  return {
    top: tickList(tiers.top, from, to, 'top'),
    bottom: tickList(tiers.bottom, from, to, 'bottom'),
  };
}

/** "Jan – Jun 2028", "Nov 2026 – Apr 2027" or "Nov 2026" for the days `[from, to)`. */
export function rangeTitle(from: number, to: number): string {
  const a = dayToLocalDate(from);
  const b = dayToLocalDate(Math.max(from, to - 1));
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return format(a, 'MMM yyyy');
  }
  if (a.getFullYear() === b.getFullYear()) return `${format(a, 'MMM')} – ${format(b, 'MMM yyyy')}`;
  return `${format(a, 'MMM yyyy')} – ${format(b, 'MMM yyyy')}`;
}

export const UNIT_ADJECTIVE: Record<ScaleUnit, string> = {
  week: 'weekly',
  month: 'monthly',
  quarter: 'quarterly',
};

function monthIndexToDay(index: number): number {
  return Math.round(Date.UTC(Math.floor(index / 12), ((index % 12) + 12) % 12, 1) / 864e5);
}

function monthIndexOf(day: number): number {
  const d = new Date(day * 864e5);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
}

// ------------------------------------------------------------------------------ the builder

export function buildReport(
  project: Project,
  derived: Derived,
  options: ReportOptions,
  today: number = todayDay(),
): Report {
  const { outline, schedule } = derived;
  const bl = activeBaseline(project);
  const statusDay = isoToDay(project.statusDate);

  // ---- rows (full set, before any window filtering)
  const all = new Map<string, ReportRow>();
  const statusOfLeaf = new Map<string, TaskStatus>();
  const signalOfLeaf = new Map<string, ScheduleHealth>();
  for (const id of outline.flat) {
    if (outline.isSummary(id)) continue;
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    if (!c) continue;
    const status = statusOf(t);
    statusOfLeaf.set(id, status);
    signalOfLeaf.set(id, scheduleHealth(status, c, finishVariance(project, c, bl?.tasks[id])));
  }

  for (const id of outline.flat) {
    const t = outline.byId.get(id)!;
    const c = schedule.calc.get(id);
    if (!c) continue;
    const summary = outline.isSummary(id);
    const depth = outline.depth.get(id) ?? 0;
    const b = bl?.tasks[id];
    const leaves = outline.leavesOf(id).filter((l) => statusOfLeaf.has(l));
    const status = summary
      ? rollUpStatus(leaves.map((l) => statusOfLeaf.get(l)!))
      : statusOfLeaf.get(id)!;
    const signal = summary
      ? worstSignal(leaves.map((l) => signalOfLeaf.get(l)!))
      : signalOfLeaf.get(id)!;
    const phaseId = outline.phaseOf(id);
    all.set(id, {
      id,
      rowId: t.rowId,
      wbs: outline.wbs.get(id) ?? '',
      name: t.name,
      depth,
      kind: summary ? (depth === 0 ? 'phase' : 'summary') : c.isMilestone ? 'milestone' : 'task',
      phaseId,
      phaseName: outline.byId.get(phaseId)?.name ?? '',
      color: phaseColorOf(project, derived, id),
      start: c.es,
      finish: displayFinishDay(c),
      duration: summary ? c.duration : t.duration,
      percent: Math.round(c.percentComplete),
      status,
      signal,
      critical: !!c.critical && !summary,
      totalFloat: c.totalFloat ?? null,
      baselineStart: b ? isoToDay(b.start) : null,
      baselineFinish: b ? isoToDay(b.finish) : null,
      variance: finishVariance(project, c, b),
      responsible: t.responsible,
      worstCaseDays: 0,
      worstEnd: null,
      worstFinish: null,
    });
  }

  // ---- worst case: own hatched extensions, and dates if every task overruns
  const worstOn = options.includeWorstCase !== false;
  if (worstOn) {
    for (const r of all.values()) {
      if (r.kind === 'phase' || r.kind === 'summary') continue;
      const t = outline.byId.get(r.id)!;
      const c = schedule.calc.get(r.id)!;
      const extra = Math.max(0, Math.round(t.worstCaseDays ?? 0));
      if (!extra || r.status === 'complete') continue;
      r.worstCaseDays = extra;
      r.worstEnd = worstCaseEnd(calFor(project, t.calendarId), c.es, c.ef, extra) - 1;
    }
    if (derived.worst) {
      for (const r of all.values()) {
        const w = derived.worst.calc.get(r.id);
        if (w && displayFinishDay(w) > r.finish) r.worstFinish = displayFinishDay(w);
      }
    }
    // Phases, summaries and milestones extend to how late they could finish if every task
    // overruns (and at least as far as their tasks' own extra time).
    for (const r of all.values()) {
      if (r.kind === 'task') continue;
      let end = r.worstEnd ?? -Infinity;
      if (r.kind !== 'milestone') {
        for (const l of outline.leavesOf(r.id))
          end = Math.max(end, all.get(l)?.worstEnd ?? -Infinity);
      }
      end = Math.max(end, r.worstFinish ?? -Infinity);
      if (end > r.finish) r.worstEnd = end;
    }
  }

  // ---- project extents
  let projectStart = schedule.projectStart;
  let projectFinish = schedule.projectStart;
  for (const r of all.values()) {
    projectStart = Math.min(projectStart, r.start);
    projectFinish = Math.max(projectFinish, r.finish);
  }
  // The timeline also has to show the worst-case extensions and dates.
  let extentEnd = projectFinish;
  for (const r of all.values()) {
    extentEnd = Math.max(extentEnd, r.worstEnd ?? -Infinity, r.worstFinish ?? -Infinity);
  }

  // ---- date window
  let wFrom = projectStart;
  let wTo = extentEnd + 1;
  if (
    options.range === 'custom' &&
    isValidIso(options.customFrom) &&
    isValidIso(options.customTo)
  ) {
    wFrom = isoToDay(options.customFrom);
    wTo = isoToDay(options.customTo) + 1;
    if (wTo <= wFrom) [wFrom, wTo] = [wTo - 1, wFrom + 1];
  } else if (options.range === 'lookAhead') {
    wFrom = statusDay;
    wTo = statusDay + Math.max(1, Math.round(options.lookAheadWeeks)) * 7;
  }
  const windowSet =
    options.range !== 'project' && (wFrom !== projectStart || wTo !== extentEnd + 1);
  const overlaps = (r: ReportRow, from: number, to: number) => r.start < to && r.finish >= from;

  // ---- scope
  let scoped: ReportRow[] = [];
  const top = outline.children.get(null) ?? [];
  const topSet = new Set(top);
  switch (options.scope) {
    case 'all':
      scoped = outline.flat.map((id) => all.get(id)).filter((r): r is ReportRow => !!r);
      break;
    case 'phases':
      scoped = top.map((id) => all.get(id)).filter((r): r is ReportRow => !!r);
      break;
    case 'phasesAndMilestones':
      scoped = outline.flat
        .filter((id) => topSet.has(id) || all.get(id)?.kind === 'milestone')
        .map((id) => ({ ...all.get(id)!, depth: topSet.has(id) ? 0 : 1 }));
      break;
    case 'milestones':
      scoped = outline.flat
        .map((id) => all.get(id))
        .filter((r): r is ReportRow => r?.kind === 'milestone')
        .map((r) => ({ ...r, depth: 0 }))
        .sort((a, b) => a.start - b.start || a.rowId - b.rowId);
      break;
  }
  const rows = windowSet
    ? scoped.filter((r) => r.kind === 'phase' || overlaps(r, wFrom, wTo))
    : scoped;

  // ---- axis and slices
  const split = options.layout === 'split';
  const unit = resolveUnit(options.scale, split ? options.monthsPerPage * 30.4375 : wTo - wFrom);
  const axis = { from: startOfUnit[unit](wFrom), to: alignUp(unit, wTo) };
  if (axis.to <= axis.from) axis.to = axis.from + 7;

  const makeSlice = (from: number, to: number) => ({
    from,
    to,
    unit,
    ...makeTicks(unit, from, to),
  });
  let slices: ReportSlice[];
  if (!split) {
    slices = [
      {
        index: 0,
        count: 1,
        ...makeSlice(axis.from, axis.to),
        title: rangeTitle(axis.from, axis.to),
        rows: rows.map((_, i) => i),
      },
    ];
  } else {
    const step = options.monthsPerPage;
    let mi = monthIndexOf(axis.from);
    mi -= ((mi % step) + step) % step;
    const periods: { from: number; to: number; rows: number[] }[] = [];
    for (; monthIndexToDay(mi) < axis.to; mi += step) {
      const from = Math.max(monthIndexToDay(mi), axis.from);
      const to = Math.min(monthIndexToDay(mi + step), axis.to);
      if (to <= from) continue;
      const idx: number[] = [];
      rows.forEach((r, i) => {
        if (!options.hideEmptyRows || overlaps(r, from, to)) idx.push(i);
      });
      if (options.hideEmptyRows && !idx.length) continue;
      periods.push({ from, to, rows: idx });
    }
    slices = periods.map((p, i) => ({
      index: i,
      count: periods.length,
      ...makeSlice(p.from, p.to),
      title: `${rangeTitle(p.from, p.to)} · part ${i + 1} of ${periods.length}`,
      rows: p.rows,
    }));
  }

  const ovUnit = resolveUnit('auto', extentEnd + 1 - projectStart);
  const ovFrom = startOfUnit[ovUnit](projectStart);
  const ovTo = alignUp(ovUnit, extentEnd + 1);
  const overview = { from: ovFrom, to: ovTo, unit: ovUnit, ...makeTicks(ovUnit, ovFrom, ovTo) };

  // ---- KPIs
  const leafRows = outline.flat.filter((id) => statusOfLeaf.has(id)).map((id) => all.get(id)!);
  const statusCounts: Record<TaskStatus, number> = {
    notStarted: 0,
    inProgress: 0,
    onHold: 0,
    blocked: 0,
    complete: 0,
  };
  const signalCounts: Record<ScheduleHealth, number> = {
    complete: 0,
    onTrack: 0,
    atRisk: 0,
    late: 0,
  };
  let weighted = 0;
  let weights = 0;
  let milestoneCount = 0;
  let criticalRemaining = 0;
  let slippedCount = 0;
  for (const r of leafRows) {
    statusCounts[r.status]++;
    signalCounts[r.signal]++;
    weighted += r.percent * r.duration;
    weights += r.duration;
    if (r.kind === 'milestone') milestoneCount++;
    if (r.critical && r.status !== 'complete') criticalRemaining++;
    if (r.variance !== null && r.variance > 0 && r.status !== 'complete') slippedCount++;
  }
  const percentComplete = weights
    ? weighted / weights
    : leafRows.length
      ? leafRows.reduce((a, r) => a + r.percent, 0) / leafRows.length
      : 0;
  const vs = varianceSummary(project, schedule, outline);
  let worstCaseFinish: number | null = null;
  if (worstOn && derived.worst) {
    for (const c of derived.worst.calc.values()) {
      worstCaseFinish = Math.max(worstCaseFinish ?? -Infinity, displayFinishDay(c));
    }
    if (worstCaseFinish !== null && worstCaseFinish <= projectFinish) worstCaseFinish = null;
  }
  const projCal = projectCalendarOf(project);
  const kpis: ReportKpis = {
    projectStart,
    projectFinish,
    baselineName: bl?.name ?? null,
    baselineFinish: vs?.baselineFinish ?? null,
    finishVariance: vs?.finishVariance ?? null,
    statusDay,
    percentComplete: Math.round(percentComplete * 10) / 10,
    taskCount: leafRows.length,
    milestoneCount,
    statusCounts,
    signalCounts,
    criticalRemaining,
    slippedCount,
    worstCaseFinish,
    worstCaseDelay:
      worstCaseFinish === null
        ? null
        : projCal.cum(worstCaseFinish + 1) - projCal.cum(projectFinish + 1),
  };

  // ---- tables
  const milestones: MilestoneEntry[] = leafRows
    .filter((r) => r.kind === 'milestone')
    .map((r) => ({
      id: r.id,
      rowId: r.rowId,
      name: r.name,
      phaseName: r.phaseName,
      color: r.color,
      planned: r.start,
      baseline: r.baselineFinish,
      variance: r.variance,
      status: r.status,
      signal: r.signal,
      critical: r.critical,
      worstCase: r.worstFinish,
    }))
    .sort((a, b) => a.planned - b.planned || a.rowId - b.rowId);

  const phases: PhaseEntry[] = (outline.children.get(null) ?? [])
    .map((id) => all.get(id))
    .filter((r): r is ReportRow => !!r)
    .map((r) => ({
      id: r.id,
      rowId: r.rowId,
      name: r.name,
      color: r.color,
      start: r.start,
      finish: r.finish,
      duration: r.duration,
      percent: r.percent,
      status: r.status,
      signal: r.signal,
      baselineStart: r.baselineStart,
      baselineFinish: r.baselineFinish,
      variance: r.variance,
      taskCount: outline.leavesOf(r.id).length,
      critical: outline.leavesOf(r.id).some((l) => all.get(l)?.critical),
      worstFinish: r.worstFinish,
    }));

  const watch = (r: ReportRow): WatchEntry => ({
    id: r.id,
    rowId: r.rowId,
    name: r.name,
    phaseName: r.phaseName,
    color: r.color,
    start: r.start,
    finish: r.finish,
    baselineFinish: r.baselineFinish,
    variance: r.variance,
    totalFloat: r.totalFloat,
    percent: r.percent,
    status: r.status,
    signal: r.signal,
    critical: r.critical,
    isMilestone: r.kind === 'milestone',
  });

  const slipping = leafRows
    .filter((r) => r.status !== 'complete' && ((r.variance ?? 0) > 0 || r.signal === 'late'))
    .sort(
      (a, b) =>
        (b.variance ?? 0) - (a.variance ?? 0) ||
        (a.totalFloat ?? 0) - (b.totalFloat ?? 0) ||
        a.rowId - b.rowId,
    )
    .slice(0, 10)
    .map(watch);

  const nextWindow = { from: statusDay, to: statusDay + 28 };
  const inNext = (d: number) => d >= nextWindow.from && d < nextWindow.to;
  const nextWeeks: NextEntry[] = [];
  for (const r of leafRows) {
    if (r.status === 'complete') continue;
    const starts = inNext(r.start);
    const finishes = inNext(r.finish);
    if (!starts && !finishes) continue;
    const milestone = r.kind === 'milestone';
    nextWeeks.push({
      ...watch(r),
      event: milestone
        ? 'milestone'
        : starts && finishes
          ? 'starts and finishes'
          : starts
            ? 'starts'
            : 'finishes',
      date: starts ? r.start : r.finish,
    });
  }
  nextWeeks.sort((a, b) => a.date - b.date || a.rowId - b.rowId);

  return {
    options,
    projectName: project.name,
    generatedDay: today,
    statusDay,
    window: { from: wFrom, to: wTo },
    axis,
    unit,
    rows,
    slices,
    overview,
    kpis,
    milestones,
    phases,
    slipping,
    nextWeeks,
    nextWindow,
  };
}

// ----------------------------------------------------------------------- live description

/** Rough number of timeline pages for the PDF (rows are paginated by the browser). */
export function estimateTimelinePages(report: Report): number {
  const { height } = PAGE_PX[report.options.paper];
  const perPage = Math.max(8, Math.floor((height - PDF_PAGE_CHROME) / PDF_ROW_H));
  return report.slices.reduce((n, s) => n + Math.max(1, Math.ceil(s.rows.length / perPage)), 0);
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** One line telling the user what the chosen options will produce. */
export function describeReport(format: ExportFormat, report: Report): string {
  const span = rangeTitle(report.window.from, report.window.to);
  if (format === 'pdf') {
    const timeline = estimateTimelinePages(report);
    const summary = report.options.includeSummary ? 2 : 0;
    const parts = [
      report.options.includeSummary ? 'summary (2 pages)' : '',
      plural(timeline, 'timeline page'),
    ].filter(Boolean);
    return `${plural(summary + timeline, 'page')}: ${parts.join(' + ')}. ${span}, ${UNIT_ADJECTIVE[report.unit]} scale, ${plural(report.rows.length, 'row')}.`;
  }
  if (format === 'excel') {
    const monthly = excelUnit(report) === 'month';
    const columns = excelColumns(report).length;
    const sheets = report.options.includeSummary ? 'Summary, Tasks and Gantt' : 'Tasks and Gantt';
    return `Sheets: ${sheets}. The Gantt sheet shows ${plural(report.rows.length, 'row')} for ${span}, ${monthly ? 'monthly' : 'weekly'} (${plural(columns, 'column')}). The Tasks sheet always lists every task.`;
  }
  return `One self-contained page for phones and computers: ${report.options.includeSummary ? 'overview, ' : ''}timeline with zoom and search (${plural(report.rows.length, 'row')}, ${span}).`;
}

// -------------------------------------------------------------------------- Excel columns

/** Weekly or monthly columns for the Excel Gantt: monthly when the window exceeds 18 months. */
export function excelUnit(report: Report): 'week' | 'month' {
  const { scale } = report.options;
  if (scale === 'week') return 'week';
  if (scale === 'month' || scale === 'quarter') return 'month';
  const months = (report.window.to - report.window.from) / 30.4375;
  return months > 18 ? 'month' : 'week';
}

/** Start day of every column on the Excel Gantt (each column spans to the next start). */
export function excelColumns(report: Report): number[] {
  const unit = excelUnit(report);
  const from = startOfUnit[unit](report.window.from);
  return ticks(unit, from, report.window.to, 'bottom').map((t) => t.day);
}
