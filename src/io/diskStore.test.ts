import { describe, expect, it } from 'vitest';
import type { Project } from '../engine';
import { emptyProject } from '../template/load';
import {
  DELETED_DIR,
  fileBase,
  matchesBase,
  moveToDeleted,
  readFolderProject,
  readTextFile,
  resolveFileName,
  saveProjectFile,
  scanFolder,
  writeTextFile,
  writeVersionFile,
  type FileMap,
} from './diskStore';

// A minimal in-memory folder that behaves like a FileSystemDirectoryHandle.
class FakeFile {
  kind = 'file' as const;
  data = { text: '', modified: 0 };
  async getFile() {
    const { text, modified } = this.data;
    return { lastModified: modified, size: text.length, text: async () => text };
  }
  async createWritable() {
    let buf = '';
    return {
      write: async (t: string) => void (buf += t),
      close: async () => void (this.data = { text: buf, modified: Date.now() }),
      abort: async () => undefined,
    };
  }
}
class FakeDir {
  kind = 'directory' as const;
  entriesMap = new Map<string, FakeFile | FakeDir>();
  async getFileHandle(name: string, o?: { create?: boolean }) {
    const e = this.entriesMap.get(name);
    if (e instanceof FakeFile) return e;
    if (e) throw new DOMException('mismatch', 'TypeMismatchError');
    if (!o?.create) throw new DOMException('missing', 'NotFoundError');
    const f = new FakeFile();
    this.entriesMap.set(name, f);
    return f;
  }
  async getDirectoryHandle(name: string, o?: { create?: boolean }) {
    const e = this.entriesMap.get(name);
    if (e instanceof FakeDir) return e;
    if (e) throw new DOMException('mismatch', 'TypeMismatchError');
    if (!o?.create) throw new DOMException('missing', 'NotFoundError');
    const d = new FakeDir();
    this.entriesMap.set(name, d);
    return d;
  }
  async removeEntry(name: string) {
    if (!this.entriesMap.delete(name)) throw new DOMException('missing', 'NotFoundError');
  }
  async *entries() {
    yield* this.entriesMap.entries();
  }
}
const newDir = () => new FakeDir() as unknown as FileSystemDirectoryHandle & FakeDir;
const names = (d: unknown) => [...(d as FakeDir).entriesMap.keys()].sort();

const proj = (name: string): Project => emptyProject(name, '2026-11-02');

describe('file names', () => {
  it('makes safe names', () => {
    expect(fileBase('Villa: Felstead / phase 1?')).toBe('Villa- Felstead - phase 1-');
    expect(fileBase('trailing dots...')).toBe('trailing dots');
    expect(fileBase('   ')).toBe('project');
  });
  it('matches the base and numbered variants only', () => {
    expect(matchesBase('Villa.gantt.json', 'Villa')).toBe(true);
    expect(matchesBase('villa (2).gantt.json', 'Villa')).toBe(true);
    expect(matchesBase('Villa two.gantt.json', 'Villa')).toBe(false);
    expect(matchesBase('Villa (copy).gantt.json', 'Villa')).toBe(false);
  });
});

describe('saving project files', () => {
  it('writes <name>.gantt.json as pretty JSON that reads back', async () => {
    const dir = newDir();
    const map: FileMap = {};
    const p = proj('Alpha');
    const { name } = await saveProjectFile(dir, p, map);
    expect(name).toBe('Alpha.gantt.json');
    const { text } = await readTextFile(dir, name);
    expect(text).toContain('\n  "schemaVersion"');
    const back = await readFolderProject(dir, name);
    expect(back.project.id).toBe(p.id);
    expect(map[p.id].name).toBe(name);
  });

  it('adds (2) when another project has the name, and keeps the names stable', async () => {
    const dir = newDir();
    const map: FileMap = {};
    const a = proj('Same');
    const b = proj('Same');
    expect((await saveProjectFile(dir, a, map)).name).toBe('Same.gantt.json');
    expect((await saveProjectFile(dir, b, map)).name).toBe('Same (2).gantt.json');
    expect((await saveProjectFile(dir, a, map)).name).toBe('Same.gantt.json');
    expect((await saveProjectFile(dir, b, map)).name).toBe('Same (2).gantt.json');
    expect(names(dir)).toEqual(['Same (2).gantt.json', 'Same.gantt.json']);
  });

  it('does not overwrite an unknown file with the same name', async () => {
    const dir = newDir();
    const other = proj('Taken');
    await saveProjectFile(dir, other, {});
    const mine = proj('Taken');
    expect(await resolveFileName(dir, mine, {})).toBe('Taken (2).gantt.json');
    // ...but reuses a file that already holds this project.
    expect(await resolveFileName(dir, other, {})).toBe('Taken.gantt.json');
  });

  it('writes the new file and removes the old one when the project is renamed', async () => {
    const dir = newDir();
    const map: FileMap = {};
    const p = proj('Before');
    await saveProjectFile(dir, p, map);
    const renamed = { ...p, name: 'After' };
    expect((await saveProjectFile(dir, renamed, map)).name).toBe('After.gantt.json');
    expect(names(dir)).toEqual(['After.gantt.json']);
    expect(map[p.id].name).toBe('After.gantt.json');
  });
});

describe('scanning and deleting', () => {
  it('lists top-level project files, reports unreadable ones, ignores subfolders', async () => {
    const dir = newDir();
    const map: FileMap = {};
    await saveProjectFile(dir, proj('One'), map);
    await saveProjectFile(dir, proj('Two'), map);
    await writeTextFile(dir, 'notes.txt', 'hello');
    await writeTextFile(dir, 'broken.gantt.json', '{nope');
    const sub = await dir.getDirectoryHandle('Deleted', { create: true });
    await saveProjectFile(sub, proj('Hidden'), {});
    const scan = await scanFolder(dir);
    expect(scan.projects.map((p) => p.name).sort()).toEqual(['One', 'Two']);
    expect(scan.unreadable).toEqual(['broken.gantt.json']);
  });

  it('prefers the mapped file when two files hold the same project', async () => {
    const dir = newDir();
    await saveProjectFile(dir, proj('Dup'), {});
    const { text } = await readTextFile(dir, 'Dup.gantt.json');
    await writeTextFile(dir, 'Dup - copy.gantt.json', text);
    const scan = await scanFolder(dir, () => 'Dup.gantt.json');
    expect(scan.projects).toHaveLength(1);
    expect(scan.projects[0].fileName).toBe('Dup.gantt.json');
  });

  it('moves a deleted project into Deleted/ so a rescan does not find it', async () => {
    const dir = newDir();
    await saveProjectFile(dir, proj('Gone'), {});
    expect(await moveToDeleted(dir, 'Gone.gantt.json')).toBe('Gone.gantt.json');
    expect(names(dir)).toEqual([DELETED_DIR]);
    expect((await scanFolder(dir)).projects).toEqual([]);
    const deleted = await dir.getDirectoryHandle(DELETED_DIR);
    expect(names(deleted)).toEqual(['Gone.gantt.json']);
    // A later deletion with the same file name does not overwrite the first.
    await saveProjectFile(dir, proj('Gone'), {});
    expect(await moveToDeleted(dir, 'Gone.gantt.json')).toBe('Gone (2).gantt.json');
  });
});

describe('version files', () => {
  it('writes under Versions/<project>/ and never overwrites', async () => {
    const dir = newDir();
    const file = '2026-10-15 1642 Daily snapshot.gantt.json';
    const a = await writeVersionFile(dir, 'My: project', file, '{}');
    const b = await writeVersionFile(dir, 'My: project', file, '{}');
    expect(a).toEqual({ dir: 'My- project', name: file });
    expect(b.name).toBe('2026-10-15 1642 Daily snapshot (2).gantt.json');
    const versions = await dir.getDirectoryHandle('Versions');
    const folder = await versions.getDirectoryHandle('My- project');
    expect(names(folder)).toHaveLength(2);
  });
});
