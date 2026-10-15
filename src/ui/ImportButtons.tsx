import type { Project } from '../engine';
import { Icon } from './icons';
import { importProjectFile } from './importExport';

export function ImportButtons({ onImported }: { onImported: (p: Project) => void }) {
  return (
    <button
      className="btn"
      title="Import a .gantt.json file, or a CSV with Name, Duration, Predecessors, Parent WBS, Responsible"
      onClick={async () => {
        const p = await importProjectFile();
        if (p) onImported(p);
      }}
    >
      <Icon name="upload" size={14} /> Import .gantt.json / CSV…
    </button>
  );
}
