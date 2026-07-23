/**
 * E2E test data foundation — single source of truth for the seeded emulator
 * dataset AND the exact values specs assert against.
 *
 * - scripts/seed-e2e-data.mjs writes `SEED` into the Firestore emulator.
 * - tests/e2e/*.spec.mjs assert the precomputed numbers in `EXPECTED`.
 * Both derive from the same constants below, so a change here keeps the seed
 * and the assertions in lockstep.
 *
 * IMPORTANT (clock): the app computes "today" with `new Date()` — it is NOT
 * mocked by the build. All seeded dates are ABSOLUTE and anchored to
 * E2E_TODAY (mid-July 2026), so any spec that asserts current-month KPIs,
 * date-range filters, or payment-status tags MUST pin the browser clock
 * first, e.g.:
 *   await page.clock.setFixedTime(new Date(E2E_TODAY));
 * (before the first navigation). auth.setup.mjs does not need the clock.
 *
 * Pure module — no firebase/playwright imports; Node-importable.
 */

// Fixed "now" for the whole E2E dataset: Wednesday 2026-07-15, noon PST.
export const E2E_TODAY = '2026-07-15T12:00:00-07:00';
export const E2E_TODAY_MS = Date.parse(E2E_TODAY);

// Auth emulator requires >= 6 chars. Shared by every persona.
export const PASSWORD = 'e2e-test-password';

export const ADMIN_EMAIL = 'admin@cedargrovellp.com';
export const ATTORNEY_EMAIL = 'nick@cedargrovellp.com';
export const PARTIAL_EMAIL = 'valery@cedargrovellp.com';

// Personas — keyed to the Playwright projects (chromium-admin/-attorney/-partial).
// `storageState` paths match playwright.config.mjs. The partial persona
// mirrors the real partial-admin shape from scripts/seed-permissions.mjs
// GRANTS: { partialAdmin: true, transactionsOpsAccess: true }.
export const PERSONAS = {
  admin: {
    role: 'admin',
    email: ADMIN_EMAIL,
    name: 'Alex Adams',
    storageState: '.auth/admin.json',
  },
  attorney: {
    role: 'attorney',
    email: ATTORNEY_EMAIL,
    name: 'Nick Nolan',
    storageState: '.auth/attorney.json',
  },
  partial: {
    role: 'partial',
    email: PARTIAL_EMAIL,
    name: 'Valery Vaughn',
    storageState: '.auth/partial.json',
    permissions: { partialAdmin: true, transactionsOpsAccess: true },
  },
};

// ---------------------------------------------------------------------------
// Rate card — 20 levels, rank 0-19 (A1/A -> P2/B), deterministic ladder.
// users[].rates[].rate values below are EXACT clientRate matches so the
// Projected Earnings rank derivation finds every attorney.
// ---------------------------------------------------------------------------
const LEVEL_NAMES = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'S1', 'S2', 'P1', 'P2'];

export const clientRateOf = (rank) => 150 + 25 * rank;
export const attorneyRateOf = (rank) => 70 + 15 * rank;

export const RATE_CARD_LEVELS = Array.from({ length: 20 }, (_, rank) => ({
  rank,
  level: LEVEL_NAMES[Math.floor(rank / 2)],
  tier: rank % 2 === 0 ? 'A' : 'B',
  clientRate: clientRateOf(rank),
  attorneyRate: attorneyRateOf(rank),
  colinRate: rank >= 13 ? attorneyRateOf(rank) + 10 : null,
  estAnnualSalary: attorneyRateOf(rank) * 2000,
  cravathTotalComp: 225000 + 20000 * rank,
}));

// ---------------------------------------------------------------------------
// Attorneys + raw time entries (May/June/July 2026).
// earnings per billable entry = hours x takeHomeRate + adjustment, mirroring
// the sheet's "Billables Earnings" construction (adjustment already inside).
// Dates use noon PST so PST calendar-day normalization can never shift them.
// ---------------------------------------------------------------------------
const d = (iso) => `${iso}T12:00:00-07:00`;

// name is also the users/{docId} — doc IDs are display names, not emails.
const ATTORNEY_DEFS = [
  {
    name: 'Alex Adams',
    email: ADMIN_EMAIL,
    role: 'Partner',
    rank: 10, // clientRate 400, takeHome 220
    billables: {
      '2026-05': [
        { date: d('2026-05-05'), client: 'Acme Corp', matter: 'General Corporate', hours: 10 },
        { date: d('2026-05-12'), client: 'Bluebird Labs', matter: 'Series A', hours: 5 },
      ],
      '2026-06': [
        { date: d('2026-06-03'), client: 'Acme Corp', matter: 'General Corporate', hours: 8 },
        { date: d('2026-06-18'), client: 'Cobalt Industries', matter: 'Licensing', hours: 6 },
      ],
      '2026-07': [
        // McClure-style manual bill adjustment: +$250 folded into earnings.
        { date: d('2026-07-02'), client: 'Acme Corp', matter: 'General Corporate', hours: 4, adjustment: 250 },
        { date: d('2026-07-10'), client: 'Bluebird Labs', matter: 'Series A', hours: 6 },
      ],
    },
    ops: {
      '2026-05': [{ date: d('2026-05-06'), description: 'Recruiting screen', category: 'Recruiting', hours: 3 }],
      '2026-06': [{ date: d('2026-06-10'), description: 'Firm administration', category: 'Admin', hours: 2 }],
      '2026-07': [{ date: d('2026-07-08'), description: 'Business development call', category: 'Business Development', hours: 2 }],
    },
  },
  {
    name: 'Nick Nolan',
    email: ATTORNEY_EMAIL,
    role: 'Attorney',
    rank: 4, // clientRate 250, takeHome 130
    billables: {
      '2026-05': [
        { date: d('2026-05-07'), client: 'Delta Ventures', matter: 'Fund Formation', hours: 12 },
        { date: d('2026-05-20'), client: 'Evergreen Partners', matter: 'Employment', hours: 8 },
      ],
      '2026-06': [
        { date: d('2026-06-09'), client: 'Delta Ventures', matter: 'Fund Formation', hours: 10 },
        { date: d('2026-06-22'), client: 'Foxglove LLC', matter: 'Trademark', hours: 5 },
      ],
      '2026-07': [
        { date: d('2026-07-06'), client: 'Delta Ventures', matter: 'Fund Formation', hours: 7 },
      ],
    },
    ops: {
      '2026-05': [{ date: d('2026-05-08'), description: 'CLE training', category: 'Training', hours: 4 }],
      '2026-06': [{ date: d('2026-06-11'), description: 'Knowledge base updates', category: 'Admin', hours: 3 }],
      '2026-07': [{ date: d('2026-07-07'), description: 'Team meeting', category: 'Internal', hours: 1 }],
    },
  },
  {
    name: 'Valery Vaughn',
    email: PARTIAL_EMAIL,
    role: 'Attorney',
    rank: 7, // clientRate 325, takeHome 175
    billables: {
      '2026-06': [
        { date: d('2026-06-04'), client: 'Acme Corp', matter: 'Data Privacy', hours: 6 },
        { date: d('2026-06-16'), client: 'Cobalt Industries', matter: 'Licensing', hours: 4 },
      ],
      '2026-07': [
        { date: d('2026-07-03'), client: 'Evergreen Partners', matter: 'Employment', hours: 5 },
      ],
    },
    ops: {
      '2026-06': [{ date: d('2026-06-05'), description: 'Ops process review', category: 'Admin', hours: 2 }],
      '2026-07': [{ date: d('2026-07-09'), description: 'Vendor management', category: 'Admin', hours: 2 }],
    },
  },
];

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];
const monthNameOf = (monthKey) => MONTH_NAMES[Number(monthKey.slice(5)) - 1];
const yearOf = (monthKey) => Number(monthKey.slice(0, 4));

// Same target row for every seeded month — keeps utilization assertions simple.
export const TARGETS = { billableHours: 100, opsHours: 40, totalHours: 140 };
const TARGET_MONTHS = ['2026-05', '2026-06', '2026-07'];

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Build the exact Firestore user docs + subcollection docs, deriving every
// earnings figure from hours x takeHomeRate + adjustment.
function buildUsers() {
  return ATTORNEY_DEFS.map((def) => {
    const clientRate = clientRateOf(def.rank);
    const takeHomeRate = attorneyRateOf(def.rank);

    const billablesDocs = {};
    let rowB = 10;
    for (const [monthKey, entries] of Object.entries(def.billables)) {
      const withEarnings = entries.map((e) => ({
        date: e.date,
        client: e.client,
        matter: e.matter,
        hours: e.hours,
        earnings: e.hours * takeHomeRate + (e.adjustment || 0),
        adjustment: e.adjustment || 0,
        billingCategory: 'General',
        reimbursements: 0,
        notes: '',
        sheetRowNumber: rowB++,
      }));
      billablesDocs[monthKey] = {
        month: monthNameOf(monthKey),
        year: yearOf(monthKey),
        entries: withEarnings,
        sheetTotals: {
          totalBillableHours: round2(withEarnings.reduce((s, e) => s + e.hours, 0)),
          billableEarnings: round2(withEarnings.reduce((s, e) => s + e.earnings, 0)),
        },
      };
    }

    const opsDocs = {};
    let rowO = 10;
    for (const [monthKey, entries] of Object.entries(def.ops)) {
      const rows = entries.map((e) => ({
        date: e.date,
        description: e.description,
        category: e.category,
        hours: e.hours,
        sheetRowNumber: rowO++,
      }));
      const opsHours = round2(rows.reduce((s, e) => s + e.hours, 0));
      const billableHours = billablesDocs[monthKey]?.sheetTotals.totalBillableHours || 0;
      opsDocs[monthKey] = {
        month: monthNameOf(monthKey),
        year: yearOf(monthKey),
        entries: rows,
        // ops sheetTotals.totalHours carries the combined billable+ops total
        // (see utils/sheetTotalsValidation.mjs cross-collection check).
        sheetTotals: { opsHours, totalHours: round2(billableHours + opsHours) },
      };
    }

    return {
      id: def.name, // users/{docId} = display name
      doc: {
        name: def.name,
        email: def.email,
        role: def.role,
        employmentType: 'FTE',
        active: true,
        rates: [{ rate: clientRate, takeHomeRate, month: 'January', year: 2026 }],
        targets: TARGET_MONTHS.map((mk) => ({
          month: monthNameOf(mk),
          year: yearOf(mk),
          ...TARGETS,
          earnings: TARGETS.billableHours * takeHomeRate,
        })),
      },
      billablesDocs,
      opsDocs,
      rank: def.rank,
      clientRate,
      takeHomeRate,
    };
  });
}

const USERS = buildUsers();

// ---------------------------------------------------------------------------
// Clients + invoices — engineered so utils/paymentStatus.mjs (as of E2E_TODAY)
// yields one canonical client per tag:
//   Acme Corp          -> On Target (2 paid invoices, 10d/12d, none open)
//   Bluebird Labs      -> Warning   (1 open invoice, sent 7/1, not yet overdue)
//   Cobalt Industries  -> Hold      (unpaid invoice sent 5/1, 45d past terms 30)
// ---------------------------------------------------------------------------
const CLIENTS = [
  { clientName: 'Acme Corp', paymentTerms: 15, clientType: 'Startup', channel: 'Referral' },
  { clientName: 'Bluebird Labs', paymentTerms: 30, clientType: 'Startup', channel: 'Outbound' },
  { clientName: 'Cobalt Industries', paymentTerms: 30, clientType: 'Enterprise', channel: 'Referral' },
  { clientName: 'Delta Ventures', paymentTerms: 15, clientType: 'Fund', channel: 'Network' },
  { clientName: 'Evergreen Partners', paymentTerms: 30, clientType: 'Enterprise', channel: 'Referral' },
  { clientName: 'Foxglove LLC', paymentTerms: 15, clientType: 'Startup', channel: 'Inbound' },
].map((c, i) => ({
  status: 'Active',
  contactEmail: `${c.clientName.split(' ')[0].toLowerCase()}@example.com`,
  website: '',
  elDate: '1/15/2026',
  notes: '',
  clientContact: 'Test Contact',
  billingContact: 'Test Billing',
  billingContactEmail: `billing${i}@example.com`,
  phoneNumber: '',
  location: 'CA',
  diverseFounder: false,
  ...c,
}));

const INVOICES = [
  // Acme Corp — On Target: avg 11d, 100% within 15d, zero outstanding.
  { client: 'Acme Corp', amount: 3300, year: 2026, dateSent: '5/1/2026', status: 'Paid', dateReceived: '5/11/2026' },
  { client: 'Acme Corp', amount: 3080, year: 2026, dateSent: '6/1/2026', status: 'Paid', dateReceived: '6/13/2026' },
  // Bluebird Labs — Warning: 1 outstanding (sent 7/1, terms 30 -> not overdue
  // at E2E_TODAY), so it fails On Target's zero-outstanding bar without Hold.
  { client: 'Bluebird Labs', amount: 1100, year: 2026, dateSent: '6/1/2026', status: 'Paid', dateReceived: '6/10/2026' },
  { client: 'Bluebird Labs', amount: 1320, year: 2026, dateSent: '7/1/2026', status: 'Not Paid' },
  // Cobalt Industries — Hold: unpaid since 5/1 -> 75d out, 45d past terms 30 (>= 30).
  { client: 'Cobalt Industries', amount: 900, year: 2026, dateSent: '4/1/2026', status: 'Paid', dateReceived: '4/20/2026' },
  { client: 'Cobalt Industries', amount: 1320, year: 2026, dateSent: '5/1/2026', status: 'Not Paid' },
  // Evergreen Partners — On Target (single 10d payment, none open).
  { client: 'Evergreen Partners', amount: 1040, year: 2026, dateSent: '6/5/2026', status: 'Paid', dateReceived: '6/15/2026' },
  // Foxglove LLC — Warning (fresh open invoice, 5 days out, terms 15).
  { client: 'Foxglove LLC', amount: 650, year: 2026, dateSent: '7/10/2026', status: 'Not Paid' },
  // Delta Ventures intentionally has NO invoices -> On Target by default.
].map((inv, i) => ({ lastReminder: '', dateReceived: '', notes: '', sheetRowNumber: i + 2, ...inv }));

const MONTHLY_METRICS = [
  { month: 'April', year: 2026, revenueAccrued: 18000, attorneyBillables: 5200, firmProfit: 8000, syncedAt: E2E_TODAY },
  { month: 'May', year: 2026, revenueAccrued: 20000, attorneyBillables: 5900, firmProfit: 9000, syncedAt: E2E_TODAY },
  { month: 'June', year: 2026, revenueAccrued: 22000, attorneyBillables: 6780, firmProfit: 10000, syncedAt: E2E_TODAY },
];

// ---------------------------------------------------------------------------
// SEED — everything scripts/seed-e2e-data.mjs writes, ready-shaped.
// ---------------------------------------------------------------------------
export const SEED = {
  users: USERS,
  clients: CLIENTS,
  invoices: INVOICES,
  monthlyMetrics: MONTHLY_METRICS,
  rateCard: {
    levels: RATE_CARD_LEVELS,
    notes: 'Deterministic E2E ladder (clientRate = 150 + 25*rank)',
    source: 'scripts/seed-e2e-data.mjs',
    year: 2026,
    lastSyncedAt: E2E_TODAY,
  },
  // Empty synced doc = "no firm holidays / no OOO" is the source of truth,
  // keeping target pro-rating math clean for the seeded months.
  timeOff: { holidays: [], outOfOffice: [], lastSyncedAt: E2E_TODAY, source: 'scripts/seed-e2e-data.mjs' },
  adminEmails: [ADMIN_EMAIL],
  permissions: { [PARTIAL_EMAIL]: PERSONAS.partial.permissions },
};

// ---------------------------------------------------------------------------
// EXPECTED — precomputed values for spec assertions, derived from the same
// entry definitions the seed writes (never hand-maintained).
// ---------------------------------------------------------------------------
function buildExpected() {
  const attorneys = {};
  const overviewTotals = { billableHours: 0, billableEarnings: 0, opsHours: 0, adjustments: 0 };
  const currentMonth = { billableHours: 0, billableEarnings: 0, opsHours: 0, adjustments: 0 };
  const CURRENT_KEY = '2026-07';

  for (const u of USERS) {
    const months = {};
    const totals = { billableHours: 0, billableEarnings: 0, opsHours: 0, adjustments: 0 };
    const monthKeys = new Set([...Object.keys(u.billablesDocs), ...Object.keys(u.opsDocs)]);
    for (const mk of monthKeys) {
      const b = u.billablesDocs[mk]?.entries || [];
      const o = u.opsDocs[mk]?.entries || [];
      const m = {
        billableHours: round2(b.reduce((s, e) => s + e.hours, 0)),
        billableEarnings: round2(b.reduce((s, e) => s + e.earnings, 0)),
        opsHours: round2(o.reduce((s, e) => s + e.hours, 0)),
        adjustments: round2(b.reduce((s, e) => s + e.adjustment, 0)),
      };
      months[mk] = m;
      totals.billableHours = round2(totals.billableHours + m.billableHours);
      totals.billableEarnings = round2(totals.billableEarnings + m.billableEarnings);
      totals.opsHours = round2(totals.opsHours + m.opsHours);
      totals.adjustments = round2(totals.adjustments + m.adjustments);
      if (mk === CURRENT_KEY) {
        currentMonth.billableHours = round2(currentMonth.billableHours + m.billableHours);
        currentMonth.billableEarnings = round2(currentMonth.billableEarnings + m.billableEarnings);
        currentMonth.opsHours = round2(currentMonth.opsHours + m.opsHours);
        currentMonth.adjustments = round2(currentMonth.adjustments + m.adjustments);
      }
    }
    overviewTotals.billableHours = round2(overviewTotals.billableHours + totals.billableHours);
    overviewTotals.billableEarnings = round2(overviewTotals.billableEarnings + totals.billableEarnings);
    overviewTotals.opsHours = round2(overviewTotals.opsHours + totals.opsHours);
    overviewTotals.adjustments = round2(overviewTotals.adjustments + totals.adjustments);

    attorneys[u.id] = {
      email: u.doc.email,
      role: u.doc.role,
      rank: u.rank,
      clientRate: u.clientRate,
      takeHomeRate: u.takeHomeRate,
      months,
      totals,
    };
  }

  return {
    // Attorney display names double as users/{docId} and /attorneys/[name] slugs.
    attorneys,
    overview: {
      // All-time across the three seeded attorneys (May-July 2026).
      totals: overviewTotals,
      // July 2026 (the E2E_TODAY month) — requires the pinned browser clock.
      currentMonth,
    },
    // One canonical client per calculated payment-status tag (as of E2E_TODAY).
    paymentStatus: {
      onTarget: 'Acme Corp',
      warning: 'Bluebird Labs',
      hold: 'Cobalt Industries',
    },
    targets: TARGETS,
    clientCount: CLIENTS.length,
    invoiceCount: INVOICES.length,
    monthlyMetrics: MONTHLY_METRICS,
    seededMonths: TARGET_MONTHS,
  };
}

export const EXPECTED = buildExpected();
