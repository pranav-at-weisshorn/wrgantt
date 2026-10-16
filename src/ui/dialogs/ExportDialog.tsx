import { useMemo, useState } from 'react';
import { dayToIso, isValidIso } from '../../engine';
import {
  buildReport,
  describeReport,
  SCOPE_LABEL,
  type ExportFormat,
  type ReportOptions,
  type ReportScope,
  type ScaleChoice,
} from '../../io/report';
import { useDerived, useStore } from '../../store/store';
import { exportExcel, exportHtml } from '../importExport';
import { printNow } from '../print/PrintView';
import { usePrintState } from '../print/printState';
import { Modal } from './Modal';
import './export.css';

const FORMATS: { id: ExportFormat; label: string; action: string; hint: string }[] = [
  {
    id: 'pdf',
    label: 'PDF',
    action: 'Create PDF…',
    hint: 'Opens the print dialog; choose “Save as PDF” as the printer.',
  },
  {
    id: 'excel',
    label: 'Excel',
    action: 'Download Excel',
    hint: 'A workbook with a summary, the task table and a shaded Gantt chart.',
  },
  {
    id: 'html',
    label: 'Web page',
    action: 'Download web page',
    hint: 'One file that opens on any phone or computer, with zoom, search and filters.',
  },
];

function Check(props: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: string;
  disabled?: boolean;
}) {
  return (
    <label className="row-inline export-check">
      <input
        type="checkbox"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
      {props.children}
    </label>
  );
}

export function ExportDialog() {
  const setDialog = useStore((s) => s.setDialog);
  const project = useStore((s) => s.project);
  const derived = useDerived();
  const { format, options, setFormat, patch } = usePrintState();
  const [busy, setBusy] = useState(false);
  const close = () => setDialog(null);

  const report = useMemo(
    () => (project && derived ? buildReport(project, derived, options) : null),
    [project, derived, options],
  );
  if (!project || !derived || !report) return null;

  const spec = FORMATS.find((f) => f.id === format)!;
  const customInvalid =
    options.range === 'custom' && !(isValidIso(options.customFrom) && isValidIso(options.customTo));
  const set = <K extends keyof ReportOptions>(key: K, value: ReportOptions[K]) =>
    patch({ [key]: value } as Partial<ReportOptions>);

  const chooseRange = (range: ReportOptions['range']) => {
    if (range === 'custom') {
      patch({
        range,
        customFrom: isValidIso(options.customFrom)
          ? options.customFrom
          : dayToIso(report.kpis.projectStart),
        customTo: isValidIso(options.customTo)
          ? options.customTo
          : dayToIso(report.kpis.projectFinish),
      });
    } else patch({ range });
  };

  const run = async () => {
    if (customInvalid) return;
    if (format === 'pdf') {
      close();
      printNow(options);
      return;
    }
    setBusy(true);
    try {
      if (format === 'excel') await exportExcel(project, options);
      else await exportHtml(project, options);
      close();
    } finally {
      setBusy(false);
    }
  };

  const scales: [ScaleChoice, string][] =
    format === 'excel'
      ? [
          ['auto', 'Automatic (monthly beyond 18 months)'],
          ['week', 'Weekly'],
          ['month', 'Monthly'],
        ]
      : [
          ['auto', 'Automatic'],
          ['week', 'Weekly'],
          ['month', 'Monthly'],
          ['quarter', 'Quarterly'],
        ];

  return (
    <Modal
      title="Export for review"
      onClose={close}
      testId="export-dialog"
      wide
      footer={
        <>
          <button className="btn" onClick={close}>
            Cancel
          </button>
          <button
            className="btn primary"
            data-testid="export-run"
            disabled={customInvalid || busy}
            onClick={() => void run()}
          >
            {spec.action}
          </button>
        </>
      }
    >
      <div className="modal-body export-body">
        <div className="seg export-formats" role="group" aria-label="Format">
          {FORMATS.map((f) => (
            <button
              key={f.id}
              className={`btn${format === f.id ? ' active' : ''}`}
              data-testid={`export-format-${f.id}`}
              aria-pressed={format === f.id}
              onClick={() => setFormat(f.id)}
            >
              {f.label}
            </button>
          ))}
        </div>
        <p className="hint export-hint">{spec.hint}</p>

        <div className="form export-form">
          <label htmlFor="ex-scope">Rows</label>
          <select
            id="ex-scope"
            className="select"
            value={options.scope}
            onChange={(e) => set('scope', e.target.value as ReportScope)}
          >
            {(Object.keys(SCOPE_LABEL) as ReportScope[]).map((s) => (
              <option key={s} value={s}>
                {SCOPE_LABEL[s]}
              </option>
            ))}
          </select>

          <label htmlFor="ex-range">Date range</label>
          <div className="row-inline">
            <select
              id="ex-range"
              className="select"
              value={options.range}
              onChange={(e) => chooseRange(e.target.value as ReportOptions['range'])}
            >
              <option value="project">Whole project</option>
              <option value="custom">Custom dates</option>
              <option value="lookAhead">Look ahead from the status date</option>
            </select>
            {options.range === 'custom' && (
              <>
                <input
                  className="input"
                  type="date"
                  aria-label="From"
                  value={options.customFrom}
                  onChange={(e) => set('customFrom', e.target.value)}
                />
                <span>to</span>
                <input
                  className="input"
                  type="date"
                  aria-label="To"
                  value={options.customTo}
                  onChange={(e) => set('customTo', e.target.value)}
                />
              </>
            )}
            {options.range === 'lookAhead' && (
              <select
                className="select"
                aria-label="Weeks to look ahead"
                value={options.lookAheadWeeks}
                onChange={(e) => set('lookAheadWeeks', Number(e.target.value))}
              >
                {[6, 12, 26].map((w) => (
                  <option key={w} value={w}>
                    {w} weeks
                  </option>
                ))}
              </select>
            )}
          </div>
          {customInvalid && <div className="err full">Enter a valid start and end date.</div>}

          {format !== 'html' && (
            <>
              <label htmlFor="ex-scale">Time scale</label>
              <select
                id="ex-scale"
                className="select"
                value={options.scale === 'quarter' && format === 'excel' ? 'month' : options.scale}
                onChange={(e) => set('scale', e.target.value as ScaleChoice)}
              >
                {scales.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
            </>
          )}

          {format === 'pdf' && (
            <>
              <label htmlFor="ex-layout">Timeline pages</label>
              <div className="row-inline">
                <select
                  id="ex-layout"
                  className="select"
                  value={options.layout}
                  onChange={(e) => set('layout', e.target.value as ReportOptions['layout'])}
                >
                  <option value="fit">Whole range fitted to one page width</option>
                  <option value="split">Split into time slices</option>
                </select>
                {options.layout === 'split' && (
                  <select
                    className="select"
                    aria-label="Months per page"
                    value={options.monthsPerPage}
                    onChange={(e) => set('monthsPerPage', Number(e.target.value) as 3 | 6 | 12)}
                  >
                    <option value={3}>3 months per page</option>
                    <option value={6}>6 months per page</option>
                    <option value={12}>12 months per page</option>
                  </select>
                )}
              </div>
              <label htmlFor="ex-paper">Paper</label>
              <select
                id="ex-paper"
                className="select"
                value={options.paper}
                onChange={(e) => set('paper', e.target.value as ReportOptions['paper'])}
              >
                <option value="A4">A4 landscape</option>
                <option value="A3">A3 landscape</option>
              </select>
            </>
          )}
        </div>

        <div className="export-checks">
          <Check checked={options.includeSummary} onChange={(v) => set('includeSummary', v)}>
            {format === 'pdf'
              ? 'Summary pages (key figures, milestones, phases, watch list)'
              : format === 'excel'
                ? 'Summary sheet (key figures, milestones, phases, watch list)'
                : 'Overview and watch list tabs'}
          </Check>
          <Check checked={options.includeBaseline} onChange={(v) => set('includeBaseline', v)}>
            Show the baseline (grey) to make slippage visible
          </Check>
          <Check checked={options.highlightCritical} onChange={(v) => set('highlightCritical', v)}>
            Highlight the critical path in red
          </Check>
          <Check checked={options.includeWorstCase} onChange={(v) => set('includeWorstCase', v)}>
            Show worst-case extra time (hatched) and the worst-case finish
          </Check>
          {format === 'pdf' && (
            <>
              <Check checked={options.statusColumns} onChange={(v) => set('statusColumns', v)}>
                Show status columns (complete, status, schedule signal)
              </Check>
              <Check
                checked={options.hideEmptyRows}
                disabled={options.layout !== 'split'}
                onChange={(v) => set('hideEmptyRows', v)}
              >
                Leave out rows that have no bar on a page (split pages only)
              </Check>
            </>
          )}
        </div>

        <div className="export-result" data-testid="export-description">
          <span className="caps">You will get</span>
          <div>{describeReport(format, report)}</div>
        </div>
      </div>
    </Modal>
  );
}
