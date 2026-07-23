import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_RANK,
  isColin,
  partnerSharePct,
  takeHomeField,
  monthKey,
  findLatestRate,
  findRankForRate,
  predictedRankForMonth,
  predictedAnnualFirmProfit,
  sumProjectedTotals,
  buildProjectedEarningsRows,
} from '../src/utils/projectedEarnings.mjs';

// Fixtures -----------------------------------------------------------------

// Synthetic 20-level rate card mirroring the real rateCard/all shape:
// clientRate 100..290, attorneyRate 50..145, colinRate null below rank 13.
const levels = Array.from({ length: 20 }, (_, rank) => ({
  rank,
  level: `L${rank}`,
  tier: rank % 2 === 0 ? 'A' : 'B',
  clientRate: 100 + rank * 10,
  attorneyRate: 50 + rank * 5,
  colinRate: rank >= 13 ? 200 + rank : null,
}));
const rateCard = { levels };

const clientRateOf = (rank) => levels[rank].clientRate;
const attorneyRateOf = (rank) => levels[rank].attorneyRate;
const colinRateOf = (rank) => levels[rank].colinRate;

// Surnames deliberately NOT on the firm seniority roster (so ordering /
// hidden-attorney config never interferes with these synthetic fixtures).
const makeUser = (id, name, extra = {}) => ({ id, name, role: 'Attorney', active: true, ...extra });

const fullYearTargets = (year, billableHours) => {
  const byMonth = {};
  for (let m = 1; m <= 12; m += 1) byMonth[monthKey(year, m)] = { billableHours };
  return byMonth;
};

// Entries carry a plain Date; the injected extractor just returns it (the real
// component injects dateHelpers.getEntryDate, which is browser/Firestore-aware).
const entryDate = (e) => e.date;

const run = (overrides = {}) =>
  buildProjectedEarningsRows({
    users: [],
    allBillableEntries: [],
    allRates: {},
    allTargets: {},
    rateCard,
    monthlyMetrics: [],
    promoteOverrides: {},
    today: new Date(2026, 0, 1), // Jan 1, 2026
    entryDate,
    ...overrides,
  });

// Small unit helpers -------------------------------------------------------

test('takeHomeField: colinRate for Colin, attorneyRate otherwise', () => {
  assert.equal(takeHomeField('Colin Van Loon'), 'colinRate');
  assert.equal(takeHomeField('colin  van  loon'), 'colinRate');
  assert.equal(takeHomeField('Sam McClure'), 'attorneyRate');
  assert.equal(takeHomeField(undefined), 'attorneyRate');
  assert.equal(isColin('Colin Van Loon'), true);
  assert.equal(isColin('Sam McClure'), false);
});

test('partnerSharePct: McClure 95%, Van Loon 5%, everyone else 0', () => {
  assert.equal(partnerSharePct('Sam McClure'), 0.95);
  assert.equal(partnerSharePct('Colin Van Loon'), 0.05);
  assert.equal(partnerSharePct('Avery Testerly'), 0);
  assert.equal(partnerSharePct(null), 0);
});

test('monthKey zero-pads the month', () => {
  assert.equal(monthKey(2026, 3), '2026-03');
  assert.equal(monthKey(2026, 11), '2026-11');
});

test('findLatestRate picks the highest month key', () => {
  assert.deepEqual(
    findLatestRate({ '2025-06': { rate: 200 }, '2026-02': { rate: 260 }, '2026-01': { rate: 250 } }),
    { rate: 260, monthKey: '2026-02' }
  );
  assert.equal(findLatestRate(null), null);
  assert.equal(findLatestRate({}), null);
});

test('findRankForRate exact-matches by field, -1 otherwise', () => {
  assert.equal(findRankForRate(levels, 100, 'clientRate'), 0);
  assert.equal(findRankForRate(levels, 290, 'clientRate'), 19);
  assert.equal(findRankForRate(levels, 999, 'clientRate'), -1);
  assert.equal(findRankForRate(levels, 0, 'clientRate'), -1);
  assert.equal(findRankForRate(null, 100, 'clientRate'), -1);
});

// Rank progression ---------------------------------------------------------

test('predictedRankForMonth: Q2 and Q4 bumps from a January start', () => {
  for (let m = 1; m <= 3; m += 1) assert.equal(predictedRankForMonth(5, 1, m), 5);
  for (let m = 4; m <= 9; m += 1) assert.equal(predictedRankForMonth(5, 1, m), 6);
  for (let m = 10; m <= 12; m += 1) assert.equal(predictedRankForMonth(5, 1, m), 7);
});

test('predictedRankForMonth: mid-year start only gets the remaining boundary', () => {
  // From July, the Apr 1 boundary has passed (assumed already in the stored
  // rate), so only the Oct 1 bump applies.
  for (let m = 7; m <= 9; m += 1) assert.equal(predictedRankForMonth(5, 7, m), 5);
  for (let m = 10; m <= 12; m += 1) assert.equal(predictedRankForMonth(5, 7, m), 6);
  // From November, no boundaries remain.
  assert.equal(predictedRankForMonth(5, 11, 12), 5);
});

test('predictedRankForMonth caps at MAX_RANK (19)', () => {
  assert.equal(MAX_RANK, 19);
  assert.equal(predictedRankForMonth(19, 1, 12), 19); // 19 + 2 → capped
  assert.equal(predictedRankForMonth(18, 1, 12), 19); // 18 + 2 → capped
  assert.equal(predictedRankForMonth(18, 1, 4), 19);  // single bump lands on cap
});

// Rank match / no-match ----------------------------------------------------

test('rank match: latest CLIENT rate exact-matches a level', () => {
  const [row] = run({
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(3) } } },
    allTargets: { 'Avery Testerly': fullYearTargets(2026, 10) },
  });
  assert.equal(row.hasRankMatch, true);
  assert.equal(row.canPromote, true);
  assert.equal(row.currentRate, clientRateOf(3));
  assert.equal(row.startLevelLabel, 'L3/B');
  assert.equal(row.endLevelLabel, 'L5/B'); // Jan start → +2 bumps by Dec
});

test('no rank match: unmatched rate projects $0 with the badge state', () => {
  const [row] = run({
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: 987 } } },
    allTargets: { 'Avery Testerly': fullYearTargets(2026, 10) },
  });
  assert.equal(row.hasRankMatch, false);
  assert.equal(row.canPromote, false);
  assert.equal(row.projectedEarnings, 0);
  // Hours are still projected — only the payout rate is unknowable.
  assert.equal(row.projectedHours, 120);
  assert.equal(row.startLevelLabel, '—');
  assert.equal(row.endLevelLabel, '—');
  assert.equal(row.totalProjectedEarnings, 0);
});

// Q2/Q4 bumps across a projection year --------------------------------------

test('full-year projection applies Q2 and Q4 bumps at the right months', () => {
  const [row] = run({
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } } },
    allTargets: { 'Avery Testerly': fullYearTargets(2026, 10) },
  });
  // Jan–Mar at rank 0 ($50), Apr–Sep at rank 1 ($55), Oct–Dec at rank 2 ($60).
  const expected = 3 * 10 * attorneyRateOf(0) + 6 * 10 * attorneyRateOf(1) + 3 * 10 * attorneyRateOf(2);
  assert.equal(row.projectedEarnings, expected); // 6600
  assert.equal(row.projectedHours, 120);
  assert.equal(row.endLevelLabel, 'L2/A');
});

test('cap at 19: rank never exceeds the top of the ladder', () => {
  const rows = run({
    users: [makeUser('u1', 'Avery Testerly'), makeUser('u2', 'Blake Zornow')],
    allRates: {
      'Avery Testerly': { '2026-01': { rate: clientRateOf(19) } },
      'Blake Zornow': { '2026-01': { rate: clientRateOf(18) } },
    },
    allTargets: {
      'Avery Testerly': fullYearTargets(2026, 10),
      'Blake Zornow': fullYearTargets(2026, 10),
    },
  });
  const top = rows.find((r) => r.name === 'Avery Testerly');
  const nearTop = rows.find((r) => r.name === 'Blake Zornow');
  // Already at 19: both bumps are no-ops.
  assert.equal(top.projectedEarnings, 12 * 10 * attorneyRateOf(19));
  assert.equal(top.endLevelLabel, 'L19/B');
  // From 18: Apr bump reaches 19, Oct bump is capped there.
  assert.equal(
    nearTop.projectedEarnings,
    3 * 10 * attorneyRateOf(18) + 9 * 10 * attorneyRateOf(19)
  );
  assert.equal(nearTop.endLevelLabel, 'L19/B');
});

// Colin's bespoke column -----------------------------------------------------

test('colinRate pays out when non-null, falls back to attorneyRate below rank 13', () => {
  const [row] = run({
    users: [makeUser('cvl', 'Colin Van Loon')],
    allRates: { 'Colin Van Loon': { '2026-01': { rate: clientRateOf(12) } } },
    allTargets: { 'Colin Van Loon': fullYearTargets(2026, 10) },
  });
  assert.equal(row.isColin, true);
  // Jan–Mar rank 12: colinRate null → attorneyRate fallback.
  // Apr–Sep rank 13 and Oct–Dec rank 14: colinRate applies.
  const expected =
    3 * 10 * attorneyRateOf(12) + 6 * 10 * colinRateOf(13) + 3 * 10 * colinRateOf(14);
  assert.equal(row.projectedEarnings, expected);
});

// PTE ------------------------------------------------------------------------

test('PTE: stored rate held flat all year, no rate-card match needed', () => {
  const [row] = run({
    users: [makeUser('p1', 'Casey Quibble', { employmentType: 'PTE' })],
    // 275 is NOT on the rate card — irrelevant for PTE.
    allRates: { 'Casey Quibble': { '2026-01': { rate: 275 } } },
    allTargets: { 'Casey Quibble': fullYearTargets(2026, 10) },
  });
  assert.equal(row.isPte, true);
  assert.equal(row.hasRankMatch, true); // "No rank match" never applies to PTE
  assert.equal(row.canPromote, false);
  assert.equal(row.startLevelLabel, '—');
  assert.equal(row.projectedEarnings, 120 * 275); // flat, no bumps
});

test('PTE: promote toggle has no effect either way', () => {
  const base = {
    users: [makeUser('p1', 'Casey Quibble', { employmentType: 'PTE' })],
    allRates: { 'Casey Quibble': { '2026-01': { rate: 275 } } },
    allTargets: { 'Casey Quibble': fullYearTargets(2026, 10) },
  };
  const [on] = run({ ...base, promoteOverrides: {} });
  const [off] = run({ ...base, promoteOverrides: { p1: false } });
  assert.equal(on.promoted, true);
  assert.equal(off.promoted, false);
  assert.equal(on.projectedEarnings, off.projectedEarnings);
  assert.equal(on.projectedHours, off.projectedHours);
});

test('FTE promote toggle: off holds the start rank for the whole projection', () => {
  const base = {
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } } },
    allTargets: { 'Avery Testerly': fullYearTargets(2026, 10) },
  };
  const [on] = run(base);
  const [off] = run({ ...base, promoteOverrides: { u1: false } });
  assert.equal(on.promoted, true);
  assert.equal(off.promoted, false);
  assert.equal(off.projectedEarnings, 12 * 10 * attorneyRateOf(0)); // 6000, no bumps
  assert.equal(off.endLevelLabel, off.startLevelLabel);
  assert.ok(on.projectedEarnings > off.projectedEarnings);
});

// Profit share ---------------------------------------------------------------

test('predictedAnnualFirmProfit: 0 / 1 / several completed months', () => {
  // No synced months → 0.
  assert.equal(predictedAnnualFirmProfit([], 2026, 7), 0);
  assert.equal(predictedAnnualFirmProfit(null, 2026, 7), 0);
  // One completed month → that value × 12.
  assert.equal(
    predictedAnnualFirmProfit([{ month: 'January', year: 2026, firmProfit: 1200 }], 2026, 7),
    14400
  );
  // Several completed months → average × 12.
  assert.equal(
    predictedAnnualFirmProfit(
      [
        { month: 'January', year: 2026, firmProfit: 1000 },
        { month: 'February', year: 2026, firmProfit: 2000 },
        { month: 'March', year: 2026, firmProfit: 3000 },
      ],
      2026,
      7
    ),
    24000
  );
});

test('predictedAnnualFirmProfit ignores current/future months, other years, and missing values', () => {
  const metrics = [
    { month: 'June', year: 2026, firmProfit: 1000 },  // completed (June < July)
    { month: 'July', year: 2026, firmProfit: 99999 }, // current month — not completed
    { month: 'January', year: 2025, firmProfit: 500 },// wrong year
    { month: 'May', year: 2026 },                     // firmProfit absent
    { month: 'April', year: 2026, firmProfit: NaN },  // non-finite
  ];
  assert.equal(predictedAnnualFirmProfit(metrics, 2026, 7), 12000);
});

test('partners receive their profit share, folded into the total', () => {
  const rows = run({
    today: new Date(2026, 6, 1), // Jul 1, 2026
    users: [
      makeUser('sam', 'Sam McClure'),
      makeUser('cvl', 'Colin Van Loon'),
      makeUser('u1', 'Avery Testerly'),
    ],
    allRates: {
      'Sam McClure': { '2026-01': { rate: clientRateOf(19) } },
      'Colin Van Loon': { '2026-01': { rate: clientRateOf(19) } },
      'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } },
    },
    monthlyMetrics: [
      { month: 'January', year: 2026, firmProfit: 1000 },
      { month: 'February', year: 2026, firmProfit: 2000 },
    ], // avg 1500 × 12 = 18000
  });
  const sam = rows.find((r) => r.name === 'Sam McClure');
  const colin = rows.find((r) => r.name === 'Colin Van Loon');
  const other = rows.find((r) => r.name === 'Avery Testerly');
  assert.equal(sam.isPartner, true);
  assert.equal(sam.profitShare, 18000 * 0.95);
  assert.equal(colin.profitShare, 18000 * 0.05);
  assert.equal(other.isPartner, false);
  assert.equal(other.profitShare, 0);
  // No targets → labor projection 0, so total is exactly the profit share.
  assert.equal(sam.totalProjectedEarnings, 17100);
  assert.equal(colin.totalProjectedEarnings, 900);
});

// Full-year total for one synthetic attorney ---------------------------------

test('full-year total: YTD actuals + partial current month + bumped remainder', () => {
  const today = new Date(2026, 1, 10); // Feb 10, 2026 → currentMonth 2
  const [row] = run({
    today,
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } } },
    allTargets: { 'Avery Testerly': fullYearTargets(2026, 10) },
    allBillableEntries: [
      { userId: 'u1', year: 2026, date: new Date(2026, 0, 12), billableHours: 20, earnings: 2400 },
      { userId: 'u1', year: 2026, date: new Date(2026, 1, 5), billableHours: 4, earnings: 480 },
      // After `today` — excluded from YTD sums and the current-month blend.
      { userId: 'u1', year: 2026, date: new Date(2026, 1, 20), billableHours: 5, earnings: 600 },
      // Prior year — excluded entirely.
      { userId: 'u1', year: 2025, date: new Date(2025, 11, 1), billableHours: 8, earnings: 900 },
      // Someone else's entry — excluded.
      { userId: 'u2', year: 2026, date: new Date(2026, 0, 3), billableHours: 9, earnings: 999 },
    ],
  });
  assert.equal(row.ytdHours, 24);
  assert.equal(row.ytdEarnings, 2880);
  // Feb (partial: 10 − 4 = 6h) + Mar at rank 0, Apr–Sep at rank 1, Oct–Dec at rank 2.
  const projected =
    (6 + 10) * attorneyRateOf(0) + 60 * attorneyRateOf(1) + 30 * attorneyRateOf(2);
  assert.equal(row.projectedHours, 6 + 10 + 60 + 30); // 106
  assert.equal(row.projectedEarnings, projected); // 5900
  assert.equal(row.profitShare, 0);
  assert.equal(row.totalProjectedEarnings, 2880 + projected); // 8780
});

test('current-month actuals at/over target project zero extra hours', () => {
  const [row] = run({
    today: new Date(2026, 0, 20),
    users: [makeUser('u1', 'Avery Testerly')],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } } },
    allTargets: { 'Avery Testerly': { [monthKey(2026, 1)]: { billableHours: 10 } } },
    allBillableEntries: [
      { userId: 'u1', year: 2026, date: new Date(2026, 0, 10), billableHours: 15, earnings: 1800 },
    ],
  });
  assert.equal(row.projectedHours, 0); // max(0, 10 − 15)
  assert.equal(row.projectedEarnings, 0);
  assert.equal(row.totalProjectedEarnings, 1800);
});

// Roster filtering / guards ---------------------------------------------------

test('inactive users and non-attorneys are excluded; guards return []', () => {
  const rows = run({
    users: [
      makeUser('u1', 'Avery Testerly'),
      makeUser('u2', 'Blake Zornow', { active: false }),
      makeUser('u3', 'Dana Opsley', { role: 'Operations' }),
    ],
    allRates: { 'Avery Testerly': { '2026-01': { rate: clientRateOf(0) } } },
  });
  assert.deepEqual(rows.map((r) => r.name), ['Avery Testerly']);

  assert.deepEqual(run({ users: [] }), []);
  assert.deepEqual(run({ users: [makeUser('u1', 'Avery Testerly')], rateCard: null }), []);
  assert.deepEqual(run({ users: [makeUser('u1', 'Avery Testerly')], rateCard: { levels: [] } }), []);
});

// Totals ----------------------------------------------------------------------

test('sumProjectedTotals sums every column across rows', () => {
  const rows = [
    { ytdEarnings: 100, ytdHours: 1, projectedHours: 10, projectedEarnings: 1000, profitShare: 0, totalProjectedEarnings: 1100 },
    { ytdEarnings: 200, ytdHours: 2, projectedHours: 20, projectedEarnings: 2000, profitShare: 50, totalProjectedEarnings: 2250 },
  ];
  assert.deepEqual(sumProjectedTotals(rows), {
    ytdEarnings: 300,
    ytdHours: 3,
    projectedHours: 30,
    projectedEarnings: 3000,
    profitShare: 50,
    totalProjectedEarnings: 3350,
  });
  assert.deepEqual(sumProjectedTotals([]), {
    ytdEarnings: 0,
    ytdHours: 0,
    projectedHours: 0,
    projectedEarnings: 0,
    profitShare: 0,
    totalProjectedEarnings: 0,
  });
});
