import { useStore } from '../../store/store';
import { Icon } from '../icons';
import { HealthPanel } from './HealthPanel';
import { HistoryPanel } from './HistoryPanel';
import { VariancePanel } from './VariancePanel';
import { VersionsPanel } from './VersionsPanel';

const TITLES = {
  health: 'Schedule health check',
  variance: 'Variance vs. baseline',
  history: 'Change history',
  versions: 'Versions',
} as const;

export function SidePanel() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  if (!panel) return null;
  return (
    <aside className="side-panel" data-testid={`${panel}-panel`}>
      <header>
        <h3>{TITLES[panel]}</h3>
        <span className="spacer" />
        <button className="btn icon ghost" onClick={() => setPanel(null)} aria-label="Close panel">
          <Icon name="x" />
        </button>
      </header>
      <div className="body">
        {panel === 'health' && <HealthPanel />}
        {panel === 'variance' && <VariancePanel />}
        {panel === 'history' && <HistoryPanel />}
        {panel === 'versions' && <VersionsPanel />}
      </div>
    </aside>
  );
}
