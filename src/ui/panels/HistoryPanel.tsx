import { useMemo, useState } from 'react';
import { useStore } from '../../store/store';
import { timeline, type HistoryEntry } from '../../store/history';
import { Modal } from '../dialogs/Modal';
import './history.css';

/** How many entries are drawn at first; older ones load on request. */
const PAGE = 200;

interface Item {
  /** Index in the timeline (applied entries, then undone ones); -1 = the start. */
  index: number;
  entry: HistoryEntry | null;
}

const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayTitle(d: Date, now: Date): string {
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (dayKey(d) === dayKey(now)) return 'Today';
  if (dayKey(d) === dayKey(yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}

const timeText = (d: Date) =>
  d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

/** Every change to the project, newest first, grouped by day. Click one to go back (or forward) to it. */
export function HistoryPanel() {
  const past = useStore((s) => s.past);
  const future = useStore((s) => s.future);
  const readOnly = useStore((s) => s.readOnly);
  const jumpTo = useStore((s) => s.jumpTo);
  const clearHistory = useStore((s) => s.clearHistory);
  const [shown, setShown] = useState(PAGE);
  const [confirming, setConfirming] = useState(false);

  const cursor = past.length - 1;
  const entries = useMemo(() => timeline({ past, future }), [past, future]);
  const total = entries.length;

  // Newest first; the opened state closes the list. Older entries are paged in.
  const visible = Math.min(total, shown);
  const items: Item[] = [];
  for (let i = total - 1; i >= total - visible; i--) items.push({ index: i, entry: entries[i] });
  if (visible === total) items.push({ index: -1, entry: null });

  const now = new Date();
  let lastDay = '';

  return (
    <div className="history-panel" data-testid="history-list">
      <div className="history-head">
        <span className="hint">
          {total === 0
            ? 'No changes yet.'
            : `${total} change${total === 1 ? '' : 's'}${future.length ? `, ${future.length} undone` : ''}`}
        </span>
        <span className="spacer" />
        <button
          className="btn small"
          disabled={readOnly || total === 0}
          onClick={() => setConfirming(true)}
          data-testid="history-clear"
        >
          Clear history
        </button>
      </div>
      {readOnly && (
        <p className="hint">This project is open in another tab, so history is read-only here.</p>
      )}
      <ol className="history-list">
        {items.map(({ index, entry }) => {
          const at = entry ? new Date(entry.at) : null;
          let heading: string | null = null;
          if (at) {
            const key = dayKey(at);
            if (key !== lastDay) {
              lastDay = key;
              heading = dayTitle(at, now);
            }
          }
          const isCurrent = index === cursor;
          const undone = index > cursor;
          return (
            <li key={index}>
              {heading && <h4 className="history-day">{heading}</h4>}
              <button
                className={`history-entry${isCurrent ? ' current' : ''}${undone ? ' undone' : ''}`}
                disabled={readOnly}
                aria-current={isCurrent ? 'step' : undefined}
                onClick={() => jumpTo(index)}
                title={
                  entry
                    ? undone
                      ? 'Redo up to and including this change'
                      : isCurrent
                        ? 'The project is in this state'
                        : 'Go back to the state right after this change'
                    : 'Go back to how the project was when it was opened'
                }
                data-testid="history-entry"
              >
                <span className="history-marker" aria-hidden="true" />
                <span className="history-label">{entry ? entry.label : 'Start of history'}</span>
                {at && <span className="history-time">{timeText(at)}</span>}
                {isCurrent && <span className="history-now">Current</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {visible < total && (
        <button className="btn small" onClick={() => setShown(shown + PAGE)}>
          Show older changes ({total - visible})
        </button>
      )}
      {confirming && (
        <Modal
          title="Clear history?"
          onClose={() => setConfirming(false)}
          testId="history-clear-dialog"
          footer={
            <>
              <button className="btn" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  setConfirming(false);
                  clearHistory();
                }}
                data-testid="history-clear-confirm"
              >
                Clear history
              </button>
            </>
          }
        >
          <div className="modal-body">
            This removes all {total} undo and redo steps. The project itself stays as it is now, but
            you can no longer go back to earlier states.
          </div>
        </Modal>
      )}
    </div>
  );
}
