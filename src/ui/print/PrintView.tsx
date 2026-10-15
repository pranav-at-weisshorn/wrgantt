import { useEffect, type ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { activeBaseline, displayFinishDay, isoToDay, todayDay } from '../../engine';
import { useDerived, useStore } from '../../store/store';
import { fmtDay, fmtLong } from '../format';
import { phaseColorOf } from '../rows';
import { startOfMonth, startOfQuarter, startOfWeek, ticks } from '../timeline/scale';

const GW = 600; // gantt column width in SVG units (scaled to the printed column)
const RH = 14;

/** Start printing with the given options (renders the print view first). */
export function printNow(collapsedToPhases: boolean) {
  flushSync(() => useStore.getState().setPrinting({ collapsedToPhases }));
  requestAnimationFrame(() => window.print());
}

/**
 * Non-virtualised print layout: an HTML table whose <thead> repeats on every page, with one
 * small SVG Gantt strip per row, scaled to the page width. Hidden on screen.
 */
export function PrintView() {
  const printing = useStore((s) => s.printing);
  const project = useStore((s) => s.project);
  const derived = useDerived();
  const showCritical = useStore((s) => s.prefs.showCritical);

  // Browser Ctrl+P / File > Print also gets the full layout.
  useEffect(() => {
    const before = () => {
      if (!useStore.getState().printing)
        flushSync(() => useStore.getState().setPrinting({ collapsedToPhases: false }));
    };
    const after = () => useStore.getState().setPrinting(null);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
    };
  }, []);

  if (!printing || !project || !derived) return null;
  const { outline, schedule } = derived;
  const ids = printing.collapsedToPhases ? (outline.children.get(null) ?? []) : outline.flat;
  const bl = activeBaseline(project);

  let start = schedule.projectStart;
  let end = schedule.projectStart;
  for (const c of schedule.calc.values()) {
    start = Math.min(start, c.es);
    end = Math.max(end, c.ef, displayFinishDay(c) + 1);
  }
  const span = Math.max(1, end - start);
  const unit = span > 900 ? 'quarter' : span > 240 ? 'month' : 'week';
  const s0 =
    unit === 'quarter'
      ? startOfQuarter(start)
      : unit === 'month'
        ? startOfMonth(start)
        : startOfWeek(start);
  const total = end + 7 - s0;
  const x = (d: number) => ((d - s0) / total) * GW;
  const bottom = ticks(unit, s0, end + 7, 'bottom');
  const top = ticks(unit === 'week' ? 'month' : 'year', s0, end + 7, 'top');
  const status = isoToDay(project.statusDate);
  const today = todayDay();

  const header = (
    <svg viewBox={`0 0 ${GW} 26`} preserveAspectRatio="none" style={{ height: 26 }}>
      {top.map((t) => (
        <g key={t.day}>
          <line
            x1={x(Math.max(t.day, s0))}
            x2={x(Math.max(t.day, s0))}
            y1={0}
            y2={26}
            stroke="#999"
            strokeWidth={0.5}
          />
          <text x={x(Math.max(t.day, s0)) + 2} y={10} fontSize={8} fontWeight={700}>
            {t.label}
          </text>
        </g>
      ))}
      {bottom.map((t) => (
        <g key={t.day}>
          <line x1={x(t.day)} x2={x(t.day)} y1={13} y2={26} stroke="#ccc" strokeWidth={0.5} />
          {x(t.end) - x(t.day) > 14 && (
            <text x={(x(t.day) + x(t.end)) / 2} y={23} fontSize={7} textAnchor="middle">
              {unit === 'quarter' ? t.label : t.label.slice(0, 3)}
            </text>
          )}
        </g>
      ))}
    </svg>
  );

  const strip = (id: string): ReactNode => {
    const c = schedule.calc.get(id);
    if (!c) return null;
    const summary = outline.isSummary(id);
    const color =
      showCritical && c.critical && !summary ? '#dc2626' : phaseColorOf(project, derived, id);
    const b = bl?.tasks[id];
    return (
      <svg viewBox={`0 0 ${GW} ${RH}`} preserveAspectRatio="none" style={{ height: RH }}>
        {bottom.map((t) => (
          <line
            key={t.day}
            x1={x(t.day)}
            x2={x(t.day)}
            y1={0}
            y2={RH}
            stroke="#eee"
            strokeWidth={0.5}
          />
        ))}
        {status >= s0 && status <= end + 7 && (
          <line
            x1={x(status)}
            x2={x(status)}
            y1={0}
            y2={RH}
            stroke="#a855f7"
            strokeWidth={0.6}
            strokeDasharray="2 1.5"
          />
        )}
        {today >= s0 && today <= end + 7 && (
          <line x1={x(today)} x2={x(today)} y1={0} y2={RH} stroke="#2563eb" strokeWidth={0.6} />
        )}
        {b && (
          <rect
            x={x(isoToDay(b.start))}
            y={RH - 3}
            width={Math.max(0.8, x(isoToDay(b.finish) + 1) - x(isoToDay(b.start)))}
            height={2}
            fill="#9ca3af"
          />
        )}
        {summary ? (
          <rect
            x={x(c.es)}
            y={4}
            width={Math.max(0.8, x(c.ef) - x(c.es))}
            height={3}
            fill="#374151"
          />
        ) : c.isMilestone ? (
          <rect
            x={x(c.es) - 1.8}
            y={RH / 2 - 4}
            width={3.6}
            height={3.6}
            fill={color}
            transform={`rotate(45 ${x(c.es)} ${RH / 2 - 2.2})`}
          />
        ) : (
          <>
            <rect
              x={x(c.es)}
              y={2.5}
              width={Math.max(0.8, x(c.ef) - x(c.es))}
              height={7}
              fill={color}
              fillOpacity={0.45}
            />
            <rect
              x={x(c.es)}
              y={2.5}
              width={Math.max(0, ((x(c.ef) - x(c.es)) * c.percentComplete) / 100)}
              height={7}
              fill={color}
            />
          </>
        )}
      </svg>
    );
  };

  return (
    <div className="print-root" data-testid="print-view">
      <h1>{project.name}</h1>
      <div className="print-meta">
        {fmtLong(schedule.projectStart)} – {fmtLong(end - 1)} · Status date {fmtLong(status)} ·
        Printed {fmtLong(today)}
        {bl ? ` · Baseline: ${bl.name} (grey)` : ''}
        {printing.collapsedToPhases ? ' · Phases only' : ''}
      </div>
      <table className="print-table">
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '27%' }} />
          <col style={{ width: '5%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '4%' }} />
          <col style={{ width: '44%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ID</th>
            <th>Task</th>
            <th>Dur.</th>
            <th>Start</th>
            <th>Finish</th>
            <th>%</th>
            <th className="gantt">{header}</th>
          </tr>
        </thead>
        <tbody>
          {ids.map((id) => {
            const t = outline.byId.get(id)!;
            const c = schedule.calc.get(id);
            const summary = outline.isSummary(id);
            return (
              <tr key={id} className={summary ? 'summary' : undefined}>
                <td>{t.rowId}</td>
                <td style={{ paddingLeft: 3 + (outline.depth.get(id) ?? 0) * 8 }}>{t.name}</td>
                <td>{c ? `${summary ? c.duration : t.duration}d` : ''}</td>
                <td>{c ? fmtDay(c.es) : ''}</td>
                <td>{c ? fmtDay(displayFinishDay(c)) : ''}</td>
                <td>{c ? Math.round(c.percentComplete) : ''}</td>
                <td className="gantt">{strip(id)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
