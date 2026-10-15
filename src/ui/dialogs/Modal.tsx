import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from '../icons';

export function Modal(props: {
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  testId?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(props.onClose);
  onCloseRef.current = props.onClose;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    // Focus the first field once, for keyboard users.
    const first = ref.current?.querySelector<HTMLElement>(
      '.modal-body input, .modal-body select, .modal-body textarea, footer button.primary',
    );
    first?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div
      className="modal-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        className={`modal${props.wide ? ' wide' : ''}`}
        role="dialog"
        aria-modal="true"
        ref={ref}
        data-testid={props.testId}
      >
        <header>
          <h2>{props.title}</h2>
          <button className="btn icon ghost" onClick={props.onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </header>
        {props.children}
        {props.footer && <footer>{props.footer}</footer>}
      </div>
    </div>
  );
}
