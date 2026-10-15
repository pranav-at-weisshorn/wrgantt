import { produce, type Draft } from 'immer';
import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { buildOutline, detectCycle, renumber, type Project } from '../engine';
import { derive } from './derive';
import { loadPrefs, savePrefs, type Prefs } from './prefs';

export const HISTORY_LIMIT = 200;

export interface Filters {
  search: string;
  phaseId: string;
  responsible: string;
  criticalOnly: boolean;
  slipped: boolean;
  inProgress: boolean;
  milestones: boolean;
}

export const EMPTY_FILTERS: Filters = {
  search: '',
  phaseId: '',
  responsible: '',
  criticalOnly: false,
  slipped: false,
  inProgress: false,
  milestones: false,
};

export type DialogState =
  | { kind: 'task'; taskId: string; tab?: 'general' | 'predecessors' | 'successors' | 'notes' }
  | { kind: 'link'; depId: string }
  | { kind: 'settings' }
  | { kind: 'baselines' }
  | { kind: 'progress' }
  | { kind: 'print' }
  | {
      kind: 'confirm';
      title: string;
      message: string;
      confirmLabel?: string;
      onConfirm: () => void;
    }
  | null;

export interface Toast {
  id: number;
  text: string;
  kind: 'error' | 'info';
}

export interface ScrollRequest {
  taskId?: string;
  day?: number;
  nonce: number;
}

export interface ContextMenuState {
  taskId: string;
  x: number;
  y: number;
}

/** Ask the grid to open the inline editor on a cell (e.g. after "Insert task"). */
export interface EditRequest {
  taskId: string;
  col: 'name';
  nonce: number;
}

export interface CommitResult {
  ok: boolean;
  error?: string;
}

export interface CommitOptions {
  /** Hierarchy or order changed: renumber row IDs. */
  structural?: boolean;
  /** Do not show a toast on failure (caller shows the error inline). */
  quiet?: boolean;
}

interface State {
  project: Project | null;
  past: { project: Project; label: string }[];
  future: { project: Project; label: string }[];
  selectedId: string | null;
  collapsed: Record<string, boolean>;
  filters: Filters;
  dialog: DialogState;
  panel: 'health' | 'variance' | null;
  toasts: Toast[];
  prefs: Prefs;
  scrollRequest: ScrollRequest | null;
  printing: { collapsedToPhases: boolean } | null;
  contextMenu: ContextMenuState | null;
  editRequest: EditRequest | null;

  openProject: (p: Project) => void;
  closeProject: () => void;
  commit: (
    label: string,
    recipe: (draft: Draft<Project>) => void,
    opts?: CommitOptions,
  ) => CommitResult;
  undo: () => void;
  redo: () => void;
  select: (id: string | null, scroll?: boolean) => void;
  toggleCollapsed: (id: string) => void;
  collapseToPhases: () => void;
  expandAll: () => void;
  setFilters: (patch: Partial<Filters>) => void;
  setDialog: (d: DialogState) => void;
  setPanel: (p: State['panel']) => void;
  toast: (text: string, kind?: Toast['kind']) => void;
  dismissToast: (id: number) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  requestScroll: (r: Omit<ScrollRequest, 'nonce'>) => void;
  setPrinting: (p: State['printing']) => void;
  openContextMenu: (m: ContextMenuState | null) => void;
  requestEdit: (taskId: string) => void;
}

let toastSeq = 0;

export const useStore = create<State>()(
  immer((set, get) => ({
    project: null,
    past: [],
    future: [],
    selectedId: null,
    collapsed: {},
    filters: EMPTY_FILTERS,
    dialog: null,
    panel: null,
    toasts: [],
    prefs: loadPrefs(),
    scrollRequest: null,
    printing: null,
    contextMenu: null,
    editRequest: null,

    openProject: (p) => {
      // Normalise row numbering on load (imported files may be out of order).
      const project = produce(p, (d) => renumber(d.tasks));
      set({
        project,
        past: [],
        future: [],
        selectedId: null,
        collapsed: {},
        filters: EMPTY_FILTERS,
        dialog: null,
      });
    },

    closeProject: () =>
      set({ project: null, past: [], future: [], selectedId: null, dialog: null }),

    commit: (label, recipe, opts = {}) => {
      const prev = get().project;
      if (!prev) return { ok: false, error: 'No project open' };
      let next: Project;
      try {
        next = produce(prev, (d) => {
          recipe(d);
          if (opts.structural) renumber(d.tasks);
        });
      } catch (e) {
        const error = e instanceof Error ? e.message : String(e);
        if (!opts.quiet) get().toast(error, 'error');
        return { ok: false, error };
      }
      if (next === prev) return { ok: true };
      // Reject edits that would create a cycle before they are committed.
      const outline = buildOutline(next.tasks);
      const cycle = detectCycle(next, outline);
      if (cycle) {
        if (!opts.quiet) get().toast(cycle.message, 'error');
        return { ok: false, error: cycle.message };
      }
      derive(next, outline); // recalculate now so the next render is instant
      set((s) => {
        s.past.push({ project: prev, label });
        if (s.past.length > HISTORY_LIMIT) s.past.shift();
        s.future = [];
        s.project = next;
      });
      return { ok: true };
    },

    undo: () => {
      const { past, project } = get();
      if (!past.length || !project) return;
      const entry = past[past.length - 1];
      set((s) => {
        s.past.pop();
        s.future.push({ project, label: entry.label });
        s.project = entry.project;
      });
    },

    redo: () => {
      const { future, project } = get();
      if (!future.length || !project) return;
      const entry = future[future.length - 1];
      set((s) => {
        s.future.pop();
        s.past.push({ project, label: entry.label });
        s.project = entry.project;
      });
    },

    select: (id, scroll) => {
      set({ selectedId: id });
      if (id && scroll) get().requestScroll({ taskId: id });
    },

    toggleCollapsed: (id) =>
      set((s) => {
        if (s.collapsed[id]) delete s.collapsed[id];
        else s.collapsed[id] = true;
      }),

    collapseToPhases: () => {
      const p = get().project;
      if (!p) return;
      const { outline } = derive(p);
      const collapsed: Record<string, boolean> = {};
      for (const id of outline.children.get(null) ?? []) {
        if (outline.isSummary(id)) collapsed[id] = true;
      }
      set({ collapsed });
    },

    expandAll: () => set({ collapsed: {} }),

    setFilters: (patch) =>
      set((s) => {
        Object.assign(s.filters, patch);
      }),

    setDialog: (dialog) => set({ dialog }),
    setPanel: (panel) => set({ panel }),

    toast: (text, kind = 'info') => {
      const id = ++toastSeq;
      set((s) => {
        s.toasts.push({ id, text, kind });
      });
      setTimeout(() => get().dismissToast(id), kind === 'error' ? 7000 : 3500);
    },

    dismissToast: (id) =>
      set((s) => {
        s.toasts = s.toasts.filter((t) => t.id !== id);
      }),

    setPrefs: (patch) => {
      set((s) => {
        Object.assign(s.prefs, patch);
      });
      savePrefs(get().prefs);
    },

    requestScroll: (r) => set({ scrollRequest: { ...r, nonce: Date.now() + Math.random() } }),

    setPrinting: (printing) => set({ printing }),
    openContextMenu: (contextMenu) => set({ contextMenu }),
    requestEdit: (taskId) =>
      set({ editRequest: { taskId, col: 'name', nonce: Date.now() + Math.random() } }),
  })),
);

/** Derived data (outline, schedule, health) for the open project. */
export function useDerived() {
  const project = useStore((s) => s.project);
  return project ? derive(project) : null;
}
