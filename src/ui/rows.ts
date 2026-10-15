import {
  activeBaseline,
  finishVariance,
  formatLink,
  type Project,
  type Task,
  type TaskCalc,
} from '../engine';
import type { Derived } from '../store/derive';
import type { Filters } from '../store/store';

export const ROW_H = 28;
export const HEADER_H = 46;
export const DEFAULT_PHASE_COLOR = '#94a3b8';

export interface Row {
  id: string;
  task: Task;
  calc: TaskCalc | undefined;
  depth: number;
  isSummary: boolean;
  wbs: string;
  collapsed: boolean;
  color: string;
}

export function filtersActive(f: Filters) {
  return !!(
    f.search.trim() ||
    f.phaseId ||
    f.responsible ||
    f.criticalOnly ||
    f.slipped ||
    f.inProgress ||
    f.milestones
  );
}

export function phaseColorOf(project: Project, derived: Derived, id: string): string {
  const t = derived.outline.byId.get(id);
  if (t?.phaseColor) return t.phaseColor;
  for (const a of derived.outline.ancestorsOf(id)) {
    const c = derived.outline.byId.get(a)?.phaseColor;
    if (c) return c;
  }
  void project;
  return DEFAULT_PHASE_COLOR;
}

export function computeRows(
  project: Project,
  derived: Derived,
  collapsed: Record<string, boolean>,
  filters: Filters,
): Row[] {
  const { outline, schedule } = derived;
  const active = filtersActive(filters);
  let visible: Set<string> | null = null;

  if (active) {
    const q = filters.search.trim().toLowerCase();
    const bl = activeBaseline(project);
    visible = new Set();
    for (const id of outline.flat) {
      const t = outline.byId.get(id)!;
      const c = schedule.calc.get(id);
      const summary = outline.isSummary(id);
      if (q && !t.name.toLowerCase().includes(q)) continue;
      if (filters.phaseId && outline.phaseOf(id) !== filters.phaseId) continue;
      if (filters.responsible && t.responsible !== filters.responsible) continue;
      const leafOnly =
        filters.criticalOnly || filters.slipped || filters.inProgress || filters.milestones;
      if (leafOnly && summary) continue;
      if (filters.criticalOnly && !c?.critical) continue;
      if (filters.inProgress && !(c && c.percentComplete > 0 && c.percentComplete < 100)) continue;
      if (filters.milestones && !c?.isMilestone) continue;
      if (filters.slipped) {
        const v = finishVariance(project, c, bl?.tasks[id]);
        if (v === null || v <= 0) continue;
      }
      visible.add(id);
      for (const a of outline.ancestorsOf(id)) visible.add(a);
    }
  }

  const rows: Row[] = [];
  const hiddenUnder = new Set<string>();
  for (const id of outline.flat) {
    if (visible && !visible.has(id)) continue;
    const t = outline.byId.get(id)!;
    if (!active && t.parentId && hiddenUnder.has(t.parentId)) {
      hiddenUnder.add(id);
      continue;
    }
    const isSummary = outline.isSummary(id);
    const isCollapsed = !active && isSummary && !!collapsed[id];
    if (isCollapsed) hiddenUnder.add(id);
    rows.push({
      id,
      task: t,
      calc: schedule.calc.get(id),
      depth: outline.depth.get(id) ?? 0,
      isSummary,
      wbs: outline.wbs.get(id) ?? '',
      collapsed: isCollapsed,
      color: phaseColorOf(project, derived, id),
    });
  }
  return rows;
}

/** Formatted predecessor / successor strings per task (row IDs), cached per project object. */
const linkTextCache = new WeakMap<
  Project,
  { preds: Map<string, string>; succs: Map<string, string> }
>();

export function linkTexts(project: Project) {
  let v = linkTextCache.get(project);
  if (v) return v;
  const rowOf = new Map(project.tasks.map((t) => [t.id, t.rowId]));
  const preds = new Map<string, string[]>();
  const succs = new Map<string, string[]>();
  const deps = [...project.dependencies].sort(
    (a, b) => (rowOf.get(a.predecessorId) ?? 0) - (rowOf.get(b.predecessorId) ?? 0),
  );
  for (const d of deps) {
    const pr = rowOf.get(d.predecessorId);
    const sr = rowOf.get(d.successorId);
    if (pr === undefined || sr === undefined) continue;
    if (!preds.has(d.successorId)) preds.set(d.successorId, []);
    preds.get(d.successorId)!.push(formatLink(pr, d.type, d.lag, d.lagUnit));
    if (!succs.has(d.predecessorId)) succs.set(d.predecessorId, []);
    succs.get(d.predecessorId)!.push(formatLink(sr, d.type, d.lag, d.lagUnit));
  }
  for (const list of succs.values()) list.sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
  v = {
    preds: new Map([...preds].map(([k, l]) => [k, l.join(', ')])),
    succs: new Map([...succs].map(([k, l]) => [k, l.join(', ')])),
  };
  linkTextCache.set(project, v);
  return v;
}

export function responsibleParties(project: Project): string[] {
  return [...new Set(project.tasks.map((t) => t.responsible).filter(Boolean))].sort();
}
