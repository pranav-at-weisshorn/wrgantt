import { detectCycle } from './graph';
import { buildOutline, isSelfOrAncestor } from './outline';
import type { Dependency, DepType, LagUnit, Project } from './types';

export interface ParsedLink {
  rowId: number;
  type: DepType;
  lag: number;
  lagUnit: LagUnit;
}

const ITEM = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:\.\d+)?)\s*(ed|ew|wd|d|w)?)?$/i;

/** Parse "12, 18SS+10d, 23FF-2d, 30SF, 41FS+30ed". */
export function parseLinkList(text: string): { links: ParsedLink[]; errors: string[] } {
  const links: ParsedLink[] = [];
  const errors: string[] = [];
  const parts = text
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  for (const part of parts) {
    const m = ITEM.exec(part.replace(/\s+/g, ''));
    if (!m) {
      errors.push(`Cannot read "${part}". Use e.g. 12, 18SS+10d, 23FF-2d, 41FS+30ed`);
      continue;
    }
    const rowId = parseInt(m[1], 10);
    const type = ((m[2] ?? 'FS').toUpperCase() as DepType) || 'FS';
    let lag = m[4] ? parseFloat(m[4]) : 0;
    if (m[3] === '-') lag = -lag;
    const unit = (m[5] ?? 'd').toLowerCase();
    let lagUnit: LagUnit = 'wd';
    if (unit === 'ed') lagUnit = 'ed';
    else if (unit === 'w') lag *= 5;
    else if (unit === 'ew') {
      lag *= 7;
      lagUnit = 'ed';
    }
    links.push({ rowId, type, lag: Math.round(lag), lagUnit });
  }
  return { links, errors };
}

export function formatLag(lag: number, unit: LagUnit): string {
  if (!lag) return '';
  return `${lag > 0 ? '+' : '-'}${Math.abs(lag)}${unit === 'ed' ? 'ed' : 'd'}`;
}

export function formatLink(rowId: number | string, type: DepType, lag: number, unit: LagUnit) {
  if (type === 'FS' && !lag) return String(rowId);
  return `${rowId}${type}${formatLag(lag, unit)}`;
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
  const { links, errors } = parseLinkList(text);
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
