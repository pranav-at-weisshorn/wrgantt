import { detectCycle } from './graph';
import { DEP_TYPE_LABEL, lagText } from './labels';
import { workingDaysPerWeek } from './units';
import { buildOutline, isSelfOrAncestor } from './outline';
import type { Dependency, DepType, LagUnit, Project } from './types';

export interface ParsedLink {
  rowId: number;
  type: DepType;
  lag: number;
  lagUnit: LagUnit;
}

const TYPE_WORDS: Record<string, DepType> = {
  fs: 'FS',
  ss: 'SS',
  ff: 'FF',
  sf: 'SF',
  finishtostart: 'FS',
  starttostart: 'SS',
  finishtofinish: 'FF',
  starttofinish: 'SF',
};

const ITEM =
  /^(\d+)(fs|ss|ff|sf|finishtostart|starttostart|finishtofinish|starttofinish)?(?:([+-])(\d+(?:\.\d+)?)(workingdays?|wd|d|days?|calendardays?|elapseddays?|ed|workingweeks?|weeks?|w|calendarweeks?|ew)?)?$/;

/** Lower-case, unify dashes, join "Finish-to-Start" style words and drop spaces. */
function compact(part: string): string {
  return part
    .toLowerCase()
    .replace(/[‒-―−]/g, '-')
    .replace(/(finish|start)[\s-]*to[\s-]*(finish|start)/g, '$1to$2')
    .replace(/\s+/g, '');
}

export const PREDECESSOR_EXAMPLE = '12, 18 Start-to-Start +10 working days, 41 +30 calendar days';

/**
 * Parse a predecessor list. Accepts the full forms shown in the grid
 * ("18 Start-to-Start +10 working days, 41 Finish-to-Start +30 calendar days") and, as typing
 * shortcuts, the compact forms ("18SS+10d, 41FS+30ed"). The type defaults to Finish-to-Start.
 */
export function parseLinkList(
  text: string,
  perWeek = 5,
): { links: ParsedLink[]; errors: string[] } {
  const links: ParsedLink[] = [];
  const errors: string[] = [];
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = ITEM.exec(compact(part));
    if (!m) {
      errors.push(`Cannot read "${part}". Use e.g. ${PREDECESSOR_EXAMPLE}`);
      continue;
    }
    const rowId = parseInt(m[1], 10);
    const type = TYPE_WORDS[m[2] ?? 'fs'];
    let lag = m[4] ? parseFloat(m[4]) : 0;
    if (m[3] === '-') lag = -lag;
    const unit = m[5] ?? 'd';
    let lagUnit: LagUnit = 'wd';
    if (unit === 'ed' || unit.startsWith('calendarday') || unit.startsWith('elapsed'))
      lagUnit = 'ed';
    else if (unit === 'ew' || unit.startsWith('calendarweek')) {
      lag *= 7;
      lagUnit = 'ed';
    } else if (unit === 'w' || unit.includes('week')) lag *= perWeek;
    links.push({ rowId, type, lag: Math.round(lag), lagUnit });
  }
  return { links, errors };
}

export function formatLag(lag: number, unit: LagUnit): string {
  return lag ? lagText(lag, unit) : '';
}

/** "12 Finish-to-Start", "18 Start-to-Start +10 working days". */
export function formatLink(rowId: number | string, type: DepType, lag: number, unit: LagUnit) {
  const l = formatLag(lag, unit);
  return `${rowId} ${DEP_TYPE_LABEL[type]}${l ? ` ${l}` : ''}`;
}

export interface ResolveResult {
  ok: boolean;
  error?: string;
  /** New dependency list for the whole project (only when ok). */
  dependencies?: Dependency[];
}

/**
 * Replace all predecessors of `successorId` with the links described by `text`.
 * Validates unknown IDs, self links, links to own summary and cycles.
 */
export function resolvePredecessorText(
  project: Project,
  successorId: string,
  text: string,
  newId: () => string,
): ResolveResult {
  const { links, errors } = parseLinkList(text, workingDaysPerWeek(project));
  if (errors.length) return { ok: false, error: errors[0] };
  const byRow = new Map(project.tasks.map((t) => [t.rowId, t]));
  const byId = new Map(project.tasks.map((t) => [t.id, t]));
  const seen = new Set<string>();
  const existing = project.dependencies.filter((d) => d.successorId === successorId);
  const others = project.dependencies.filter((d) => d.successorId !== successorId);
  const next: Dependency[] = [];
  for (const l of links) {
    const pred = byRow.get(l.rowId);
    if (!pred) return { ok: false, error: `Unknown task ID ${l.rowId}` };
    if (pred.id === successorId) return { ok: false, error: `A task cannot depend on itself` };
    if (
      isSelfOrAncestor(byId, pred.id, successorId) ||
      isSelfOrAncestor(byId, successorId, pred.id)
    ) {
      return {
        ok: false,
        error: `Task ${l.rowId} is a summary of (or inside) this task; link would be circular`,
      };
    }
    if (seen.has(pred.id)) return { ok: false, error: `Task ${l.rowId} is listed twice` };
    seen.add(pred.id);
    const old = existing.find((d) => d.predecessorId === pred.id);
    next.push({
      id: old?.id ?? newId(),
      predecessorId: pred.id,
      successorId,
      type: l.type,
      lag: l.lag,
      lagUnit: l.lagUnit,
    });
  }
  const dependencies = [...others, ...next];
  const cycle = detectCycle({ ...project, dependencies }, buildOutline(project.tasks));
  if (cycle) return { ok: false, error: cycle.message };
  return { ok: true, dependencies };
}
