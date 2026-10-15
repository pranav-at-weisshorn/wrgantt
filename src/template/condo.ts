/**
 * Preloaded template: for-sale condominium development (brief section 6).
 * Durations are working days on the Standard calendar; 0 = milestone.
 * Predecessors use template keys: "A05", "D04 SS+20d", "C17 FF+10d" (d = working days).
 * Changes made to make the template checks pass are recorded in PLAN.md.
 */

export interface TemplateTask {
  key: string;
  name: string;
  dur: number;
  preds: string;
  resp: string;
  calendar?: '7day';
}

export interface TemplatePhase {
  key: string;
  name: string;
  color: string;
  tasks: TemplateTask[];
}

const t = (
  key: string,
  name: string,
  dur: number | 'M',
  preds: string,
  resp: string,
  calendar?: '7day',
): TemplateTask => ({ key, name, dur: dur === 'M' ? 0 : dur, preds, resp, calendar });

export const CONDO_TEMPLATE: TemplatePhase[] = [
  {
    key: 'P1',
    name: 'Acquisition & Feasibility',
    color: '#8c7067',
    tasks: [
      t('A01', 'Site identified', 'M', '', 'Developer'),
      t('A02', 'Preliminary feasibility & pro forma', 10, 'A01', 'Developer'),
      t('A03', 'Letter of intent negotiated & signed', 10, 'A02', 'Developer'),
      t('A04', 'Purchase & sale agreement executed', 15, 'A03', 'Developer / Counsel'),
      t('A05', 'Title search & title commitment', 20, 'A04', 'Title company'),
      t('A06', 'Boundary & topographic survey', 25, 'A04', 'Surveyor'),
      t('A07', 'Phase I environmental site assessment', 25, 'A04', 'Environmental consultant'),
      t('A08', 'Geotechnical investigation', 30, 'A04', 'Geotech engineer'),
      t('A09', 'Zoning & entitlement analysis', 15, 'A04', 'Planner'),
      t('A10', 'Utility capacity confirmation', 20, 'A04', 'Civil engineer'),
      t('A11', 'Condo market study (pricing, absorption)', 25, 'A04', 'Market consultant'),
      t(
        'A12',
        'Updated pro forma & go/no-go decision',
        5,
        'A05, A06, A07, A08, A09, A10, A11',
        'Developer',
      ),
      t('A13', 'Due diligence complete', 'M', 'A12', 'Developer'),
      t('A14', 'Land closing', 5, 'A13, F03', 'Developer / Counsel'),
      t('A15', 'Land acquired', 'M', 'A14', 'Developer'),
    ],
  },
  {
    key: 'P2',
    name: 'Financing',
    color: '#6f8a6a',
    tasks: [
      t('F01', 'Prepare investor package', 15, 'A11', 'Developer'),
      t('F02', 'Equity raise & subscriptions', 45, 'F01', 'Developer'),
      t('F03', 'Equity commitment secured', 'M', 'F02', 'Developer'),
      t('F04', 'Construction lender outreach & term sheet', 30, 'D03, F03', 'Developer / Lender'),
      t('F05', 'Appraisal', 20, 'F04, D04', 'Appraiser'),
      t('F06', 'Lender due diligence & loan documentation', 30, 'F05', 'Lender / Counsel'),
      t('F07', 'Construction loan closing', 10, 'F06, S08, P05, B06', 'Lender / Counsel'),
      t('F08', 'Construction financing in place', 'M', 'F07', 'Developer'),
    ],
  },
  {
    key: 'P3',
    name: 'Entitlements & Approvals',
    color: '#8a6f8f',
    tasks: [
      t('E01', 'Pre-application meeting with planning', 5, 'A09', 'Planner'),
      t('E02', 'Traffic impact study', 30, 'D02', 'Traffic engineer'),
      t('E03', 'Environmental & stormwater review', 30, 'A07, D02', 'Civil engineer'),
      t('E04', 'Rezoning / site plan application submitted', 10, 'D02, E01', 'Planner'),
      t('E05', 'Planning staff review & comments', 40, 'E04', 'Municipality'),
      t('E06', 'Revisions & resubmission', 15, 'E05, E02, E03', 'Planner / Architect'),
      t('E07', 'Public notice & community meeting', 20, 'E06', 'Planner'),
      t('E08', 'Planning commission hearing', 1, 'E07', 'Municipality'),
      t('E09', 'Council / board approval', 1, 'E08 FS+20d', 'Municipality'),
      t('E10', 'Appeal period (30 calendar days)', 30, 'E09', 'Municipality', '7day'),
      t('E11', 'Entitlements final', 'M', 'E10', 'Planner'),
    ],
  },
  {
    key: 'P4',
    name: 'Design',
    color: '#5f8496',
    tasks: [
      t('D01', 'Architect & consultant team engaged', 15, 'A09', 'Developer'),
      t('D02', 'Concept design & massing', 25, 'D01, A06', 'Architect'),
      t('D03', 'Schematic design', 40, 'D02, A13', 'Architect'),
      t('D04', 'Design development', 50, 'D03', 'Architect'),
      t(
        'D05',
        'Unit layouts & finish packages (sales-ready)',
        30,
        'D04 SS+20d',
        'Interior designer',
      ),
      t('D06', 'Construction documents', 70, 'D04, E09', 'Architect'),
      t('D07', 'Consultant coordination & clash detection', 60, 'D06 SS+10d', 'Engineers'),
      t('D08', 'Permit set issued', 'M', 'D06, D07', 'Architect'),
      t('D09', 'Issued-for-construction drawings', 15, 'P03', 'Architect'),
    ],
  },
  {
    key: 'P5',
    name: 'Permitting',
    color: '#a0907c',
    tasks: [
      t('P01', 'Building permit application submitted', 5, 'D08, E11', 'Architect'),
      t('P02', 'Plan review – cycle 1', 40, 'P01', 'Building dept.'),
      t('P03', 'Respond to comments & resubmit', 15, 'P02', 'Architect'),
      t('P04', 'Plan review – cycle 2', 20, 'P03', 'Building dept.'),
      t('P05', 'Building permit issued', 'M', 'P04', 'Building dept.'),
      t(
        'P06',
        'Utility connection applications (water, sewer, power)',
        20,
        'D06 SS+30d',
        'Civil / MEP engineer',
      ),
      t('P07', 'Utility agreements executed', 40, 'P06', 'Utilities'),
      t('P08', 'Site & excavation permit', 25, 'E11, D06 SS+20d', 'Civil engineer'),
    ],
  },
  {
    key: 'P6',
    name: 'Sales & Marketing',
    color: '#b8826b',
    tasks: [
      t('S01', 'Sales strategy & pricing', 15, 'A11, D03', 'Sales team'),
      t('S02', 'Branding & marketing collateral', 30, 'S01, D05 SS+10d', 'Marketing agency'),
      t(
        'S03',
        'Sales center / show suite design & build',
        50,
        'S01, D05',
        'Sales team / Contractor',
      ),
      t('S04', 'Broker & agent program setup', 10, 'S01', 'Sales team'),
      t('S05', 'Pre-launch registration campaign', 30, 'S02', 'Marketing agency'),
      t('S06', 'Sales launch', 'M', 'L06, L07, S03, S04, S05', 'Sales team'),
      t('S07', 'Pre-sales to lender threshold (~60% of units)', 80, 'S06', 'Sales team'),
      t('S08', 'Pre-sales threshold reached', 'M', 'S07', 'Sales team'),
      t('S09', 'Continued sales to sell-out', 200, 'S08', 'Sales team'),
      t('S10', 'Buyer upgrade & option selections', 60, 'C10 SS', 'Sales team / Interior designer'),
    ],
  },
  {
    key: 'P7',
    name: 'Condo Legal & Association',
    color: '#6b6f94',
    tasks: [
      t('L01', 'Condo counsel engaged & structure confirmed', 10, 'A12', 'Counsel'),
      t('L02', 'Draft declaration / CC&Rs & bylaws', 30, 'L01, D04 SS+20d', 'Counsel'),
      t('L03', 'Association budget & reserve study', 25, 'D04 SS+20d', 'Reserve consultant'),
      t('L04', 'Disclosure / offering statement prepared', 25, 'L02, L03, D05', 'Counsel'),
      t('L05', 'Regulatory filing & review', 40, 'L04', 'Regulator'),
      t('L06', 'Disclosure statement accepted', 'M', 'L05', 'Regulator'),
      t('L07', 'Deposit escrow / trust agreement', 10, 'L01', 'Counsel / Escrow agent'),
      t('L08', 'As-built condo plan survey', 30, 'C17 SS+20d', 'Surveyor'),
      t('L09', 'Condo plan registered / declaration recorded', 20, 'L08, X03', 'Counsel'),
      t(
        'L10',
        "Owners' association formed & master insurance bound",
        10,
        'L09',
        'Counsel / Developer',
      ),
    ],
  },
  {
    key: 'P8',
    name: 'Procurement',
    color: '#9a9a5c',
    tasks: [
      t('B01', 'GC prequalification', 15, 'D03', 'Developer'),
      t('B02', 'Preconstruction services agreement (CM/GC)', 15, 'B01', 'Developer / GC'),
      t('B03', 'Preconstruction estimating & value engineering', 60, 'B02, D04 SS', 'GC'),
      t('B04', 'Trade tendering (bid packages)', 40, 'D06 SS+40d, B03', 'GC'),
      t('B05', 'Bid leveling & GMP negotiation', 20, 'B04, D08', 'GC / Developer'),
      t('B06', 'GMP / construction contract executed', 5, 'B05', 'Developer / GC'),
      t('B07', 'Long-lead: elevators (order & fabricate)', 120, 'D06 SS+30d, B02', 'GC'),
      t('B08', 'Long-lead: switchgear & transformer', 140, 'D06 SS+30d, B02', 'GC'),
      t('B09', 'Long-lead: windows & curtain wall', 100, 'D06 SS+40d, B02', 'GC'),
      t('B10', 'Long-lead: HVAC equipment', 90, 'D06 SS+40d, B02', 'GC'),
      t('B11', 'Shop drawings & submittals', 60, 'B06', 'GC / Trades'),
    ],
  },
  {
    key: 'P9',
    name: 'Construction',
    color: '#c8a46e',
    tasks: [
      t('C01', 'Notice to proceed', 'M', 'F08, P05, D09, A15', 'Developer'),
      t('C02', 'Mobilization & site setup', 10, 'C01', 'GC'),
      t('C03', 'Demolition & site clearing', 15, 'C02, P08', 'GC'),
      t('C04', 'Excavation & shoring', 30, 'C03', 'GC'),
      t('C05', 'Underground utilities & site services', 25, 'C04 SS+10d', 'GC'),
      t('C06', 'Foundations', 35, 'C04, B11 SS+15d', 'GC'),
      t('C07', 'Below-grade structure / parking', 40, 'C06', 'GC'),
      t('C08', 'Superstructure', 120, 'C07', 'GC'),
      t('C09', 'Roof structure & roofing', 20, 'C08', 'GC'),
      t('C10', 'MEP rough-in', 100, 'C08 SS+30d', 'GC / MEP trades'),
      t('C11', 'HVAC & mechanical equipment install', 20, 'B10, C09', 'MEP trades'),
      t('C12', 'Building envelope (windows, cladding)', 90, 'C08 SS+40d, B09', 'GC'),
      t('C13', 'Building dried-in', 'M', 'C09, C12', 'GC'),
      t('C14', 'Elevator installation', 40, 'B07, C08', 'Elevator contractor'),
      t('C15', 'Electrical service & switchgear install', 15, 'B08, C07', 'Electrical trade'),
      t('C16', 'Drywall & interior framing', 70, 'C13, C10 SS+30d', 'GC'),
      t('C17', 'Interior finishes (flooring, cabinets, millwork)', 80, 'C16 SS+20d, S10', 'GC'),
      t('C18', 'Fixtures, appliances & trim-out', 40, 'C17 FF+10d', 'GC'),
      t('C19', 'Common areas & amenities', 40, 'C16 SS+40d', 'GC'),
      t('C20', 'Permanent power energized', 5, 'C15, P07', 'Utility / Electrical'),
      t(
        'C21',
        'Fire alarm, sprinkler & life-safety systems',
        30,
        'C10, C20',
        'Fire protection trade',
      ),
      t('C22', 'Elevator commissioning & inspection', 10, 'C14, C20', 'Elevator contractor'),
      t('C23', 'Sitework, paving & landscaping', 30, 'C09, C05', 'GC'),
      t('C24', 'MEP systems commissioning', 20, 'C11, C20, C21', 'Commissioning agent'),
      t('C25', 'Substantial completion', 'M', 'C17, C18, C19, C22, C23, C24', 'GC'),
    ],
  },
  {
    key: 'P10',
    name: 'Inspections & Closeout',
    color: '#6f9c9a',
    tasks: [
      t('X01', 'Fire marshal / life-safety final inspection', 5, 'C21, C24', 'Fire marshal'),
      t('X02', 'Building final inspection', 5, 'C25, X01', 'Building dept.'),
      t('X03', 'Certificate of occupancy', 'M', 'X02', 'Building dept.'),
      t('X04', 'Developer punch list', 20, 'C25', 'GC / Developer'),
      t('X05', 'As-built drawings & O&M manuals', 20, 'C25', 'GC'),
      t('X06', 'Final completion', 'M', 'X04, X05', 'GC'),
    ],
  },
  {
    key: 'P11',
    name: 'Unit Delivery & Handover',
    color: '#4e7364',
    tasks: [
      t('H01', 'Buyer pre-delivery inspections', 20, 'C25 FS+5d', 'Sales team / GC'),
      t('H02', 'Deficiency rectification', 20, 'H01 SS+5d', 'GC'),
      t('H03', 'New-home warranty enrollment', 10, 'C25', 'Developer'),
      t('H04', 'Unit closings / title transfers', 40, 'L09, X03, H03', 'Counsel / Sales team'),
      t('H05', 'Final unit closed', 'M', 'H04, S09', 'Sales team'),
      t('H06', "Turnover to owners' association", 10, 'H04 SS+30d, L10', 'Developer'),
      t('H07', 'Project closeout & final accounting', 15, 'H05, X06, H06, H02', 'Developer'),
      t('H08', 'Project complete', 'M', 'H07', 'Developer'),
    ],
  },
];
