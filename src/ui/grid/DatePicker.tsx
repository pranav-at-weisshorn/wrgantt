import { format } from 'date-fns';
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { dayToLocalDate, isoToDay, todayDay, weekday, dayToIso } from '../../engine';
import { Icon } from '../icons';
import './date-picker.css';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MS = 86_400_000;
const ymd = (day: number) => {
  const d = new Date(day * MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
};
const firstOfMonth = (y: number, m: number) => Math.round(Date.UTC(y, m, 1) / MS);

/**
 * A month calendar shown under a cell editor. Clicking a day picks it; the text box keeps the
 * focus (the calendar never takes it), so typing a date still works.
 */
export function DatePicker(props: {
  anchorRef: RefObject<HTMLElement | null>;
  /** Selected date (ISO), or null when the typed text is not a date. */
  value: string | null;
  onPick: (iso: string) => void;
  /** Days that are not working days are shown faded. */
  isWorking?: (day: number) => boolean;
}) {
  const selected = props.value ? isoToDay(props.value) : null;
  const [view, setView] = useState(() => ymd(selected ?? todayDay()));
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Follow the typed date to its month.
  useEffect(() => {
    if (selected !== null) setView(ymd(selected));
  }, [selected]);

  // Place under the cell (or above it when there is no room), and follow scrolling.
  useLayoutEffect(() => {
    const place = () => {
      const a = props.anchorRef.current?.getBoundingClientRect();
      const el = ref.current;
      if (!a || !el) return;
      const h = el.offsetHeight;
      const w = el.offsetWidth;
      const below = a.bottom + 4 + h <= window.innerHeight;
      setPos({
        left: Math.max(4, Math.min(a.left, window.innerWidth - w - 4)),
        top: below ? a.bottom + 4 : Math.max(4, a.top - h - 4),
      });
    };
    place();
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
    };
  }, [props.anchorRef, view]);

  const first = firstOfMonth(view.y, view.m);
  const lead = (weekday(first) + 6) % 7; // Monday first
  const start = first - lead;
  const days = Array.from({ length: 42 }, (_, i) => start + i);
  const today = todayDay();
  const shift = (n: number) => {
    const d = new Date(Date.UTC(view.y, view.m + n, 1));
    setView({ y: d.getUTCFullYear(), m: d.getUTCMonth() });
  };

  return createPortal(
    <div
      ref={ref}
      className="date-picker"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
      // Keep the focus in the text box so typing and Enter keep working.
      onMouseDown={(e) => e.preventDefault()}
      onPointerDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label="Choose a date"
      data-testid="date-picker"
    >
      <div className="dp-head">
        <button
          className="btn icon ghost small"
          onClick={() => shift(-1)}
          aria-label="Previous month"
        >
          <Icon name="back" size={14} />
        </button>
        <span className="dp-title">{format(dayToLocalDate(first), 'MMMM yyyy')}</span>
        <button className="btn icon ghost small" onClick={() => shift(1)} aria-label="Next month">
          <Icon name="chevRight" size={14} />
        </button>
      </div>
      <div className="dp-grid">
        {WEEKDAYS.map((w) => (
          <span key={w} className="dp-wd">
            {w}
          </span>
        ))}
        {days.map((d) => {
          const cls = ['dp-day'];
          if (ymd(d).m !== view.m) cls.push('out');
          if (d === today) cls.push('today');
          if (d === selected) cls.push('sel');
          if (props.isWorking && !props.isWorking(d)) cls.push('off');
          return (
            <button
              key={d}
              className={cls.join(' ')}
              onClick={() => props.onPick(dayToIso(d))}
              aria-label={format(dayToLocalDate(d), 'EEEE d MMMM yyyy')}
              aria-pressed={d === selected}
            >
              {dayToLocalDate(d).getDate()}
            </button>
          );
        })}
      </div>
      <div className="dp-foot">
        <button className="btn small ghost" onClick={() => props.onPick(dayToIso(today))}>
          Today
        </button>
        <span className="hint">Or type a date and press Enter</span>
      </div>
    </div>,
    document.body,
  );
}
