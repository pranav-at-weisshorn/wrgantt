import { useStore } from '../../store/store';
import { Icon } from '../icons';
import { HealthPanel } from './HealthPanel';
import { VariancePanel } from './VariancePanel';

export function SidePanel() {
  const panel = useStore((s) => s.panel);
  const setPanel = useStore((s) => s.setPanel);
  if (!panel) return null;
  return (
    <aside className="side-panel" data-testid={`${panel}-panel`}>
      <header>
        <h3>{panel === 'health' ? 'Schedule health check' : 'Variance vs. baseline'}</h3>
        <span className="spacer" />
        <button className="btn icon ghost" onClick={() => setPanel(null)} aria-label="Close panel">
          <Icon name="x" />
        </button>
      </header>
      <div className="body">{panel === 'health' ? <HealthPanel /> : <VariancePanel />}</div>
    </aside>
  );
}
