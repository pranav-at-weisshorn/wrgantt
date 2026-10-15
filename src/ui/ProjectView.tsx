import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type UIEvent,
} from 'react';
import { activeBaseline, isoToDay, todayDay } from '../engine';
import { ZOOMS } from '../store/prefs';
import { useDerived, useStore } from '../store/store';
import { COLUMNS } from './columns';
import { ContextMenu } from './ContextMenu';
import { DialogHost } from './dialogs/DialogHost';
import { Grid } from './grid/Grid';
import { SidePanel } from './panels/SidePanel';
import { PrintView } from './print/PrintView';
import { computeRows, ROW_H } from './rows';
import { makeScale } from './timeline/scale';
import { Timeline } from './timeline/Timeline';
import { Toolbar } from './Toolbar';
import { TopBar } from './TopBar';

const OVERSCAN = 8;

export function ProjectView({ onBack }: { onBack: () => void }) {
  const project = useStore((s) => s.project)!;
  const derived = useDerived()!;
  const collapsed = useStore((s) => s.collapsed);
  const filters = useStore((s) => s.filters);
  const prefs = useStore((s) => s.prefs);
  const setPrefs = useStore((s) => s.setPrefs);
  const panel = useStore((s) => s.panel);
  const scrollRequest = useStore((s) => s.scrollRequest);

  const gridBodyRef = useRef<HTMLDivElement>(null);
  const tlBodyRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewH, setViewH] = useState(800);

  const rows = useMemo(
    () => computeRows(project, derived, collapsed, filters),
    [project, derived, collapsed, filters],
  );
  const rowIndex = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows]);
  const columns = useMemo(
    () => COLUMNS.filter((c) => prefs.columns[c.key] || !c.hideable),
    [prefs.columns],
  );

  // Timeline range: schedule, status date, baseline and (if close by) today.
  const scale = useMemo(() => {
    const { schedule } = derived;
    let min = schedule.projectStart;
    let max = schedule.projectFinish;
    const status = isoToDay(project.statusDate);
    min = Math.min(min, status);
    max = Math.max(max, status);
    const bl = activeBaseline(project);
    if (bl) {
      for (const e of Object.values(bl.tasks)) {
        min = Math.min(min, isoToDay(e.start));
        max = Math.max(max, isoToDay(e.finish) + 1);
      }
    }
    const today = todayDay();
    if (today > min - 400 && today < max + 400) {
      min = Math.min(min, today);
      max = Math.max(max, today);
    }
    return makeScale(prefs.zoom, min, max);
  }, [derived, project, prefs.zoom]);

  // ------------------------------------------------------------------ vertical scroll sync
  const onGridScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (tlBodyRef.current && tlBodyRef.current.scrollTop !== top) tlBodyRef.current.scrollTop = top;
    setScrollTop(top);
  };
  const onTimelineScroll = (e: UIEvent<HTMLDivElement>) => {
    const top = e.currentTarget.scrollTop;
    if (gridBodyRef.current && gridBodyRef.current.scrollTop !== top)
      gridBodyRef.current.scrollTop = top;
    setScrollTop(top);
  };

  // The grid has no vertical scrollbar of its own: forward wheel events to the timeline.
  useEffect(() => {
    const g = gridBodyRef.current;
    if (!g) return;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;
      e.preventDefault();
      if (tlBodyRef.current) tlBodyRef.current.scrollTop += e.deltaY;
    };
    g.addEventListener('wheel', onWheel, { passive: false });
    return () => g.removeEventListener('wheel', onWheel);
  }, []);

  useLayoutEffect(() => {
    const el = tlBodyRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setViewH(el.clientHeight));
    ro.observe(el);
    setViewH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // Vertical part of "scroll to task".
  useEffect(() => {
    if (!scrollRequest?.taskId) return;
    const idx = rowIndex.get(scrollRequest.taskId);
    const el = tlBodyRef.current;
    if (idx === undefined || !el) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop || top + ROW_H > el.scrollTop + el.clientHeight) {
      el.scrollTop = Math.max(0, top - el.clientHeight / 3);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollRequest]);

  const first = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN);
  const last = Math.min(rows.length - 1, Math.ceil((scrollTop + viewH) / ROW_H) + OVERSCAN);

  // ------------------------------------------------------------------ zoom anchoring
  const pendingAnchor = useRef<{ day: number; offset: number } | null>(null);
  const onZoomAnchor = useCallback(
    (zoomIndex: number, day: number, offset: number) => {
      pendingAnchor.current = { day, offset };
      setPrefs({ zoom: ZOOMS[zoomIndex] });
    },
    [setPrefs],
  );
  useLayoutEffect(() => {
    const a = pendingAnchor.current;
    if (a && tlBodyRef.current) {
      tlBodyRef.current.scrollLeft = Math.max(0, scale.x(a.day) - a.offset);
      pendingAnchor.current = null;
    }
  }, [scale]);

  // ------------------------------------------------------------------ splitter
  const [dragging, setDragging] = useState(false);
  const onSplitDown = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const startX = e.clientX;
    const startW = prefs.gridWidth;
    const move = (ev: PointerEvent) => {
      const w = Math.max(200, Math.min(window.innerWidth - 200, startW + ev.clientX - startX));
      useStore.getState().setPrefs({ gridWidth: w });
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  // ------------------------------------------------------------------ global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const inField =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT');
      if (inField || useStore.getState().dialog) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        useStore.getState().undo();
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault();
        useStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <div className="app">
        <TopBar onBack={onBack} />
        <Toolbar />
        <div className="main">
          <div className="split">
            <Grid
              project={project}
              derived={derived}
              rows={rows}
              rowIndex={rowIndex}
              columns={columns}
              width={prefs.gridWidth}
              first={first}
              last={last}
              bodyRef={gridBodyRef}
              onBodyScroll={onGridScroll}
            />
            <div
              className={`splitter${dragging ? ' dragging' : ''}`}
              onPointerDown={onSplitDown}
              role="separator"
              aria-orientation="vertical"
            />
            <Timeline
              project={project}
              derived={derived}
              rows={rows}
              rowIndex={rowIndex}
              scale={scale}
              first={first}
              last={last}
              bodyRef={tlBodyRef}
              onBodyScroll={onTimelineScroll}
              onZoomAnchor={onZoomAnchor}
            />
          </div>
          {panel && <SidePanel />}
        </div>
        <DialogHost />
        <ContextMenu />
      </div>
      <PrintView />
    </>
  );
}
