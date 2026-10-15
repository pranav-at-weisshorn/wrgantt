import { create } from 'zustand';
import {
  DEFAULT_OPTIONS,
  DEFAULT_SCOPE,
  type ExportFormat,
  type ReportOptions,
} from '../../io/report';

/** Export dialog choices, kept apart from the project store. */
interface PrintState {
  format: ExportFormat;
  options: ReportOptions;
  /** True once the user picked a scope, so switching format no longer resets it. */
  scopeTouched: boolean;
  /** Options the print view renders while printing; null = Ctrl+P defaults. */
  active: ReportOptions | null;
  setFormat: (format: ExportFormat) => void;
  patch: (patch: Partial<ReportOptions>) => void;
  setActive: (options: ReportOptions | null) => void;
}

export const INITIAL_OPTIONS: ReportOptions = { ...DEFAULT_OPTIONS, scope: DEFAULT_SCOPE.pdf };

/** What Ctrl+P prints: the full schedule, whole window, fitted to the page width. */
export const BROWSER_PRINT_OPTIONS: ReportOptions = {
  ...DEFAULT_OPTIONS,
  scope: 'all',
  range: 'project',
  layout: 'fit',
  includeSummary: false,
  paper: 'A4',
};

export const usePrintState = create<PrintState>()((set) => ({
  format: 'pdf',
  options: INITIAL_OPTIONS,
  scopeTouched: false,
  active: null,
  setFormat: (format) =>
    set((s) => ({
      format,
      options: s.scopeTouched ? s.options : { ...s.options, scope: DEFAULT_SCOPE[format] },
    })),
  patch: (patch) =>
    set((s) => ({
      options: { ...s.options, ...patch },
      scopeTouched: s.scopeTouched || patch.scope !== undefined,
    })),
  setActive: (active) => set({ active }),
}));

// Dev builds expose the state so end-to-end checks can drive the print view.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  (window as unknown as { __printState: typeof usePrintState }).__printState = usePrintState;
}
