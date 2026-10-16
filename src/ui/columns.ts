import {
  days,
  displayFinishDay,
  finishVariance,
  HEALTH_SIGNAL_LABEL,
  isoToDay,
  rollUpStatus,
  scheduleHealth,
  statusOf,
  STATUS_LABEL,
  type Baseline,
  type Project,
  type ScheduleHealth,
  type TaskStatus,
} from '../engine';
import { derive } from '../store/derive';
import type { ColumnKey } from '../store/prefs';
import { fmtDay, fmtIso, fmtSigned } from './format';
import { linkTexts, type Row } from './rows';

export type EditKind =
  | 'text'
  | 'duration'
  | 'worstCase'
  | 'date'
  | 'finishDate'
  | 'preds'
  | 'percent'
  | 'notes'
  | 'status';

export interface ColumnDef {
  key: ColumnKey;
  label: string;
  width: number;
  align?: 'left' | 'right' | 'center';
  /** Can the column be hidden? */
  hideable: boolean;
  edit?: EditKind;
  /** Summary rows are computed and cannot be edited in these columns. */
  leafOnly?: boolean;
  text: (row: Row, ctx: ColumnCtx) => string;
}

export interface ColumnCtx {
  project: Project;
  baseline: Baseline | undefined;
}

/** Effective status of a row; a summary shows the roll-up of its subtasks. */
export function rowStatus(row: Row, project: Project): TaskStatus {
  if (!row.isSummary) return statusOf(row.task);
  const { outline } = derive(project);
  return rollUpStatus(outline.leavesOf(row.id).map((id) => statusOf(outline.byId.get(id)!)));
}

/** Schedule signal of a row, from its status and finish variance against the active baseline. */
export function rowSignal(row: Row, ctx: ColumnCtx): ScheduleHealth {
  return scheduleHealth(
    rowStatus(row, ctx.project),
    row.calc,
    finishVariance(ctx.project, row.calc, ctx.baseline?.tasks[row.id]),
  );
}

export const COLUMNS: ColumnDef[] = [
  {
    key: 'id',
    label: 'ID',
    width: 44,
    align: 'right',
    hideable: false,
    text: (r) => String(r.task.rowId),
  },
  { key: 'indicators', label: '', width: 26, align: 'center', hideable: true, text: () => '' },
  { key: 'wbs', label: 'WBS', width: 58, hideable: true, text: (r) => r.wbs },
  {
    key: 'name',
    label: 'Task name',
    width: 300,
    hideable: false,
    edit: 'text',
    text: (r) => r.task.name,
  },
  {
    key: 'duration',
    label: 'Duration',
    width: 86,
    align: 'right',
    hideable: true,
    edit: 'duration',
    leafOnly: true,
    text: (r) => (r.calc ? days(r.isSummary ? r.calc.duration : r.task.duration) : ''),
  },
  {
    key: 'worstCase',
    label: 'Worst case',
    width: 96,
    align: 'right',
    hideable: true,
    edit: 'worstCase',
    leafOnly: true,
    text: (r) =>
      !r.isSummary && (r.task.worstCaseDays ?? 0) > 0 ? `+${days(r.task.worstCaseDays!)}` : '',
  },
  {
    key: 'worstFinish',
    label: 'Finish (worst case)',
    width: 128,
    hideable: true,
    text: (r, c) => {
      const w = derive(c.project).worst?.calc.get(r.id);
      return w ? fmtDay(displayFinishDay(w)) : '';
    },
  },
  {
    key: 'start',
    label: 'Start',
    width: 108,
    hideable: true,
    edit: 'date',
    leafOnly: true,
    text: (r) => (r.calc ? fmtDay(r.calc.es) : ''),
  },
  {
    key: 'finish',
    label: 'Finish',
    width: 108,
    hideable: true,
    edit: 'finishDate',
    leafOnly: true,
    text: (r) => (r.calc ? fmtDay(displayFinishDay(r.calc)) : ''),
  },
  {
    key: 'predecessors',
    label: 'Predecessors',
    width: 250,
    hideable: true,
    edit: 'preds',
    text: (r, c) => linkTexts(c.project).preds.get(r.id) ?? '',
  },
  {
    key: 'successors',
    label: 'Successors',
    width: 250,
    hideable: true,
    text: (r, c) => linkTexts(c.project).succs.get(r.id) ?? '',
  },
  {
    key: 'responsible',
    label: 'Responsible',
    width: 150,
    hideable: true,
    edit: 'text',
    text: (r) => r.task.responsible,
  },
  {
    key: 'percent',
    label: '% Complete',
    width: 66,
    align: 'right',
    hideable: true,
    edit: 'percent',
    leafOnly: true,
    text: (r) => (r.calc ? `${Math.round(r.calc.percentComplete)}%` : ''),
  },
  {
    key: 'status',
    label: 'Status',
    width: 112,
    hideable: true,
    edit: 'status',
    leafOnly: true,
    text: (r, c) => STATUS_LABEL[rowStatus(r, c.project)],
  },
  {
    key: 'signal',
    label: 'Schedule',
    width: 96,
    hideable: true,
    text: (r, c) => HEALTH_SIGNAL_LABEL[rowSignal(r, c)],
  },
  {
    key: 'totalFloat',
    label: 'Total float',
    width: 84,
    align: 'right',
    hideable: true,
    text: (r) => (r.calc && r.calc.percentComplete < 100 ? days(r.calc.totalFloat) : ''),
  },
  {
    key: 'baselineStart',
    label: 'Baseline start',
    width: 108,
    hideable: true,
    text: (r, c) => fmtIso(c.baseline?.tasks[r.id]?.start),
  },
  {
    key: 'baselineFinish',
    label: 'Baseline finish',
    width: 108,
    hideable: true,
    text: (r, c) => fmtIso(c.baseline?.tasks[r.id]?.finish),
  },
  {
    key: 'finishVariance',
    label: 'Finish variance',
    width: 76,
    align: 'right',
    hideable: true,
    text: (r, c) => fmtSigned(finishVariance(c.project, r.calc, c.baseline?.tasks[r.id])),
  },
  {
    key: 'notes',
    label: 'Notes',
    width: 220,
    hideable: true,
    edit: 'notes',
    text: (r) => r.task.notes.replace(/\s+/g, ' '),
  },
];

export const COLUMN_BY_KEY = new Map(COLUMNS.map((c) => [c.key, c]));

/** Initial editor value for a cell (raw rather than formatted where useful). */
export function editValue(col: ColumnDef, row: Row, ctx: ColumnCtx): string {
  switch (col.edit) {
    case 'worstCase':
      return String(row.task.worstCaseDays ?? 0);
    case 'duration':
      return String(row.task.duration);
    case 'percent':
      return String(Math.round(row.task.percentComplete));
    case 'notes':
      return row.task.notes;
    case 'status':
      return statusOf(row.task);
    default:
      return col.text(row, ctx);
  }
}

export function baselineVariance(project: Project, row: Row, baseline: Baseline | undefined) {
  return finishVariance(project, row.calc, baseline?.tasks[row.id]);
}

export function isPastStatus(project: Project, day: number) {
  return day < isoToDay(project.statusDate);
}
