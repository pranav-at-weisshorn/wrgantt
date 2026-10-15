import * as XLSX from 'xlsx';
import {
  buildOutline,
  detectCycle,
  newId,
  parseLinkList,
  renumber,
  type Dependency,
  type Project,
  type Task,
} from '../engine';
import { blankTask, emptyProject } from '../template/load';
import { parseDuration } from '../ui/format';

export interface CsvImportResult {
  project: Project;
  warnings: string[];
}

/**
 * Import a CSV with the columns Name, Duration, Predecessors, Parent WBS, Responsible
 * (header names are matched case-insensitively; column order does not matter).
 *
 * - Predecessors use the predecessor syntax and refer to CSV data row numbers (1 = first row
 *   after the header), e.g. `2, 3 Start-to-Start +5 working days` (compact `3SS+5d` also works).
 * - Parent WBS refers to the WBS code the parent row gets in the imported outline (e.g. `1` or
 *   `2.3`); leave it empty for a top-level task. Parents must appear before their children.
 */
export function projectFromCsv(text: string, name: string): CsvImportResult {
  const wb = XLSX.read(text, { type: 'string', raw: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '' });
  if (!rows.length) throw new Error('The CSV file is empty');
  const head = rows[0].map((h) =>
    String(h)
      .trim()
      .toLowerCase()
      .replace(/[^a-z]/g, ''),
  );
  const col = (n: string) => head.indexOf(n);
  const ci = {
    name: col('name'),
    duration: col('duration'),
    preds: col('predecessors'),
    parent: col('parentwbs'),
    resp: col('responsible'),
  };
  if (ci.name < 0) throw new Error('The CSV needs a "Name" column');

  const project = emptyProject(name);
  const warnings: string[] = [];
  const byWbs = new Map<string, Task>();
  const childCount = new Map<string, number>(); // parent wbs ('' = top) -> children so far
  const byRow = new Map<number, Task>();
  const predText = new Map<Task, string>();

  rows.slice(1).forEach((r, i) => {
    const rowNo = i + 1;
    const cell = (k: number) => (k >= 0 ? String(r[k] ?? '').trim() : '');
    const taskName = cell(ci.name);
    if (!taskName && r.every((v) => !String(v).trim())) return; // blank line
    let parentWbs = cell(ci.parent).replace(/\.$/, '');
    let parent: Task | undefined;
    if (parentWbs) {
      parent = byWbs.get(parentWbs);
      if (!parent) {
        warnings.push(`Row ${rowNo}: parent WBS "${parentWbs}" not found; imported at top level`);
        parentWbs = '';
      }
    }
    const n = (childCount.get(parentWbs) ?? 0) + 1;
    childCount.set(parentWbs, n);
    const wbs = parentWbs ? `${parentWbs}.${n}` : String(n);
    let duration = 1;
    const durText = cell(ci.duration);
    if (durText) {
      const d = parseDuration(durText);
      if (d === null)
        warnings.push(`Row ${rowNo}: duration "${durText}" not understood; using 1 day`);
      else duration = d;
    }
    const task = blankTask({
      calendarId: project.projectCalendarId,
      name: taskName || `Row ${rowNo}`,
      parentId: parent?.id ?? null,
      order: n,
      duration,
      responsible: cell(ci.resp),
    });
    project.tasks.push(task);
    byWbs.set(wbs, task);
    byRow.set(rowNo, task);
    if (cell(ci.preds)) predText.set(task, cell(ci.preds));
  });

  for (const [task, text] of predText) {
    const { links, errors } = parseLinkList(text);
    for (const e of errors) warnings.push(`${task.name}: ${e}`);
    for (const l of links) {
      const pred = byRow.get(l.rowId);
      if (!pred || pred === task) {
        warnings.push(`${task.name}: predecessor row ${l.rowId} not found`);
        continue;
      }
      const dep: Dependency = {
        id: newId(),
        predecessorId: pred.id,
        successorId: task.id,
        type: l.type,
        lag: l.lag,
        lagUnit: l.lagUnit,
      };
      project.dependencies.push(dep);
      // Reject links that would close a loop, keeping the rest of the import.
      const cycle = detectCycle(project, buildOutline(project.tasks));
      if (cycle) {
        project.dependencies.pop();
        warnings.push(`${task.name}: link from row ${l.rowId} skipped (${cycle.message})`);
      }
    }
  }
  renumber(project.tasks);
  if (!project.tasks.length) throw new Error('No tasks found in the CSV');
  return { project, warnings };
}
