/**
 * Old design (Excel) vs new design (planner) comparison.
 *
 *   npm run compare -- --old "<old schedule.xlsx>" --plan "<project.gantt.json>" [--out <folder>]
 *
 * Writes into the output folder (default: ../Comparison next to this app):
 *   "Old vs new design - matching.xlsx"    only if it does not exist yet (your edits are kept)
 *   "Old vs new design - comparison.xlsx"  regenerated on every run
 * Both input files are only read.
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { draftMatching, readMatchingFile, writeMatchingFile } from './matching';
import { readOldSchedule } from './old';
import { readNewPlan } from './plan';
import { buildComparison } from './report';

const MATCHING = 'Old vs new design - matching.xlsx';
const COMPARISON = 'Old vs new design - comparison.xlsx';

function arg(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

/** Snapshot date from a file name like "... SCHEDULE-14-10-2026.xlsx", else the file's date. */
function snapshotDay(file: string): number {
  const m = /(\d{2})-(\d{2})-(\d{4})/.exec(path.basename(file));
  const ms = m ? Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])) : statSync(file).mtimeMs;
  return Math.floor(ms / 86_400_000);
}

function save(file: string, data: Uint8Array) {
  try {
    writeFileSync(file, data);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM')
      throw new Error(`"${path.basename(file)}" is open in Excel. Close it and run again.`);
    throw e;
  }
}

export default function main(args: string[]) {
  const oldFile = arg(args, 'old');
  const planFile = arg(args, 'plan');
  if (!oldFile || !planFile)
    throw new Error('Usage: --old <schedule.xlsx> --plan <project.gantt.json> [--out <folder>]');
  const out = path.resolve(arg(args, 'out') ?? path.join(process.cwd(), '..', 'Comparison'));
  mkdirSync(out, { recursive: true });

  const snap = snapshotDay(oldFile);
  const old = readOldSchedule(new Uint8Array(readFileSync(oldFile)), snap);
  const plan = readNewPlan(readFileSync(planFile, 'utf8'));

  const matchingFile = path.join(out, MATCHING);
  let matching;
  if (existsSync(matchingFile)) {
    matching = readMatchingFile(new Uint8Array(readFileSync(matchingFile)), old, plan);
    console.log(`Read the matching from ${matchingFile}`);
  } else {
    matching = draftMatching(old, plan);
    save(matchingFile, writeMatchingFile(matching, old, plan));
    console.log(`Drafted the matching: ${matchingFile}`);
  }
  for (const w of matching.warnings) console.log(`  ! ${w}`);

  const comparisonFile = path.join(out, COMPARISON);
  save(
    comparisonFile,
    buildComparison(old, plan, matching, {
      oldFile,
      oldSnapshot: snap,
      planFile: path.resolve(planFile),
    }),
  );
  console.log(`Wrote the comparison: ${comparisonFile}`);
  console.log(
    `Old: ${old.rows.length} activities · New: ${plan.tasks.length} tasks · ` +
      `${matching.lines.filter((l) => l.status === 'Matched').length} matched, ` +
      `${matching.lines.filter((l) => l.check).length} to check`,
  );
}
