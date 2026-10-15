import { useEffect, useRef, useState, type ReactNode } from 'react';

/** A button with a dropdown that closes on outside click / Escape. */
export function Menu(props: {
  label: ReactNode;
  title?: string;
  align?: 'left' | 'right';
  className?: string;
  testId?: string;
  children: (close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div className="menu-wrap" ref={ref}>
      <button
        className={`btn ${props.className ?? ''}${open ? ' active' : ''}`}
        title={props.title}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid={props.testId}
      >
        {props.label}
      </button>
      {open && (
        <div className={`menu${props.align === 'right' ? ' right' : ''}`} role="menu">
          {props.children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
