import type { Project } from '../engine';
import { downloadBlob, pickFile, safeFileName } from '../io/files';
import { projectFromJson, projectToJson } from '../io/json';
import { projectToMsProjectXml } from '../io/msproject';
import { derive } from '../store/derive';
import { useStore } from '../store/store';

const toast = (text: string, kind: 'info' | 'error' = 'info') =>
  useStore.getState().toast(text, kind);

export function exportJson(project: Project) {
  downloadBlob(
    projectToJson(project, derive(project).schedule),
    `${safeFileName(project.name)}.gantt.json`,
    'application/json',
  );
}

export async function exportExcel(project: Project) {
  // SheetJS is large; load it only when needed.
  const { buildWorkbook } = await import('../io/excel');
  const bytes = buildWorkbook(project, derive(project));
  downloadBlob(
    bytes as BlobPart,
    `${safeFileName(project.name)}.xlsx`,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

export function exportMsProject(project: Project) {
  downloadBlob(
    projectToMsProjectXml(project, derive(project)),
    `${safeFileName(project.name)}.xml`,
    'application/xml',
  );
}

/** Ask for a .gantt.json or .csv file and turn it into a new project (not yet saved). */
export async function importProjectFile(): Promise<Project | null> {
  const file = await pickFile('.json,.gantt.json,.csv,text/csv,application/json');
  if (!file) return null;
  const text = await file.text();
  const base = file.name.replace(/\.(gantt\.json|json|csv)$/i, '');
  try {
    if (/\.csv$/i.test(file.name)) {
      const { projectFromCsv } = await import('../io/csv');
      const { project, warnings } = projectFromCsv(text, base);
      if (warnings.length) {
        toast(
          `Imported with ${warnings.length} warning${warnings.length === 1 ? '' : 's'}: ${warnings.slice(0, 3).join('; ')}${warnings.length > 3 ? '…' : ''}`,
          'error',
        );
      } else toast(`Imported ${project.tasks.length} tasks from ${file.name}`);
      return project;
    }
    const project = projectFromJson(text);
    toast(`Imported “${project.name}”`);
    return project;
  } catch (e) {
    toast(`Could not import ${file.name}: ${e instanceof Error ? e.message : e}`, 'error');
    return null;
  }
}
