/**
 * First draft of how the old Excel schedule (Schedule tab, 14-10-2026) matches the new plan
 * (Villa Felstead 3.0). Only used when no matching file exists yet; after that the matching
 * file (edited by hand) is the source of truth.
 *
 * Old rows are Excel row numbers; new tasks are named by their exact task name in the planner.
 * Rows not listed get a default: "Completed (old)" when 100 % complete, otherwise
 * "Not in new plan yet".
 */
export type MatchStatus = 'Matched' | 'Completed (old)' | 'Not in new plan yet' | 'Ignore';
export const STATUSES: MatchStatus[] = [
  'Matched',
  'Completed (old)',
  'Not in new plan yet',
  'Ignore',
];

export interface DraftEntry {
  status: MatchStatus;
  /** Exact new task names. */
  newTasks?: string[];
  key?: boolean;
  check?: boolean;
  note?: string;
}

const m = (
  newTasks: string[],
  extra: Omit<DraftEntry, 'status' | 'newTasks'> = {},
): DraftEntry => ({
  status: 'Matched',
  newTasks,
  ...extra,
});

export const DRAFT: Record<number, DraftEntry> = {
  // ---------------------------------------------------------------- Design
  5: m(['Architectural Design', 'Structural Design', 'MEP Design', 'FACADE CONSULTANT'], {
    check: true,
    note: 'Whole design phase. The old phase also includes landscape and interior design, which the new plan does not have yet.',
  }),
  8: m(['Concept Redesign'], {
    note: 'Concept was complete in the old design; the new design redoes it.',
  }),
  21: m(['GFCs', 'GFCs for Upper Levels', 'MEP GFCs'], {
    key: true,
    check: true,
    note: 'Old superstructure GFCs vs the new architectural, structural and MEP GFCs (latest finish counts).',
  }),
  37: m(['Facade DD'], { note: 'Done in the old design; redone for the new design.' }),
  39: m(['Tender Package'], { key: true, note: 'Façade tender drawings.' }),
  40: m(['BMU Package']),

  // ---------------------------------------------------------------- Approvals
  54: m(['Approvals'], { note: 'Whole approvals phase.' }),
  65: m(['NOC From Delhi AAI'], {
    check: true,
    note: 'Old 63 m height approval (complete) vs the new NOC for the additional height.',
  }),
  66: m(['CFO V2', 'BMC Concession V2', 'IOD V3', 'CC V3'], {
    note: 'Old Further CC 2nd stage vs the new CFO V2 → BMC Concession V2 → IOD V3 → CC V3 chain.',
  }),
  67: m(['CFO V2']),
  68: m(['BMC Concession V2']),
  69: m(['IOD V3'], { note: 'Old IOD stage 2 vs new IOD V3.' }),
  70: m(['CC V3'], { key: true, note: 'Commencement certificate for the full scope.' }),
  71: m(['Fire NOC', 'OC']),
  72: m(['Fire NOC'], { key: true }),
  73: m(['OC'], { key: true }),
  78: {
    status: 'Not in new plan yet',
    check: true,
    note: 'Possibly "Sales & Marketing" (new row) – that is a milestone on 16 Oct 2026 with no launch logic.',
  },

  // ---------------------------------------------------------------- Contractor appointments
  85: m(['Re-tendering'], {
    check: true,
    note: 'New "Re-tendering" under MEPF execution may cover the firefighting, plumbing and HVAC appointments.',
  }),
  86: m(['Re-tendering'], { check: true }),
  87: m(['Re-tendering'], { check: true }),

  // ---------------------------------------------------------------- Superstructure (RCC)
  126: m(['RCC Works'], { key: true, note: 'RCC complete: old roof slab vs new Club Level.' }),
  128: m(['Podium Level 2'], {
    check: true,
    note: 'Floors differ between the designs. Draft: old Service Floor ≈ new Podium Level 2.',
  }),
  129: m(['Podium Level 3', 'Apartment Level 1'], {
    check: true,
    note: 'Draft: old Floor 1 ≈ new Podium Level 3 + Apartment Level 1 (please confirm).',
  }),
  ...Object.fromEntries(
    Array.from({ length: 11 }, (_, i) => [
      130 + i,
      m([`Apartment Level ${i + 2}`], {
        check: true,
        note: `Draft: old Floor ${i + 2} ≈ new Apartment Level ${i + 2}.`,
      }),
    ]),
  ),
  141: m(['Club Level'], {
    check: true,
    note: 'Old club house floor + roof slab ≈ new Club Level.',
  }),
  142: m(['Club Level'], { check: true }),

  // ---------------------------------------------------------------- MEP
  166: m(['MEPF EXECUTION'], {
    key: true,
    check: true,
    note: 'New MEPF items are 25 days each (placeholders?) vs 6–10 months in the old plan.',
  }),
  167: m(['Fire Fighting'], { check: true }),
  168: m(['Electrical'], { check: true }),
  172: m(['Plumbing'], { check: true }),
  173: m(['HVAC'], { check: true }),

  // ---------------------------------------------------------------- Lifts
  175: m(['Lift Installation'], { note: 'Old lifts & car parking vs new lift installation.' }),
  176: m(['Lift Installation'], { check: true, note: 'Car lift: the new plan has one lift task.' }),
  177: m(['Lift Installation'], { key: true }),

  // ---------------------------------------------------------------- Façade
  199: m(['Facade'], { key: true, note: 'Façade complete, including testing and snags.' }),
  200: m(['Installation']),
  201: m(['Installation'], { check: true, note: 'Windows: part of the new façade installation?' }),
  202: m(['Installation'], { check: true, note: 'Cladding: part of the new façade installation?' }),
  203: m(['Installation'], { check: true, note: 'Pods: part of the new façade installation?' }),
  204: m(['Testing']),
  205: m(['Snag Rectification']),

  // ---------------------------------------------------------------- Close-out
  102: m(['Construction'], {
    check: true,
    note: 'Whole construction phase. The new plan has no finishing works yet, so its end is not comparable.',
  }),
  206: {
    status: 'Not in new plan yet',
    key: true,
    note: 'Handover is not in the new plan yet.',
  },
  51: {
    status: 'Ignore',
    note: 'Excel error: the summary start adds dates together (=SUM) and shows 2152.',
  },
};
