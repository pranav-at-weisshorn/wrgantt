import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from 'react';
import {
  worstCaseEnd,
  activeBaseline,
  CONSTRAINT_LABEL,
  days,
  dayToIso,
  displayFinishDay,
  finishVariance,
  isoToDay,
  todayDay,
  type Project,
} from '../../engine';
import type { Derived } from '../../store/derive';
import { addLink, setDuration, setStartDate } from '../../store/ops';
import { ZOOMS } from '../../store/prefs';
import { useStore } from '../../store/store';
import { calFor } from '../cal';
import { fmtDay, fmtSigned } from '../format';
import { HEADER_H, linkTexts, ROW_H, type Row } from '../rows';
import { linkPath, type BarBox } from './arrows';
import { TIERS, ticks, type Scale } from './scale';
import './worst-case.css';

interface Props {
  project: Project;
  derived: Derived;
  rows: Row[];
  rowIndex: Map<string, number>;
  scale: Scale;
  first: number;
  last: number;
  bodyRef: RefObject<HTMLDivElement | null>;
  onBodyScroll: (e: UIEvent<HTMLDivElement>) => void;
  onZoomAnchor: (zoomIndex: number, anchorDay: number, clientX: number) => void;
}

type Drag =
  | { kind: 'move'; id: string; startX: number; delta: number; moved: boolean }
  | { kind: 'resize'; id: string; startX: number; delta: number; moved: boolean }
  | { kind: 'link'; id: string; x0: number; y0: number; x: number; y: number };

interface Hover {
  id: string;
  x: number;
  y: number;
}

const MS_HALF = 6;

function barGeom(baselineOn: boolean) {
  return baselineOn ? { y: 5, h: 14, blY: 21, blH: 4 } : { y: 6, h: 16, blY: 0, blH: 0 };
}

export function Timeline(props: Props) {
  const { project, derived, rows, rowIndex, scale, first, last, bodyRef, onBodyScroll } = props;
  const prefs = useStore((s) => s.prefs);
  const selectedIds = useStore((s) => s.selectedIds);
  const select = useStore((s) => s.select);
  const toggleSelect = useStore((s) => s.toggleSelect);
  const selectRange = useStore((s) => s.selectRange);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const setDialog = useStore((s) => s.setDialog);
  const openContextMenu = useStore((s) => s.openContextMenu);
  const scrollRequest = useStore((s) => s.scrollRequest);
  const toast = useStore((s) => s.toast);
  const headerRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [viewW, setViewW] = useState(1200);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hover, setHover] = useState<Hover | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;

  const baseline = activeBaseline(project);
  const showBl = prefs.showBaseline && !!baseline;
  const g = barGeom(showBl);
  const height = rows.length * ROW_H;
  const projCal = calFor(project);

  // Horizontal window for header ticks and shading.
  const visFrom = Math.floor(scale.dayAt(scrollLeft)) - 2;
  const visTo = Math.ceil(scale.dayAt(scrollLeft + viewW)) + 2;

  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewW(el.clientWidth));
    ro.observe(el);
    setViewW(el.clientWidth);
    return () => ro.disconnect();
  }, [bodyRef]);

  const onScroll = (e: UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (headerRef.current) headerRef.current.scrollLeft = el.scrollLeft;
    setScrollLeft(el.scrollLeft);
    onBodyScroll(e);
  };

  // Ctrl + wheel zooms around the day under the pointer.
  const zoomRef = useRef({ zoom: prefs.zoom, scale, onZoomAnchor: props.onZoomAnchor });
  zoomRef.current = { zoom: prefs.zoom, scale, onZoomAnchor: props.onZoomAnchor };
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const { zoom, scale: sc, onZoomAnchor } = zoomRef.current;
      const i = ZOOMS.indexOf(zoom);
      const ni = Math.max(0, Math.min(ZOOMS.length - 1, i + (e.deltaY > 0 ? 1 : -1)));
      if (ni === i) return;
      const rect = el.getBoundingClientRect();
      const day = sc.dayAt(el.scrollLeft + e.clientX - rect.left);
      onZoomAnchor(ni, day, e.clientX - rect.left);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [bodyRef]);

  // Horizontal part of scroll requests ("scroll to task", "scroll to today").
  useEffect(() => {
    const el = bodyRef.current;
    if (!scrollRequest || !el) return;
    let day: number | undefined = scrollRequest.day;
    if (scrollRequest.taskId) day = derived.schedule.calc.get(scrollRequest.taskId)?.es;
    if (day === undefined) return;
    if (day < scale.start || day > scale.end) {
      toast('That date is outside the timeline', 'info');
      return;
    }
    el.scrollLeft = Math.max(0, scale.x(day) - 80);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  // ------------------------------------------------------------------ drag handling
  const rowAtY = useCallback(
    (clientY: number) => {
      const el = bodyRef.current;
      if (!el) return -1;
      const rect = el.getBoundingClientRect();
      return Math.floor((clientY - rect.top + el.scrollTop) / ROW_H);
    },
    [bodyRef],
  );

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'link') {
        const el = bodyRef.current!;
        const rect = el.getBoundingClientRect();
        setDrag({
          ...d,
          x: e.clientX - rect.left + el.scrollLeft,
          y: e.clientY - rect.top + el.scrollTop,
        });
      } else {
        const delta = Math.round((e.clientX - d.startX) / scale.ppd);
        const moved = d.moved || Math.abs(e.clientX - d.startX) > 3;
        if (delta !== d.delta || moved !== d.moved) setDrag({ ...d, delta, moved });
      }
      setHover((h) => (h ? { ...h, x: e.clientX, y: e.clientY } : h));
    };
    const onUp = (e: PointerEvent) => {
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      const task = derived.outline.byId.get(d.id);
      const c = derived.schedule.calc.get(d.id);
      if (!task || !c) return;
      const cal = calFor(project, task.calendarId);
      if (d.kind === 'move' && d.moved && d.delta !== 0) {
        const start = cal.snap(c.es + d.delta);
        setStartDate(d.id, dayToIso(start));
      } else if (d.kind === 'resize' && d.moved && d.delta !== 0) {
        const end = c.ef + d.delta;
        setDuration(d.id, Math.max(1, cal.between(c.es, end)));
      } else if (d.kind === 'link') {
        const idx = rowAtY(e.clientY);
        const target = rows[idx];
        if (!target || target.id === d.id || !target.calc) return;
        const tx0 = scale.x(target.calc.es) - 8;
        const tx1 = scale.x(target.calc.ef) + 8;
        if (d.x < tx0 || d.x > tx1) return;
        addLink(d.id, target.id, 'FS');
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  /**
   * Ctrl/Cmd+click toggles a task in the selection and Shift+click selects a range of rows.
   * Returns true when the press was such a click (it never starts a drag).
   */
  const pickWithModifier = (e: React.PointerEvent, row: Row): boolean => {
    if (e.ctrlKey || e.metaKey) toggleSelect(row.id);
    else if (e.shiftKey) {
      selectRange(
        row.id,
        rows.map((r) => r.id),
      );
    } else return false;
    return true;
  };

  /** A press on a summary bar (it cannot be dragged): select it. */
  const pressSummary = (e: React.PointerEvent, row: Row) => {
    if (e.button !== 0) return;
    if (!pickWithModifier(e, row)) select(row.id);
  };

  const startDrag = (e: React.PointerEvent, row: Row, kind: 'move' | 'resize' | 'link') => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (pickWithModifier(e, row)) return;
    select(row.id);
    if (kind === 'link') {
      const el = bodyRef.current!;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left + el.scrollLeft;
      const y = e.clientY - rect.top + el.scrollTop;
      setDrag({ kind, id: row.id, x0: x, y0: y, x, y });
    } else {
      setDrag({ kind, id: row.id, startX: e.clientX, delta: 0, moved: false });
    }
  };

  // ------------------------------------------------------------------ geometry
  const boxOf = (row: Row, idx: number): BarBox | null => {
    const c = row.calc;
    if (!c) return null;
    const y = idx * ROW_H + g.y + g.h / 2;
    if (!row.isSummary && c.isMilestone) {
      const x = scale.x(c.es);
      return { x0: x - MS_HALF, x1: x + MS_HALF, y };
    }
    return { x0: scale.x(c.es), x1: scale.x(c.ef), y };
  };

  const visibleRows = rows.slice(first, last + 1);

  const worstEnds = useMemo(() => {
    const out = new Map<string, number>();
    if (!prefs.showWorstCase) return out;
    const { outline, schedule } = derived;
    for (const t of project.tasks) {
      const extra = t.worstCaseDays ?? 0;
      const c = schedule.calc.get(t.id);
      if (!extra || !c || outline.isSummary(t.id) || c.percentComplete >= 100) continue;
      out.set(t.id, worstCaseEnd(calFor(project, t.calendarId), c.es, c.ef, extra));
    }
    // Phases, summaries and milestones: how late they could finish if every task overruns.
    const worst = derived.worst;
    for (const id of outline.flat) {
      const c = schedule.calc.get(id);
      if (!c || c.percentComplete >= 100) continue;
      const summary = outline.isSummary(id);
      if (!summary && !c.isMilestone) continue;
      let end = out.get(id) ?? -Infinity;
      if (summary)
        for (const l of outline.leavesOf(id)) end = Math.max(end, out.get(l) ?? -Infinity);
      const w = worst?.calc.get(id);
      if (w) end = Math.max(end, c.isMilestone && !summary ? w.es : w.ef);
      if (end > (c.isMilestone && !summary ? c.es : c.ef)) out.set(id, end);
    }
    return out;
  }, [project, derived, prefs.showWorstCase]);
  const worstProjectFinish =
    prefs.showWorstCase &&
    derived.worst &&
    derived.worst.projectFinish > derived.schedule.projectFinish
      ? derived.worst.projectFinish
      : null;

  const links = useMemo(() => {
    const out: { id: string; d: string; crit: boolean }[] = [];
    if (!prefs.showLinks) return out;
    for (const dep of project.dependencies) {
      const ia = rowIndex.get(dep.predecessorId);
      const ib = rowIndex.get(dep.successorId);
      if (ia === undefined || ib === undefined) continue;
      if (Math.max(ia, ib) < first || Math.min(ia, ib) > last) continue;
      const a = boxOf(rows[ia], ia);
      const b = boxOf(rows[ib], ib);
      if (!a || !b) continue;
      const crit = prefs.showCritical && !!rows[ia].calc?.critical && !!rows[ib].calc?.critical;
      out.push({ id: dep.id, d: linkPath(dep.type, a, b, ROW_H), crit });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    project.dependencies,
    rowIndex,
    rows,
    first,
    last,
    scale,
    showBl,
    prefs.showCritical,
    prefs.showLinks,
  ]);

  // ------------------------------------------------------------------ render pieces
  const tiers = TIERS[scale.zoom];
  const topTicks = ticks(
    tiers.top,
    Math.max(scale.start, visFrom),
    Math.min(scale.end, visTo),
    'top',
  );
  const bottomTicks = ticks(
    tiers.bottom,
    Math.max(scale.start, visFrom),
    Math.min(scale.end, visTo),
    'bottom',
  );

  const shading: ReactNode[] = [];
  if (scale.zoom === 'day') {
    let runStart: number | null = null;
    for (let d = Math.max(scale.start, visFrom); d <= Math.min(scale.end, visTo); d++) {
      const off = !projCal.isWorking(d);
      if (off && runStart === null) runStart = d;
      if ((!off || d === visTo) && runStart !== null) {
        shading.push(
          <rect
            key={runStart}
            className="weekend"
            x={scale.x(runStart)}
            y={0}
            width={(d - runStart) * scale.ppd}
            height={height}
          />,
        );
        runStart = null;
      }
    }
  }

  const today = todayDay();
  const statusDay = isoToDay(project.statusDate);

  const ghost = (() => {
    if (!drag || drag.kind === 'link' || !drag.moved) return null;
    const idx = rowIndex.get(drag.id);
    const row = idx !== undefined ? rows[idx] : undefined;
    if (!row?.calc || idx === undefined) return null;
    const cal = calFor(project, row.task.calendarId);
    let es = row.calc.es;
    let ef: number;
    if (drag.kind === 'move') {
      es = cal.snap(row.calc.es + drag.delta);
      ef = row.calc.isMilestone ? es : cal.addDuration(es, row.task.duration);
    } else {
      const dur = Math.max(1, cal.between(row.calc.es, row.calc.ef + drag.delta));
      ef = cal.addDuration(es, dur);
    }
    return {
      idx,
      es,
      ef,
      ms: row.calc.isMilestone,
      dur: row.calc.isMilestone ? 0 : cal.between(es, ef),
    };
  })();

  return (
    <div className="pane pane-timeline">
      <div className="pane-header" ref={headerRef} style={{ height: HEADER_H }}>
        <svg className="tl-svg tl-header" width={scale.width} height={HEADER_H}>
          <g className="top">
            {topTicks.map((t) => (
              <g key={t.day}>
                <line x1={scale.x(t.day)} x2={scale.x(t.day)} y1={0} y2={HEADER_H} />
                <text x={Math.max(scale.x(t.day), scrollLeft) + 4} y={16}>
                  {t.label}
                </text>
              </g>
            ))}
          </g>
          <line x1={0} x2={scale.width} y1={22.5} y2={22.5} />
          {bottomTicks.map((t) => {
            const w = (t.end - t.day) * scale.ppd;
            return (
              <g key={t.day}>
                <line x1={scale.x(t.day)} x2={scale.x(t.day)} y1={23} y2={HEADER_H} />
                {w > 16 && (
                  <text x={scale.x(t.day) + w / 2} y={38} textAnchor="middle">
                    {t.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div
        className="pane-body timeline-body"
        ref={bodyRef}
        onScroll={onScroll}
        data-testid="timeline-body"
      >
        <svg
          className="tl-svg tl-body"
          width={scale.width}
          height={Math.max(height, 1)}
          onPointerDown={() => select(null)}
          onContextMenu={(e) => {
            // Right-click a bar (or anywhere on its row) for the task's options.
            const row = rows[rowAtY(e.clientY)];
            if (!row) return;
            e.preventDefault();
            setHover(null);
            // Right-clicking a selected row keeps the selection.
            if (!selectedSet.has(row.id)) select(row.id);
            openContextMenu({ taskId: row.id, x: e.clientX, y: e.clientY });
          }}
        >
          <defs>
            <pattern
              id="hatch"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--bg)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--vf-mocca)" strokeWidth="2.4" />
            </pattern>
            <pattern
              id="hatch-crit"
              patternUnits="userSpaceOnUse"
              width="6"
              height="6"
              patternTransform="rotate(45)"
            >
              <rect width="6" height="6" fill="var(--bg)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--crit)" strokeWidth="2.4" />
            </pattern>
            <marker
              id="arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--link)" />
            </marker>
            <marker
              id="arrow-crit"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--crit)" />
            </marker>
            <marker
              id="arrow-hover"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--link-hover)" />
            </marker>
          </defs>
          {shading}
          {bottomTicks.map((t) => (
            <line
              key={t.day}
              className="vline"
              x1={scale.x(t.day)}
              x2={scale.x(t.day)}
              y1={0}
              y2={height}
            />
          ))}
          {visibleRows.map(
            (row, k) =>
              selectedSet.has(row.id) && (
                <rect
                  key={row.id}
                  className="row-sel"
                  x={0}
                  y={(first + k) * ROW_H}
                  width={scale.width}
                  height={ROW_H}
                />
              ),
          )}
          <g>
            {links.map((l) => (
              <LinkEl
                key={l.id}
                id={l.id}
                d={l.d}
                crit={l.crit}
                onOpen={(id) => setDialog({ kind: 'link', depId: id })}
              />
            ))}
          </g>
          {visibleRows.map((row, k) => (
            <BarRow
              key={row.id}
              row={row}
              idx={first + k}
              scale={scale}
              g={g}
              baseline={showBl ? baseline?.tasks[row.id] : undefined}
              selected={selectedSet.has(row.id)}
              crit={prefs.showCritical && !!row.calc?.critical}
              critStyle={prefs.criticalStyle}
              showLabel={prefs.showLabels}
              worstEnd={worstEnds.get(row.id)}
              onPointerDown={startDrag}
              onPressSummary={pressSummary}
              onDoubleClick={(id) => setDialog({ kind: 'task', taskId: id })}
              onHover={setHover}
            />
          ))}
          {today >= scale.start && today <= scale.end && (
            <line className="today-line" x1={scale.x(today)} x2={scale.x(today)} y1={0} y2={height}>
              <title>Today</title>
            </line>
          )}
          {worstProjectFinish !== null && worstProjectFinish <= scale.end && (
            <line
              className="worst-line"
              x1={scale.x(worstProjectFinish)}
              x2={scale.x(worstProjectFinish)}
              y1={0}
              y2={height}
            >
              <title>Worst-case project finish</title>
            </line>
          )}
          {statusDay >= scale.start && statusDay <= scale.end && (
            <line
              className="status-line"
              x1={scale.x(statusDay)}
              x2={scale.x(statusDay)}
              y1={0}
              y2={height}
            >
              <title>Status date</title>
            </line>
          )}
          {ghost &&
            (ghost.ms ? (
              <rect
                className="drag-ghost"
                x={scale.x(ghost.es) - MS_HALF}
                y={ghost.idx * ROW_H + g.y}
                width={MS_HALF * 2}
                height={g.h}
              />
            ) : (
              <rect
                className="drag-ghost"
                x={scale.x(ghost.es)}
                y={ghost.idx * ROW_H + g.y}
                width={Math.max(2, scale.x(ghost.ef) - scale.x(ghost.es))}
                height={g.h}
                rx={3}
              />
            ))}
          {drag?.kind === 'link' && (
            <line className="drag-link" x1={drag.x0} y1={drag.y0} x2={drag.x} y2={drag.y} />
          )}
        </svg>
      </div>
      {hover && !(drag && drag.kind === 'link') && (
        <BarTooltip
          project={project}
          derived={derived}
          id={hover.id}
          x={hover.x}
          y={hover.y}
          ghost={ghost && drag && drag.id === hover.id ? ghost : null}
        />
      )}
    </div>
  );
}

const LinkEl = memo(function LinkEl(p: {
  id: string;
  d: string;
  crit: boolean;
  onOpen: (id: string) => void;
}) {
  const [hov, setHov] = useState(false);
  const marker = hov ? 'url(#arrow-hover)' : p.crit ? 'url(#arrow-crit)' : 'url(#arrow)';
  return (
    <g
      className={`link-g${p.crit ? ' crit' : ''}${hov ? ' hover' : ''}`}
      onPointerEnter={() => setHov(true)}
      onPointerLeave={() => setHov(false)}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        p.onOpen(p.id);
      }}
      data-testid="link"
    >
      <path className="link-path" d={p.d} markerEnd={marker} />
      <path className="link-hit" d={p.d} />
    </g>
  );
});

interface BarRowProps {
  row: Row;
  idx: number;
  scale: Scale;
  g: ReturnType<typeof barGeom>;
  baseline: { start: string; finish: string; duration: number } | undefined;
  selected: boolean;
  crit: boolean;
  critStyle: 'fill' | 'outline';
  showLabel: boolean;
  /** Exclusive end of the worst-case extension (hatched), if any. */
  worstEnd?: number;
  onPointerDown: (e: React.PointerEvent, row: Row, kind: 'move' | 'resize' | 'link') => void;
  onPressSummary: (e: React.PointerEvent, row: Row) => void;
  onDoubleClick: (id: string) => void;
  onHover: (h: Hover | null) => void;
}

const BarRow = memo(function BarRow(p: BarRowProps) {
  const { row, idx, scale, g } = p;
  const c = row.calc;
  if (!c) return null;
  const top = idx * ROW_H;
  const x0 = scale.x(c.es);
  const x1 = scale.x(c.ef);
  const hoverProps = {
    onPointerEnter: (e: React.PointerEvent) =>
      p.onHover({ id: row.id, x: e.clientX, y: e.clientY }),
    onPointerMove: (e: React.PointerEvent) => p.onHover({ id: row.id, x: e.clientX, y: e.clientY }),
    onPointerLeave: () => p.onHover(null),
    onDoubleClick: () => p.onDoubleClick(row.id),
  };

  let hatchEl: ReactNode = null;
  const isMs = c.isMilestone && !row.isSummary;
  if (p.worstEnd !== undefined && p.worstEnd > (isMs ? c.es : c.ef)) {
    const from = isMs ? x0 + MS_HALF + 1 : x1;
    const to = scale.x(p.worstEnd);
    const hy = row.isSummary ? top + g.y + 2 : top + g.y + 2;
    const hh = row.isSummary ? 6 : g.h - 4;
    hatchEl = (
      <rect
        className="worst-case"
        x={from}
        y={hy}
        width={Math.max(2, to - from)}
        height={hh}
        fill={`url(#${p.crit ? 'hatch-crit' : 'hatch'})`}
        stroke={p.crit ? 'var(--crit)' : 'var(--vf-mocca)'}
        strokeWidth={1}
        strokeDasharray="3 2"
        pointerEvents="none"
        data-testid="worst-case-hatch"
      />
    );
  }

  let blEl: ReactNode = null;
  if (p.baseline) {
    const bs = isoToDay(p.baseline.start);
    const bf = isoToDay(p.baseline.finish);
    if (p.baseline.duration === 0 && !row.isSummary) {
      const bx = scale.x(bs);
      blEl = <rect x={bx - 3} y={top + g.blY} width={6} height={g.blH} fill="var(--baseline)" />;
    } else {
      blEl = (
        <rect
          x={scale.x(bs)}
          y={top + g.blY}
          width={Math.max(2, scale.x(bf + 1) - scale.x(bs))}
          height={g.blH}
          rx={1}
          fill="var(--baseline)"
        />
      );
    }
  }

  const label = p.showLabel ? (
    <text
      className="label"
      x={
        Math.max(
          c.isMilestone && !row.isSummary ? x0 + MS_HALF : x1,
          p.worstEnd !== undefined ? scale.x(p.worstEnd) : -Infinity,
        ) + 12
      }
      y={top + g.y + g.h / 2 + 4}
    >
      {row.task.name}
    </text>
  ) : null;

  if (row.isSummary) {
    const y = top + g.y + 2;
    const h = 6;
    const d = `M${x0},${y}H${x1}V${y + h + 5}L${x1 - 5},${y + h}H${x0 + 5}L${x0},${y + h + 5}Z`;
    return (
      <g
        className={`bar-group${p.selected ? ' selected' : ''}`}
        data-id={row.id}
        {...hoverProps}
        onPointerDown={(e) => {
          e.stopPropagation();
          p.onPressSummary(e, row);
        }}
      >
        {blEl}
        {hatchEl}
        <path className="bar summary bar-outline" d={d} fill="var(--summary)" />
        {label}
      </g>
    );
  }

  const critFill = p.crit && p.critStyle === 'fill';
  const fillColor = critFill ? 'var(--crit)' : row.color;
  // Red at low opacity reads as pink, so critical bars stay strong; progress shows darker.
  const remainingOpacity = critFill ? 0.82 : 0.45;
  const progressColor = critFill ? '#6e1611' : fillColor;
  const stroke = p.crit && p.critStyle === 'outline' ? 'var(--crit)' : 'none';

  if (c.isMilestone) {
    const cy = top + g.y + g.h / 2;
    const s = MS_HALF + 1;
    return (
      <g className={`bar-group${p.selected ? ' selected' : ''}`} data-id={row.id} {...hoverProps}>
        {blEl}
        {hatchEl}
        <path
          className="bar bar-outline"
          d={`M${x0},${cy - s}L${x0 + s},${cy}L${x0},${cy + s}L${x0 - s},${cy}Z`}
          fill={fillColor}
          stroke={stroke === 'none' ? 'var(--bg)' : stroke}
          strokeWidth={stroke === 'none' ? 1 : 2}
          onPointerDown={(e) => p.onPointerDown(e, row, 'move')}
          data-testid="milestone"
        />
        <circle
          className="bar-connector"
          cx={x0 + s + 6}
          cy={cy}
          r={4}
          onPointerDown={(e) => p.onPointerDown(e, row, 'link')}
        />
        {label}
      </g>
    );
  }

  const w = Math.max(2, x1 - x0);
  const pw = (w * c.percentComplete) / 100;
  const y = top + g.y;
  return (
    <g className={`bar-group${p.selected ? ' selected' : ''}`} data-id={row.id} {...hoverProps}>
      {blEl}
      {hatchEl}
      <rect
        className="bar bar-outline"
        x={x0}
        y={y}
        width={w}
        height={g.h}
        rx={3}
        fill={fillColor}
        fillOpacity={remainingOpacity}
        stroke={stroke}
        strokeWidth={2}
        onPointerDown={(e) => p.onPointerDown(e, row, 'move')}
        data-testid="bar"
      />
      {pw > 0 && (
        <rect
          x={x0}
          y={y}
          width={pw}
          height={g.h}
          rx={3}
          fill={progressColor}
          pointerEvents="none"
        />
      )}
      <rect
        className="bar-handle"
        x={x0 + w - 4}
        y={y}
        width={8}
        height={g.h}
        onPointerDown={(e) => p.onPointerDown(e, row, 'resize')}
      />
      <circle
        className="bar-connector"
        cx={x0 + w + 7}
        cy={y + g.h / 2}
        r={4}
        onPointerDown={(e) => p.onPointerDown(e, row, 'link')}
      />
      {label}
    </g>
  );
});

function BarTooltip(p: {
  project: Project;
  derived: Derived;
  id: string;
  x: number;
  y: number;
  ghost: { es: number; ef: number; ms: boolean; dur: number } | null;
}) {
  const t = p.derived.outline.byId.get(p.id);
  const c = p.derived.schedule.calc.get(p.id);
  if (!t || !c) return null;
  const bl = activeBaseline(p.project);
  const v = finishVariance(p.project, c, bl?.tasks[p.id]);
  const es = p.ghost ? p.ghost.es : c.es;
  const fin = p.ghost ? displayFinishDay({ es: p.ghost.es, ef: p.ghost.ef }) : displayFinishDay(c);
  const dur = p.ghost ? p.ghost.dur : c.duration;
  const style = {
    left: Math.min(p.x + 14, window.innerWidth - 350),
    top: Math.min(p.y + 16, window.innerHeight - 220),
  };
  return (
    <div className="tooltip" style={style} role="tooltip">
      <h4>
        {t.rowId}. {t.name}
      </h4>
      <dl>
        <dt>{p.ghost ? 'New start' : 'Start'}</dt>
        <dd>{fmtDay(es)}</dd>
        <dt>{p.ghost ? 'New finish' : 'Finish'}</dt>
        <dd>{fmtDay(fin)}</dd>
        <dt>Duration</dt>
        <dd>{c.isMilestone && !p.ghost ? 'Milestone' : days(dur)}</dd>
        {(t.worstCaseDays ?? 0) > 0 && !p.ghost && (
          <>
            <dt>Worst case</dt>
            <dd>
              +{days(t.worstCaseDays!, 'working day')}, finishing{' '}
              {fmtDay(
                displayFinishDay({
                  es: c.es,
                  ef: worstCaseEnd(calFor(p.project, t.calendarId), c.es, c.ef, t.worstCaseDays!),
                }),
              )}
            </dd>
          </>
        )}
        {p.derived.worst && !p.ghost && p.derived.worst.calc.get(p.id) && (
          <>
            <dt>If all overrun</dt>
            <dd>finishes {fmtDay(displayFinishDay(p.derived.worst.calc.get(p.id)!))}</dd>
          </>
        )}
        <dt>Total float</dt>
        <dd style={{ color: c.totalFloat < 0 ? 'var(--danger)' : undefined }}>
          {days(c.totalFloat)}
          {c.critical ? ' (critical)' : ''}
        </dd>
        <dt>Free float</dt>
        <dd>{days(c.freeFloat)}</dd>
        <dt>Predecessors</dt>
        <dd>{linkTexts(p.project).preds.get(p.id) || '—'}</dd>
        <dt>Responsible</dt>
        <dd>{t.responsible || '—'}</dd>
        {c.percentComplete > 0 && (
          <>
            <dt>Complete</dt>
            <dd>{Math.round(c.percentComplete)}%</dd>
          </>
        )}
        {bl && (
          <>
            <dt>Baseline var.</dt>
            <dd>{v === null ? '—' : fmtSigned(v)}</dd>
          </>
        )}
        {c.constraintViolated && (
          <>
            <dt>Warning</dt>
            <dd style={{ color: 'var(--danger)' }}>
              {CONSTRAINT_LABEL[t.constraint.type]} {t.constraint.date} conflicts with the links
            </dd>
          </>
        )}
      </dl>
    </div>
  );
}
