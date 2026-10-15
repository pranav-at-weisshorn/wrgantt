import { getWorkCalendar, type WorkCalendar } from './calendar';
import { dayToIso, isoToDay, isValidIso } from './dates';
import { buildLeafGraph, type Edge } from './graph';
import { buildOutline, type Outline } from './outline';
import type { Project, ScheduleResult, Task, TaskCalc } from './types';

const NEG = -1e9;
const POS = 1e9;

const enum State {
  NotStarted = 0,
  InProgress = 1,
  Complete = 2,
}

/** Remaining working days of an in-progress task. */
export function remainingOf(duration: number, pct: number): number {
  if (duration <= 0) return 0;
  if (pct >= 100) return 0;
  const r = Math.ceil(duration * (1 - pct / 100) - 1e-9);
  return Math.max(1, Math.min(duration, r));
}

function dayOrNull(iso: string | undefined): number | null {
  return isValidIso(iso) ? isoToDay(iso) : null;
}

/** Exclusive finish point for an inclusive finish date. Milestones: the date itself. */
function finishPointFromDate(day: number, n: number) {
  return n > 0 ? day + 1 : day;
}

export function scheduleProject(project: Project, prebuilt?: Outline): ScheduleResult {
  const t0 = performance.now();
  const outline = prebuilt ?? buildOutline(project.tasks);
  const cals = new Map<string, WorkCalendar>();
  for (const c of project.calendars) cals.set(c.id, getWorkCalendar(c));
  const projCal =
    cals.get(project.projectCalendarId) ??
    cals.values().next().value ??
    getWorkCalendar({ id: '_', name: '_', workingWeekdays: [1, 2, 3, 4, 5], holidays: [] });

  const graph = buildLeafGraph(project, outline);
  const { leafIds, order, inEdges, outEdges } = graph;
  const n = leafIds.length;
  const tasks: Task[] = leafIds.map((id) => outline.byId.get(id)!);
  const calOf = tasks.map((t) => cals.get(t.calendarId) ?? projCal);
  const dur = tasks.map((t) => Math.max(0, Math.round(t.duration || 0)));

  const startDay = dayOrNull(project.startDate) ?? isoToDay(dayToIso(0));
  const statusDay = dayOrNull(project.statusDate);

  const ES = new Float64Array(n);
  const EF = new Float64Array(n);
  const LS = new Float64Array(n);
  const LF = new Float64Array(n);
  const logicEF = new Float64Array(n);
  const TF = new Float64Array(n);
  const FFl = new Float64Array(n);
  const rem = new Int32Array(n);
  const state = new Uint8Array(n);
  const violated = new Uint8Array(n);
  const holdsDate = new Uint8Array(n); // MSO/MFO held against logic

  // A zero lag is the identity; the successor's own calendar does the snapping.
  const shiftFwd = (t: number, e: Edge) =>
    !e.dep.lag ? t : e.dep.lagUnit === 'ed' ? t + e.dep.lag : projCal.shift(t, e.dep.lag);
  const shiftInv = (t: number, e: Edge) =>
    !e.dep.lag ? t : e.dep.lagUnit === 'ed' ? t - e.dep.lag : projCal.invShift(t, e.dep.lag);

  /** Earliest start allowed by incoming links for a piece of work of `len` days. */
  const linkStart = (i: number, len: number): number => {
    const cal = calOf[i];
    let es = NEG;
    for (const e of inEdges[i]) {
      const p = e.from;
      let req: number;
      switch (e.dep.type) {
        case 'FS':
          req = shiftFwd(EF[p], e);
          break;
        case 'SS':
          req = shiftFwd(ES[p], e);
          break;
        case 'FF':
          req = cal.startForFinish(shiftFwd(EF[p], e), len);
          break;
        case 'SF':
          req = cal.startForFinish(shiftFwd(ES[p], e), len);
          break;
      }
      if (req > es) es = req;
    }
    return es;
  };

  // ---------------------------------------------------------------- forward pass
  for (const i of order) {
    const t = tasks[i];
    const cal = calOf[i];
    const d = dur[i];
    const pct = Math.max(0, Math.min(100, t.percentComplete || 0));
    const aS = dayOrNull(t.actualStart);
    const aF = dayOrNull(t.actualFinish);
    const floorStart = cal.snap(startDay);

    if (pct >= 100 || aF !== null || (d === 0 && aS !== null)) {
      state[i] = State.Complete;
      rem[i] = 0;
      if (aS !== null && aF !== null) {
        ES[i] = aS;
        EF[i] = d > 0 ? Math.max(aS + 1, aF + 1) : Math.max(aS, aF);
      } else if (aS !== null) {
        ES[i] = aS;
        EF[i] = cal.addDuration(aS, d);
      } else if (aF !== null) {
        EF[i] = finishPointFromDate(aF, d);
        ES[i] = d > 0 ? cal.startForFinish(EF[i], d) : aF;
      } else {
        ES[i] = cal.snap(Math.max(floorStart, linkStart(i, d)));
        EF[i] = cal.addDuration(ES[i], d);
      }
      logicEF[i] = EF[i];
      continue;
    }

    if (aS !== null || pct > 0) {
      // In progress: actual start is fixed; the remaining work follows the status date and logic.
      state[i] = State.InProgress;
      const r = remainingOf(d, pct);
      rem[i] = r;
      const actual = aS ?? cal.snap(Math.max(floorStart, linkStart(i, d)));
      ES[i] = actual;
      let resume = Math.max(actual, linkStart(i, r));
      if (statusDay !== null) resume = Math.max(resume, statusDay);
      resume = cal.snap(resume);
      EF[i] = r > 0 ? cal.addDuration(resume, r) : Math.max(actual, resume);
      logicEF[i] = EF[i];
      checkLateConstraintsForward(i, cal, d);
      continue;
    }

    // Not started.
    state[i] = State.NotStarted;
    rem[i] = d;
    let es = Math.max(floorStart, linkStart(i, d));
    if (statusDay !== null) es = Math.max(es, statusDay);
    es = cal.snap(es);

    const c = t.constraint;
    const cd = dayOrNull(c?.date);
    if (c && cd !== null) {
      switch (c.type) {
        case 'SNET':
          es = Math.max(es, cal.snap(cd));
          break;
        case 'FNET':
          es = Math.max(es, cal.startForFinish(finishPointFromDate(cd, d), d));
          break;
        case 'MSO': {
          const held = cal.snap(cd);
          logicEF[i] = cal.addDuration(es, d);
          if (es > held) {
            violated[i] = 1;
            holdsDate[i] = 1;
          } else logicEF[i] = cal.addDuration(held, d);
          es = held;
          break;
        }
        case 'MFO': {
          const held = cal.startForFinish(finishPointFromDate(cd, d), d);
          logicEF[i] = cal.addDuration(es, d);
          if (es > held) {
            violated[i] = 1;
            holdsDate[i] = 1;
          } else logicEF[i] = cal.addDuration(held, d);
          es = held;
          break;
        }
        default:
          break;
      }
    }
    ES[i] = es;
    EF[i] = cal.addDuration(es, d);
    if (!holdsDate[i]) logicEF[i] = EF[i];
    checkLateConstraintsForward(i, cal, d);
  }

  function checkLateConstraintsForward(i: number, cal: WorkCalendar, d: number) {
    const c = tasks[i].constraint;
    const cd = dayOrNull(c?.date);
    if (!c || cd === null) return;
    if (c.type === 'SNLT' && state[i] === State.NotStarted && ES[i] > cal.snapBack(cd)) {
      violated[i] = 1;
    }
    if (c.type === 'FNLT') {
      const limit = d > 0 ? cal.latestFinishLE(cd + 1) : cal.snapBack(cd);
      if (EF[i] > limit) violated[i] = 1;
    }
  }

  // Project finish = latest early finish.
  let projectFinish = NEG;
  let projectStart = POS;
  for (let i = 0; i < n; i++) {
    if (EF[i] > projectFinish) projectFinish = EF[i];
    if (ES[i] < projectStart) projectStart = ES[i];
  }
  if (n === 0) {
    projectStart = projCal.snap(startDay);
    projectFinish = projectStart;
  }

  // ---------------------------------------------------------------- backward pass
  /** Latest finish of task i allowed by a single outgoing link, given the successor's dates. */
  const boundFromLink = (i: number, e: Edge, sStart: number, sFinish: number): number => {
    const cal = calOf[i];
    const d = state[i] === State.InProgress ? rem[i] : dur[i];
    const norm = (b: number) => (dur[i] > 0 ? cal.latestFinishLE(b) : cal.latestStartLE(b));
    switch (e.dep.type) {
      case 'FS':
        return norm(shiftInv(sStart, e));
      case 'FF':
        return norm(shiftInv(sFinish, e));
      case 'SS':
      case 'SF': {
        // A started task cannot move its start, so start-based links no longer bind it.
        if (state[i] !== State.NotStarted) return POS;
        const b = shiftInv(e.dep.type === 'SS' ? sStart : sFinish, e);
        return cal.addDuration(cal.latestStartLE(b), d);
      }
    }
  };

  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const cal = calOf[i];
    const d = dur[i];
    if (state[i] === State.Complete) {
      LS[i] = ES[i];
      LF[i] = EF[i];
      continue;
    }
    let lf = d > 0 ? cal.latestFinishLE(projectFinish) : cal.latestStartLE(projectFinish);
    for (const e of outEdges[i]) {
      if (state[e.to] === State.Complete) continue;
      const b = boundFromLink(i, e, LS[e.to], LF[e.to]);
      if (b < lf) lf = b;
    }
    const c = tasks[i].constraint;
    const cd = dayOrNull(c?.date);
    if (c && cd !== null) {
      switch (c.type) {
        case 'FNLT':
          lf = Math.min(lf, d > 0 ? cal.latestFinishLE(cd + 1) : cal.snapBack(cd));
          break;
        case 'SNLT':
          if (state[i] === State.NotStarted) {
            lf = Math.min(lf, cal.addDuration(cal.snapBack(cd), d));
          }
          break;
        case 'MSO':
          if (state[i] === State.NotStarted) lf = Math.min(lf, cal.addDuration(cal.snap(cd), d));
          break;
        case 'MFO':
          if (state[i] === State.NotStarted) {
            lf = Math.min(
              lf,
              cal.addDuration(cal.startForFinish(finishPointFromDate(cd, d), d), d),
            );
          }
          break;
        default:
          break;
      }
    }
    LF[i] = lf;
    const len = state[i] === State.InProgress ? rem[i] : d;
    LS[i] = len > 0 ? cal.startForFinish(lf, len) : lf;
  }

  // ---------------------------------------------------------------- float
  for (let i = 0; i < n; i++) {
    const cal = calOf[i];
    if (state[i] === State.Complete) {
      TF[i] = 0;
      FFl[i] = 0;
      continue;
    }
    TF[i] = cal.between(holdsDate[i] ? logicEF[i] : EF[i], LF[i]);
    let ff = POS;
    const outs = outEdges[i].filter((e) => state[e.to] !== State.Complete);
    if (outs.length === 0) {
      const norm =
        dur[i] > 0 ? cal.latestFinishLE(projectFinish) : cal.latestStartLE(projectFinish);
      ff = cal.between(EF[i], norm);
    } else {
      for (const e of outs) {
        const b = boundFromLink(i, e, ES[e.to], EF[e.to]);
        if (b >= POS) continue;
        const slack = cal.between(EF[i], b);
        if (slack < ff) ff = slack;
      }
      if (ff >= POS) ff = TF[i];
    }
    FFl[i] = TF[i] < 0 ? 0 : Math.max(0, Math.min(ff, TF[i]));
  }

  // ---------------------------------------------------------------- results
  const threshold = project.criticalFloatThreshold ?? 0;
  const calc = new Map<string, TaskCalc>();
  for (let i = 0; i < n; i++) {
    const t = tasks[i];
    calc.set(t.id, {
      earlyStart: dayToIso(ES[i]),
      earlyFinish: dayToIso(EF[i]),
      lateStart: dayToIso(LS[i]),
      lateFinish: dayToIso(LF[i]),
      es: ES[i],
      ef: EF[i],
      ls: LS[i],
      lf: LF[i],
      totalFloat: TF[i],
      freeFloat: FFl[i],
      critical: state[i] !== State.Complete && TF[i] <= threshold,
      remainingDuration: rem[i],
      constraintViolated: violated[i] ? true : undefined,
      duration: dur[i],
      percentComplete:
        state[i] === State.Complete ? 100 : Math.max(0, Math.min(99, t.percentComplete || 0)),
      isSummary: false,
      isMilestone: dur[i] === 0,
    });
  }
  rollUpSummaries(outline, calc, projCal, statusDay, threshold);

  return {
    calc,
    projectStart,
    projectFinish,
    cycles: graph.cycles,
    errors: graph.cycles.map((c) => c.message),
    elapsedMs: performance.now() - t0,
  };
}

function rollUpSummaries(
  outline: Outline,
  calc: Map<string, TaskCalc>,
  projCal: WorkCalendar,
  statusDay: number | null,
  threshold: number,
) {
  // Process deepest summaries first so nested summaries are available to their parents.
  const summaries = outline.flat
    .filter((id) => outline.isSummary(id))
    .sort((a, b) => outline.depth.get(b)! - outline.depth.get(a)!);
  for (const id of summaries) {
    const kids = (outline.children.get(id) ?? [])
      .map((k) => calc.get(k))
      .filter(Boolean) as TaskCalc[];
    if (!kids.length) continue;
    let es = POS,
      ef = NEG,
      ls = POS,
      lf = NEG,
      tf = POS,
      ff = POS;
    for (const k of kids) {
      es = Math.min(es, k.es);
      ef = Math.max(ef, k.ef);
      ls = Math.min(ls, k.ls);
      lf = Math.max(lf, k.lf);
      if (k.percentComplete < 100) {
        tf = Math.min(tf, k.totalFloat);
        ff = Math.min(ff, k.freeFloat);
      }
    }
    // Duration-weighted % complete over leaf descendants.
    let wsum = 0,
      wpct = 0,
      psum = 0;
    const leaves = outline.leavesOf(id);
    for (const l of leaves) {
      const c = calc.get(l)!;
      wsum += c.duration;
      wpct += c.duration * c.percentComplete;
      psum += c.percentComplete;
    }
    const pct = wsum > 0 ? wpct / wsum : leaves.length ? psum / leaves.length : 0;
    const complete = pct >= 100;
    if (tf >= POS) tf = 0;
    if (ff >= POS) ff = 0;
    const resumeFrom = statusDay !== null ? Math.max(es, statusDay) : es;
    calc.set(id, {
      earlyStart: dayToIso(es),
      earlyFinish: dayToIso(ef),
      lateStart: dayToIso(ls),
      lateFinish: dayToIso(lf),
      es,
      ef,
      ls,
      lf,
      totalFloat: tf,
      freeFloat: ff,
      critical: !complete && tf <= threshold,
      remainingDuration: complete ? 0 : Math.max(0, projCal.between(resumeFrom, ef)),
      duration: Math.max(0, projCal.between(es, ef)),
      percentComplete: Math.round(pct * 10) / 10,
      isSummary: true,
      isMilestone: false,
    });
  }
}
