import { displayFinishDay, finishVariance, isoToDay, type Baseline, type Project } from '../engine';
import type { ColumnKey } from '../store/prefs';
import { fmtDay, fmtIso, fmtSigned } from './format';
import { linkTexts, type Row } from './rows';

export type EditKind = 'text' | 'duration' | 'date' | 'finishDate' | 'preds' | 'percent' | 'notes';

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
    width: 70,
    align: 'right',
    hideable: true,
    edit: 'duration',
    leafOnly: true,
    text: (r) => (r.calc ? `${r.isSummary ? r.calc.duration : r.task.duration}d` : ''),
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
    width: 130,
    hideable: true,
    edit: 'preds',
    text: (r, c) => linkTexts(c.project).preds.get(r.id) ?? '',
  },
  {
    key: 'successors',
    label: 'Successors',
    width: 130,
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
    label: '% Comp.',
    width: 66,
    align: 'right',
    hideable: true,
    edit: 'percent',
    leafOnly: true,
    text: (r) => (r.calc ? `${Math.round(r.calc.percentComplete)}%` : ''),
  },
  {
    key: 'totalFloat',
    label: 'Total float',
    width: 74,
    align: 'right',
    hideable: true,
    text: (r) => (r.calc && r.calc.percentComplete < 100 ? `${r.calc.totalFloat}d` : ''),
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
    label: 'Finish var.',
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
    case 'duration':
      return String(row.task.duration);
    case 'percent':
      return String(Math.round(row.task.percentComplete));
    case 'notes':
      return row.task.notes;
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
