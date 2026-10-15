export type Zoom = 'day' | 'week' | 'month' | 'quarter';
export const ZOOMS: Zoom[] = ['day', 'week', 'month', 'quarter'];

export type ColumnKey =
  | 'id'
  | 'indicators'
  | 'wbs'
  | 'name'
  | 'duration'
  | 'start'
  | 'finish'
  | 'predecessors'
  | 'successors'
  | 'responsible'
  | 'percent'
  | 'totalFloat'
  | 'baselineStart'
  | 'baselineFinish'
  | 'finishVariance'
  | 'notes';

export interface Prefs {
  zoom: Zoom;
  showCritical: boolean;
  criticalStyle: 'fill' | 'outline';
  showBaseline: boolean;
  showLabels: boolean;
  columns: Record<ColumnKey, boolean>;
  gridWidth: number;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_PREFS: Prefs = {
  zoom: 'month',
  showCritical: true,
  criticalStyle: 'fill',
  showBaseline: true,
  showLabels: true,
  columns: {
    id: true,
    indicators: true,
    wbs: true,
    name: true,
    duration: true,
    start: true,
    finish: true,
    predecessors: true,
    successors: false,
    responsible: true,
    percent: true,
    totalFloat: true,
    baselineStart: false,
    baselineFinish: false,
    finishVariance: false,
    notes: false,
  },
  gridWidth: 760,
  theme: 'system',
};

const KEY = 'condo-gantt:prefs';

/** UI preferences are a per-browser convenience; failures fall back to defaults. */
export function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return structuredClone(DEFAULT_PREFS);
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      ...DEFAULT_PREFS,
      ...p,
      columns: { ...DEFAULT_PREFS.columns, ...(p.columns ?? {}) },
    };
  } catch {
    return structuredClone(DEFAULT_PREFS);
  }
}

export function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable */
  }
}
