import { useEffect, useMemo, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { format } from 'date-fns';
import { dayToLocalDate, days, HEALTH_SIGNAL_LABEL, STATUS_LABEL } from '../../engine';
import type { ScheduleHealth, TaskStatus } from '../../engine';
import {
  buildReport,
  CRITICAL_COLOR,
  PAGE_PX,
  PDF_ROW_H,
  SCOPE_LABEL,
  SIGNAL_COLOR,
  STATUS_COLOR,
  type Report,
  type ReportOptions,
  type ReportRow,
  type ReportSlice,
  type ReportTick,
} from '../../io/report';
import { useDerived, useStore } from '../../store/store';
import { BROWSER_PRINT_OPTIONS, usePrintState } from './printState';
import './print.css';

const fmtD = (d: number | null) => (d === null ? '' : format(dayToLocalDate(d), 'd MMM yyyy'));
const fmtT = (d: number | null) => (d === null ? '' : format(dayToLocalDate(d), 'dd MMM yy'));
const varText = (v: number | null) =>
  v === null ? '' : v === 0 ? 'On baseline' : `${v > 0 ? '+' : ''}${days(v, 'working day')}`;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Start printing with the given options (renders the print view first). */
export function printNow(options: ReportOptions) {
  usePrintState.getState().setActive(options);
  flushSync(() => useStore.getState().setPrinting({ collapsedToPhases: false }));
  requestAnimationFrame(() => window.print());
}

/**
 * Print-only management report: an optional two-page summary followed by the timeline, drawn
 * with SVG at the real pixel width of the chosen paper. Hidden on screen.
 */
export function PrintView() {
  const printing = useStore((s) => s.printing);
  const project = useStore((s) => s.project);
  const derived = useDerived();
  const active = usePrintState((s) => s.active);
  const options = active ?? BROWSER_PRINT_OPTIONS;

  // Browser Ctrl+P / File > Print also gets the full layout.
  useEffect(() => {
    const before = () => {
      if (!useStore.getState().printing) {
        usePrintState.getState().setActive(null);
        flushSync(() => useStore.getState().setPrinting({ collapsedToPhases: false }));
      }
    };
    const after = () => {
      useStore.getState().setPrinting(null);
      usePrintState.getState().setActive(null);
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  const report = useMemo(
    () => (printing && project && derived ? buildReport(project, derived, options) : null),
    [printing, project, derived, options],
  );
  if (!report) return null;

  const { width } = PAGE_PX[options.paper];
  return (
    <div className="print-root pv" data-testid="print-view">
      <style>{`@page { size: ${options.paper} landscape; margin: 10mm; }`}</style>
      <HatchDefs />
      {options.includeSummary && (
        <>
          <SummaryPage report={report} width={width} />
          <WatchPage report={report} width={width} />
        </>
      )}
      {report.slices.map((slice, i) => (
        <TimelineSlice
          key={slice.index}
          report={report}
          slice={slice}
          width={width}
          breakBefore={i > 0 || options.includeSummary}
        />
      ))}
      {report.slices.length === 0 && (
        <div className="pv-page pv-break" style={{ width }}>
          <div className="pv-nodata">Nothing to show for the chosen options.</div>
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------ shared bits

/** Diagonal hatching for worst-case extra time, shared by every SVG in the print view. */
function HatchDefs() {
  const pattern = (id: string, stroke: string) => (
    <pattern
      id={id}
      patternUnits="userSpaceOnUse"
      width={5}
      height={5}
      patternTransform="rotate(45)"
    >
      <rect width={5} height={5} fill="#FFFFFF" />
      <line x1={0} y1={0} x2={0} y2={5} stroke={stroke} strokeWidth={2} />
    </pattern>
  );
  return (
    <svg width={0} height={0} style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        {pattern('pv-hatch', '#8C7067')}
        {pattern('pv-hatch-crit', CRITICAL_COLOR)}
      </defs>
    </svg>
  );
}

/** Hatched worst-case extension after a bar (or milestone), clipped to the slice. */
function worstCaseHatch(
  row: ReportRow,
  slice: ReportSlice,
  x: (d: number) => number,
  width: number,
  critical: boolean,
  y: number,
  h: number,
): ReactNode {
  if (row.worstEnd === null) return null;
  const fromDay = row.kind === 'milestone' ? row.start + 1 : row.finish + 1;
  const toDay = row.worstEnd + 1;
  if (toDay <= slice.from || fromDay >= slice.to || toDay <= fromDay) return null;
  const x1 = clamp(x(fromDay), 0, width);
  const x2 = clamp(x(toDay), 0, width);
  return (
    <rect
      x={x1}
      y={y}
      width={Math.max(1.5, x2 - x1)}
      height={h}
      fill={`url(#${critical ? 'pv-hatch-crit' : 'pv-hatch'})`}
      stroke={critical ? CRITICAL_COLOR : '#8C7067'}
      strokeWidth={0.6}
      strokeDasharray="2 1.5"
    />
  );
}

function SignalDot({ signal }: { signal: ScheduleHealth }) {
  return (
    <span
      className={`pv-dot${signal === 'complete' ? ' ring' : ''}`}
      style={{ background: SIGNAL_COLOR[signal] }}
    />
  );
}

function Top({ report, label }: { report: Report; label: string }) {
  return (
    <div className="pv-top">
      <span className="mark">Villa Felstead</span>
      <span className="caps">
        {label} · {report.projectName}
      </span>
    </div>
  );
}

// ------------------------------------------------------------------------- summary page 1

function Stack({
  items,
  total,
}: {
  items: { label: string; n: number; color: string; ring?: boolean }[];
  total: number;
}) {
  return (
    <>
      <div className="pv-stack">
        {items.map(
          (it) =>
            it.n > 0 && (
              <i
                key={it.label}
                style={{ width: `${(it.n / Math.max(1, total)) * 100}%`, background: it.color }}
              />
            ),
        )}
      </div>
      <div className="pv-legend">
        {items.map((it) => (
          <span key={it.label}>
            <span className={`pv-dot${it.ring ? ' ring' : ''}`} style={{ background: it.color }} />
            {it.label} {it.n}
          </span>
        ))}
      </div>
    </>
  );
}

function SummaryPage({ report, width }: { report: Report; width: number }) {
  const k = report.kpis;
  const sc = k.signalCounts;
  const variance = k.finishVariance;
  const varClass = variance === null ? 'muted' : variance > 0 ? 'late' : 'onTrack';
  const leftW = Math.round((width - 22) * 0.43);
  const rightW = width - 22 - leftW;
  const ov = report.overview;
  const span = ov.to - ov.from;
  const nameW = 150;
  const barW = rightW - nameW - 60 - 60 - 34 - 6;
  const bx = (d: number) => ((d - ov.from) / span) * barW;
  const todayDayNumber = report.generatedDay;
  const msWorst = report.milestones.some((m) => m.worstCase !== null);

  return (
    <div className="pv-page" style={{ width }}>
      <Top report={report} label="Management summary" />
      <div className="pv-title">{report.projectName}</div>
      <div className="pv-sub">
        Status date {fmtD(k.statusDay)} ·{' '}
        {k.baselineName ? `Baseline: ${k.baselineName}` : 'No baseline saved'} · Created{' '}
        {fmtD(report.generatedDay)}
      </div>
      <div className={`pv-tiles${k.worstCaseFinish !== null ? ' six' : ''}`}>
        <div className="pv-tile">
          <div className="caps">Project finish</div>
          <div className="v">{fmtD(k.projectFinish)}</div>
          <div className={`s ${varClass}`}>
            {variance === null ? 'No baseline to compare with' : varText(variance)}
          </div>
        </div>
        {k.worstCaseFinish !== null && (
          <div className="pv-tile">
            <div className="caps">Worst-case finish</div>
            <div className="v late">{fmtD(k.worstCaseFinish)}</div>
            <div className="s late">+{k.worstCaseDelay} working days if every task overruns</div>
          </div>
        )}
        <div className="pv-tile">
          <div className="caps">Baseline finish</div>
          <div className="v">{k.baselineFinish === null ? 'None' : fmtD(k.baselineFinish)}</div>
          <div className="s">Project start {fmtD(k.projectStart)}</div>
        </div>
        <div className="pv-tile">
          <div className="caps">Overall complete</div>
          <div className="v">{Math.round(k.percentComplete)}%</div>
          <div className="pv-meter">
            <i style={{ width: `${k.percentComplete}%` }} />
          </div>
        </div>
        <div className="pv-tile">
          <div className="caps">Critical tasks left</div>
          <div className={`v ${k.criticalRemaining ? 'late' : ''}`}>{k.criticalRemaining}</div>
          <div className="s">
            {k.taskCount} tasks, {k.milestoneCount} milestones
          </div>
        </div>
        <div className="pv-tile">
          <div className="caps">Schedule signal</div>
          <Stack
            total={k.taskCount}
            items={[
              { label: 'Late', n: sc.late, color: SIGNAL_COLOR.late },
              { label: 'At risk', n: sc.atRisk, color: SIGNAL_COLOR.atRisk },
              { label: 'On track', n: sc.onTrack, color: SIGNAL_COLOR.onTrack },
              { label: 'Complete', n: sc.complete, color: SIGNAL_COLOR.complete, ring: true },
            ]}
          />
        </div>
      </div>

      <div className="pv-cols">
        <div className="pv-col" style={{ width: leftW }}>
          <h3>Milestones</h3>
          <table className="pv-table">
            <colgroup>
              <col />
              <col style={{ width: 62 }} />
              {msWorst && <col style={{ width: 62 }} />}
              <col style={{ width: 62 }} />
              <col style={{ width: 70 }} />
            </colgroup>
            <thead>
              <tr>
                <th>Milestone</th>
                <th>Planned</th>
                {msWorst && <th>Worst case</th>}
                <th>Baseline</th>
                <th className="r">Variance</th>
              </tr>
            </thead>
            <tbody>
              {report.milestones.map((m) => (
                <tr key={m.id} className={m.status === 'complete' ? 'done' : undefined}>
                  <td>
                    <span className="sig">
                      <SignalDot signal={m.signal} /> {m.name}
                    </span>
                  </td>
                  <td>{fmtT(m.planned)}</td>
                  {msWorst && (
                    <td className="late">{m.worstCase === null ? '' : fmtT(m.worstCase)}</td>
                  )}
                  <td>{fmtT(m.baseline)}</td>
                  <td
                    className={`r ${m.variance !== null && m.variance > 0 && m.status !== 'complete' ? 'late' : ''}`}
                  >
                    {m.variance === null
                      ? ''
                      : m.variance === 0
                        ? 'On plan'
                        : `${m.variance > 0 ? '+' : ''}${m.variance} days`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="pv-col" style={{ width: rightW }}>
          <h3>Phases</h3>
          <table className="pv-table">
            <colgroup>
              <col style={{ width: nameW }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 60 }} />
              <col style={{ width: 34 }} />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th>Phase</th>
                <th>Start</th>
                <th>Finish</th>
                <th className="r">Done</th>
                <th className="svgc">
                  <svg width={barW + 6} height={14}>
                    {ov.top.map((t) => (
                      <g key={t.day}>
                        <line x1={bx(t.day)} x2={bx(t.day)} y1={0} y2={14} stroke="#C3B6AB" />
                        {bx(t.end) - bx(t.day) > 28 && (
                          <text x={bx(t.day) + 3} y={10} fontSize={8} fill="#8C7067">
                            {t.label}
                          </text>
                        )}
                      </g>
                    ))}
                  </svg>
                </th>
              </tr>
            </thead>
            <tbody>
              {report.phases.map((p) => {
                const w = Math.max(2, bx(p.finish + 1) - bx(p.start));
                return (
                  <tr key={p.id}>
                    <td style={{ height: 24 }}>
                      <span className="sig">
                        <SignalDot signal={p.signal} /> {p.name}
                      </span>
                    </td>
                    <td>{fmtT(p.start)}</td>
                    <td>{fmtT(p.finish)}</td>
                    <td className="r">{p.percent}%</td>
                    <td className="svgc" style={{ height: 24 }}>
                      <svg width={barW + 6} height={24}>
                        {ov.bottom.map((t) => (
                          <line
                            key={t.day}
                            x1={bx(t.day)}
                            x2={bx(t.day)}
                            y1={0}
                            y2={24}
                            stroke="#ECE8E3"
                          />
                        ))}
                        {report.options.includeBaseline && p.baselineStart !== null && (
                          <rect
                            x={bx(p.baselineStart)}
                            y={17}
                            width={Math.max(
                              2,
                              bx((p.baselineFinish ?? p.baselineStart) + 1) - bx(p.baselineStart),
                            )}
                            height={3}
                            fill="#C4B8AD"
                          />
                        )}
                        <rect
                          x={bx(p.start)}
                          y={6}
                          width={w}
                          height={10}
                          fill={p.color}
                          fillOpacity={0.4}
                        />
                        <rect
                          x={bx(p.start)}
                          y={6}
                          width={(w * p.percent) / 100}
                          height={10}
                          fill={p.color}
                        />
                        <line
                          x1={bx(report.statusDay)}
                          x2={bx(report.statusDay)}
                          y1={0}
                          y2={24}
                          stroke="#8C7067"
                          strokeDasharray="3 2"
                        />
                        {todayDayNumber !== report.statusDay &&
                          todayDayNumber >= ov.from &&
                          todayDayNumber <= ov.to && (
                            <line
                              x1={bx(todayDayNumber)}
                              x2={bx(todayDayNumber)}
                              y1={0}
                              y2={24}
                              stroke="#462F28"
                            />
                          )}
                      </svg>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="pv-lg">
            <span>
              <svg width={14} height={8}>
                <line x1={1} x2={1} y1={0} y2={8} stroke="#8C7067" strokeDasharray="3 2" />
              </svg>
              Status date
            </span>
            <span>
              <svg width={18} height={8}>
                <rect x={0} y={1} width={18} height={3} fill="#C4B8AD" />
              </svg>
              Baseline
            </span>
            <span>Shaded bar: planned. Solid part: complete.</span>
          </div>
        </div>
      </div>
      <SignalLegend />
    </div>
  );
}

function SignalLegend() {
  const items: [ScheduleHealth, string][] = [
    ['late', 'Late: negative float, or critical and behind the baseline'],
    ['atRisk', 'At risk: behind the baseline, blocked, on hold or constrained'],
    ['onTrack', 'On track'],
    ['complete', 'Complete'],
  ];
  return (
    <div
      className="pv-lg"
      style={{ marginTop: 10, borderTop: '0.5px solid #D9D0C8', paddingTop: 6 }}
    >
      <span className="caps">Schedule signal</span>
      {items.map(([s, text]) => (
        <span key={s}>
          <SignalDot signal={s} /> {text}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------------- summary page 2

function WatchPage({ report, width }: { report: Report; width: number }) {
  const half = Math.round((width - 22) / 2);
  const next = report.nextWeeks.slice(0, 22);
  return (
    <div className="pv-page pv-break" style={{ width }}>
      <Top report={report} label="Watch list" />
      <div className="pv-title">What needs attention</div>
      <div className="pv-sub">
        Status date {fmtD(report.statusDay)}
        {report.kpis.baselineName ? ` · Baseline: ${report.kpis.baselineName}` : ''}
      </div>
      <div className="pv-cols">
        <div className="pv-col" style={{ width: half }}>
          <h3>Top 10 slipping or late tasks</h3>
          {report.slipping.length === 0 ? (
            <p className="muted">No open task is late or behind its baseline.</p>
          ) : (
            <table className="pv-table">
              <colgroup>
                <col />
                <col style={{ width: 62 }} />
                <col style={{ width: 62 }} />
                <col style={{ width: 96 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Finish</th>
                  <th>Baseline</th>
                  <th className="r">Variance</th>
                </tr>
              </thead>
              <tbody>
                {report.slipping.map((t) => (
                  <tr key={t.id}>
                    <td title={t.phaseName}>
                      <span className="sig">
                        <SignalDot signal={t.signal} /> {t.name}
                      </span>
                    </td>
                    <td>{fmtT(t.finish)}</td>
                    <td>{fmtT(t.baselineFinish)}</td>
                    <td
                      className={`r ${t.variance !== null && t.variance > 0 ? 'late' : 'atRisk'}`}
                    >
                      {t.variance !== null && t.variance > 0
                        ? `+${t.variance} working days`
                        : `Float ${t.totalFloat ?? 0}`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="pv-col" style={{ width: width - 22 - half }}>
          <h3>
            Next four weeks · {fmtT(report.nextWindow.from)} to {fmtT(report.nextWindow.to - 1)}
          </h3>
          {next.length === 0 ? (
            <p className="muted">Nothing starts or finishes in this period.</p>
          ) : (
            <table className="pv-table">
              <colgroup>
                <col />
                <col style={{ width: 62 }} />
                <col style={{ width: 124 }} />
              </colgroup>
              <thead>
                <tr>
                  <th>Task</th>
                  <th>Date</th>
                  <th>What happens</th>
                </tr>
              </thead>
              <tbody>
                {next.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <span className="sig">
                        <SignalDot signal={t.signal} /> {t.name}
                      </span>
                    </td>
                    <td>{fmtT(t.date)}</td>
                    <td>{t.event === 'milestone' ? 'Milestone' : `Task ${t.event}`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {report.nextWeeks.length > next.length && (
            <p className="muted">and {report.nextWeeks.length - next.length} more</p>
          )}
        </div>
      </div>
      <SignalLegend />
    </div>
  );
}

// ------------------------------------------------------------------------------- timeline

function colWidths(options: ReportOptions, width: number) {
  const name = options.paper === 'A3' ? 300 : 230;
  const cols = options.statusColumns
    ? { name, start: 58, finish: 58, pct: 34, status: 68, signal: 74 }
    : { name, start: 58, finish: 58, pct: 0, status: 0, signal: 0 };
  const gantt =
    width - (cols.name + cols.start + cols.finish + cols.pct + cols.status + cols.signal);
  return { ...cols, gantt };
}

function tickLabel(t: ReportTick, w: number): string {
  const full = t.label.length * 5.4 + 8;
  if (w >= full) return t.label;
  return w >= t.short.length * 5.4 + 4 ? t.short : '';
}

function AxisHeader({ slice, width }: { slice: ReportSlice; width: number }) {
  const span = slice.to - slice.from;
  const x = (d: number) => ((d - slice.from) / span) * width;
  return (
    <svg width={width} height={36}>
      {slice.top.map((t) => (
        <g key={`t${t.day}`}>
          <line x1={x(t.day)} x2={x(t.day)} y1={0} y2={18} stroke="#8C7067" strokeWidth={0.7} />
          <text x={x(t.day) + 4} y={12} fontSize={9.5} fill="#2A211E">
            {tickLabel(t, x(t.end) - x(t.day))}
          </text>
        </g>
      ))}
      {slice.bottom.map((t) => (
        <g key={`b${t.day}`}>
          <line x1={x(t.day)} x2={x(t.day)} y1={18} y2={36} stroke="#C3B6AB" strokeWidth={0.6} />
          <text
            x={(x(t.day) + x(t.end)) / 2}
            y={30}
            fontSize={8.5}
            fill="#8C7067"
            textAnchor="middle"
          >
            {tickLabel(t, x(t.end) - x(t.day))}
          </text>
        </g>
      ))}
      <line x1={0} x2={width} y1={18} y2={18} stroke="#D9D0C8" strokeWidth={0.5} />
    </svg>
  );
}

function RowStrip({
  row,
  slice,
  width,
  report,
}: {
  row: ReportRow;
  slice: ReportSlice;
  width: number;
  report: Report;
}) {
  const H = PDF_ROW_H;
  const span = slice.to - slice.from;
  const x = (d: number) => ((d - slice.from) / span) * width;
  const opts = report.options;
  const color = opts.highlightCritical && row.critical ? CRITICAL_COLOR : row.color;
  const lines: ReactNode[] = [];
  const addLine = (day: number, stroke: string, dash?: string) => {
    if (day < slice.from || day > slice.to) return;
    lines.push(
      <line
        key={`l${stroke}${day}`}
        x1={x(day)}
        x2={x(day)}
        y1={0}
        y2={H}
        stroke={stroke}
        strokeWidth={0.9}
        strokeDasharray={dash}
      />,
    );
  };
  addLine(report.statusDay, '#8C7067', '3 2');
  if (report.generatedDay !== report.statusDay) addLine(report.generatedDay, '#462F28');

  let body: ReactNode = null;
  const showsBaseline =
    opts.includeBaseline && row.baselineStart !== null && row.baselineFinish !== null;
  if (row.kind === 'milestone') {
    if (row.start >= slice.from && row.start < slice.to) {
      const cx = x(row.start + 0.5);
      const r = 5.5;
      // Labels go after the worst-case hatching so they stay readable.
      const hatchEnd =
        opts.includeWorstCase && row.worstEnd !== null
          ? clamp(x(row.worstEnd + 1), 0, width)
          : -Infinity;
      const labelX = Math.max(cx + r + 4, hatchEnd + 3);
      const labelRight = labelX + 54 < width;
      body = (
        <>
          {showsBaseline && row.baselineFinish! >= slice.from && row.baselineFinish! < slice.to && (
            <rect
              x={x(row.baselineFinish! + 0.5) - 2}
              y={H - 4}
              width={4}
              height={2.5}
              fill="#C4B8AD"
            />
          )}
          <polygon
            points={`${cx},${H / 2 - r} ${cx + r},${H / 2} ${cx},${H / 2 + r} ${cx - r},${H / 2}`}
            fill={color}
          />
          <text
            x={labelRight ? labelX : cx - r - 4}
            y={H / 2 + 3}
            fontSize={8.5}
            fill="#2A211E"
            textAnchor={labelRight ? 'start' : 'end'}
          >
            {fmtT(row.start)}
          </text>
        </>
      );
    }
  } else if (row.start < slice.to && row.finish >= slice.from) {
    const x1 = clamp(x(row.start), 0, width);
    const x2 = clamp(x(row.finish + 1), 0, width);
    const w = Math.max(1.5, x2 - x1);
    const progress = (w * row.percent) / 100;
    const baseline =
      showsBaseline && row.baselineStart! < slice.to && row.baselineFinish! >= slice.from ? (
        <rect
          x={clamp(x(row.baselineStart!), 0, width)}
          y={H - 4.5}
          width={Math.max(
            1.5,
            clamp(x(row.baselineFinish! + 1), 0, width) - clamp(x(row.baselineStart!), 0, width),
          )}
          height={2.5}
          fill="#C4B8AD"
        />
      ) : null;
    if (row.kind === 'phase') {
      body = (
        <>
          {baseline}
          <rect x={x1} y={3} width={w} height={10} fill={row.color} fillOpacity={0.4} />
          <rect x={x1} y={3} width={progress} height={10} fill={row.color} />
          <rect x={x1} y={3} width={w} height={1.6} fill="#2A211E" />
          <rect x={x1} y={3} width={1.6} height={12} fill="#2A211E" />
          <rect x={x1 + w - 1.6} y={3} width={1.6} height={12} fill="#2A211E" />
        </>
      );
    } else if (row.kind === 'summary') {
      body = (
        <>
          {baseline}
          <rect x={x1} y={5} width={w} height={4} fill="#2A211E" />
          <rect x={x1} y={5} width={1.6} height={9} fill="#2A211E" />
          <rect x={x1 + w - 1.6} y={5} width={1.6} height={9} fill="#2A211E" />
        </>
      );
    } else {
      body = (
        <>
          {baseline}
          <rect x={x1} y={3.5} width={w} height={9} fill={color} fillOpacity={0.4} />
          {progress > 0 && <rect x={x1} y={3.5} width={progress} height={9} fill={color} />}
        </>
      );
    }
  }
  return (
    <svg width={width} height={H}>
      {slice.bottom.map((t) => (
        <line
          key={t.day}
          x1={x(t.day)}
          x2={x(t.day)}
          y1={0}
          y2={H}
          stroke="#F1EDE9"
          strokeWidth={0.6}
        />
      ))}
      {lines}
      {opts.includeWorstCase &&
        worstCaseHatch(
          row,
          slice,
          x,
          width,
          !!(opts.highlightCritical && row.critical),
          row.kind === 'phase' ? 4 : row.kind === 'summary' ? 5 : 4.5,
          row.kind === 'summary' ? 4 : 7,
        )}
      {body}
    </svg>
  );
}

function Legend({ report }: { report: Report }) {
  const o = report.options;
  return (
    <div className="pv-lg">
      <span>
        <svg width={22} height={10}>
          <rect x={0} y={1} width={22} height={8} fill="#8C7067" fillOpacity={0.4} />
          <rect x={0} y={1} width={11} height={8} fill="#8C7067" />
        </svg>
        Planned and complete
      </span>
      {o.highlightCritical && (
        <span>
          <svg width={14} height={10}>
            <rect x={0} y={1} width={14} height={8} fill={CRITICAL_COLOR} />
          </svg>
          Critical path
        </span>
      )}
      <span>
        <svg width={12} height={12}>
          <polygon points="6,0.5 11.5,6 6,11.5 0.5,6" fill="#462F28" />
        </svg>
        Milestone
      </span>
      {o.includeWorstCase && report.rows.some((r) => r.worstEnd !== null) && (
        <span>
          <svg width={22} height={10}>
            <rect
              x={0.5}
              y={1}
              width={21}
              height={8}
              fill="url(#pv-hatch)"
              stroke="#8C7067"
              strokeWidth={0.6}
              strokeDasharray="2 1.5"
            />
          </svg>
          Worst-case extra time
        </span>
      )}
      {o.includeBaseline && report.kpis.baselineName && (
        <span>
          <svg width={18} height={6}>
            <rect x={0} y={1} width={18} height={3} fill="#C4B8AD" />
          </svg>
          Baseline ({report.kpis.baselineName})
        </span>
      )}
      <span>
        <svg width={14} height={10}>
          <line
            x1={1}
            x2={1}
            y1={0}
            y2={10}
            stroke="#8C7067"
            strokeWidth={1.2}
            strokeDasharray="3 2"
          />
        </svg>
        Status date {fmtT(report.statusDay)}
      </span>
      {report.generatedDay !== report.statusDay && (
        <span>
          <svg width={8} height={10}>
            <line x1={1} x2={1} y1={0} y2={10} stroke="#462F28" strokeWidth={1.2} />
          </svg>
          Today
        </span>
      )}
    </div>
  );
}

function TimelineSlice(props: {
  report: Report;
  slice: ReportSlice;
  width: number;
  breakBefore: boolean;
}) {
  const { report, slice, width } = props;
  const o = report.options;
  const c = colWidths(o, width);
  const cols = 3 + (o.statusColumns ? 3 : 0) + 1;
  return (
    <div className={`pv-page${props.breakBefore ? ' pv-break' : ''}`} style={{ width }}>
      <Legend report={report} />
      <table className="pv-gt" style={{ width }}>
        <colgroup>
          <col style={{ width: c.name }} />
          <col style={{ width: c.start }} />
          <col style={{ width: c.finish }} />
          {o.statusColumns && (
            <>
              <col style={{ width: c.pct }} />
              <col style={{ width: c.status }} />
              <col style={{ width: c.signal }} />
            </>
          )}
          <col style={{ width: c.gantt }} />
        </colgroup>
        <thead>
          <tr className="titlerow">
            <th colSpan={cols}>
              <div className="in">
                <span className="mark">Villa Felstead</span>
                <span>
                  {report.projectName} · {slice.title}
                </span>
                <span className="caps">
                  {SCOPE_LABEL[o.scope]} ·{' '}
                  {report.unit === 'week'
                    ? 'weekly'
                    : report.unit === 'month'
                      ? 'monthly'
                      : 'quarterly'}
                </span>
              </div>
            </th>
          </tr>
          <tr>
            <th>Task</th>
            <th>Start</th>
            <th>Finish</th>
            {o.statusColumns && (
              <>
                <th style={{ textAlign: 'right' }}>Done</th>
                <th>Status</th>
                <th>Signal</th>
              </>
            )}
            <th className="svgc">
              <AxisHeader slice={slice} width={c.gantt} />
            </th>
          </tr>
        </thead>
        <tbody>
          {slice.rows.map((i) => {
            const row = report.rows[i];
            return (
              <tr
                key={row.id}
                className={row.kind === 'milestone' || row.kind === 'task' ? undefined : row.kind}
              >
                <td style={{ paddingLeft: 4 + row.depth * 10 }} title={row.name}>
                  <span
                    style={{
                      display: 'inline-block',
                      width: 6,
                      height: 6,
                      marginRight: 5,
                      background: row.color,
                    }}
                  />
                  {row.name}
                </td>
                <td>{fmtT(row.start)}</td>
                <td>{row.kind === 'milestone' ? '' : fmtT(row.finish)}</td>
                {o.statusColumns && (
                  <>
                    <td style={{ textAlign: 'right' }}>
                      {row.kind === 'milestone' ? '' : `${row.percent}%`}
                    </td>
                    <td style={{ color: STATUS_COLOR[row.status] }}>{statusText(row.status)}</td>
                    <td>
                      <span className="sig" style={{ color: SIGNAL_COLOR[row.signal] }}>
                        <SignalDot signal={row.signal} /> {signalText(row.signal)}
                      </span>
                    </td>
                  </>
                )}
                <td className="svgc">
                  <RowStrip row={row} slice={slice} width={c.gantt} report={report} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

const statusText = (s: TaskStatus) => STATUS_LABEL[s];
const signalText = (s: ScheduleHealth) => HEALTH_SIGNAL_LABEL[s];
