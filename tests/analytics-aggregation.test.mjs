import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  entryBillableHours,
  entryOpsHours,
  buildUserActivity,
  computeProRatedTargets,
  buildAttorneyStats,
  selectVisibleAttorneys,
  buildAttorneyTotalsIncludingHidden,
  calculateUtilization,
  computeGrossBillables,
  computeFirmTotals,
} from '../src/utils/analyticsAggregation.mjs';

// ---------------------------------------------------------------------------
// Synthetic 2-attorney dataset. Firestore-style {seconds} timestamps pin the
// PST calendar day regardless of the machine timezone (20:00 UTC = noon PST/PDT).
// ---------------------------------------------------------------------------
const pstNoon = (y, m, d) => ({ seconds: Date.UTC(y, m - 1, d, 20) / 1000 });

const ALICE = 'Alice Example';
const BOB = 'Bob Example';
const USER_NAMES = { u1: ALICE, u2: BOB };
const getUserName = (entry) => USER_NAMES[entry.userId] || entry.userId;

const RATES = { [ALICE]: 100, [BOB]: 200 };
const getRate = (userName) => RATES[userName] || 0;

const billableEntries = [
  { userId: 'u1', date: pstNoon(2026, 5, 5), billableHours: 3, earnings: 300, billingCategory: 'M&A', client: 'Acme' },
  { userId: 'u1', date: pstNoon(2026, 5, 6), billableHours: 2, earnings: 200, adjustment: 50, billingCategory: 'Adjustment', client: 'Beta' },
  { userId: 'u2', date: pstNoon(2026, 6, 10), billableHours: 4, earnings: 400, client: 'Acme' },
  // Legacy shape: raw sheet `hours` only (the fetch layer normally normalizes
  // this to billableHours; the aggregation applies the same fallback).
  { userId: 'u2', date: pstNoon(2026, 6, 11), hours: '5', earnings: 100, billingCategory: 'Formation', client: 'Gamma' },
];

const opsEntries = [
  { userId: 'u1', date: pstNoon(2026, 5, 7), opsHours: 1.5 },
  // Legacy shape for ops: raw `hours` → opsHours.
  { userId: 'u2', date: pstNoon(2026, 6, 12), hours: 2 },
];

test('entryBillableHours/entryOpsHours: normalized field wins, legacy hours falls back', () => {
  assert.equal(entryBillableHours({ billableHours: 2.5 }), 2.5);
  assert.equal(entryBillableHours({ hours: '3.5' }), 3.5);
  assert.equal(entryBillableHours({}), 0);
  // A normalized zero stays zero (parity with the hook's `billableHours || 0`).
  assert.equal(entryBillableHours({ billableHours: 0, hours: '4' }), 0);
  assert.equal(entryOpsHours({ opsHours: 1 }), 1);
  assert.equal(entryOpsHours({ hours: '2' }), 2);
  assert.equal(entryOpsHours({ hours: 'N/A' }), 0);
});

test('buildUserActivity: per-attorney billable/ops/earnings totals', () => {
  const activity = buildUserActivity({ billableEntries, opsEntries, getUserName, getRate });

  const alice = activity[ALICE];
  assert.equal(alice.billable, 5);
  assert.equal(alice.ops, 1.5);
  assert.equal(alice.earnings, 500);
  assert.equal(alice.adjustment, 50);
  assert.equal(alice.hasAdjustment, true);
  assert.deepEqual([...alice.months].sort(), ['2026-05']);
  assert.deepEqual(alice.clients, { Acme: 3, Beta: 2 });
  // Adjustment categories are excluded from the transactions breakdown.
  assert.deepEqual(alice.transactions, { 'M&A': 3 });

  const bob = activity[BOB];
  assert.equal(bob.billable, 9); // 4 + legacy-normalized 5
  assert.equal(bob.ops, 2);      // legacy-normalized ops hours
  assert.equal(bob.earnings, 500);
  assert.equal(bob.adjustment, 0);
  assert.equal(!!bob.hasAdjustment, false);
  assert.deepEqual([...bob.months].sort(), ['2026-06']);
  // Missing billingCategory defaults to 'Other'.
  assert.deepEqual(bob.transactions, { Other: 4, Formation: 5 });
  assert.deepEqual(bob.clients, { Acme: 4, Gamma: 5 });
});

test('buildUserActivity: gross billables = rate x hours per entry', () => {
  const activity = buildUserActivity({ billableEntries, opsEntries, getUserName, getRate });
  assert.equal(activity[ALICE].grossBillables, 5 * 100);
  assert.equal(activity[BOB].grossBillables, 9 * 200);
});

test('buildUserActivity: seeded names appear with zero records', () => {
  const activity = buildUserActivity({
    billableEntries: [],
    opsEntries: [],
    getUserName,
    getRate,
    seedNames: [ALICE],
  });
  assert.deepEqual(activity[ALICE].transactions, {});
  assert.equal(activity[ALICE].billable, 0);
  assert.equal(activity[ALICE].ops, 0);
  assert.equal(activity[ALICE].months.size, 0);
});

test('computeProRatedTargets: applies the given fraction per month', () => {
  const targets = computeProRatedTargets({
    dataMonths: new Set(),
    rangeMonths: ['2026-05', '2026-06'],
    monthTargets: { '2026-05': { billableHours: 80, opsHours: 40, totalHours: 120 } },
    defaultTarget: { billableHours: 100, opsHours: 50, totalHours: 150 },
    getMonthProRate: (monthKey) =>
      monthKey === '2026-05'
        ? { fraction: 1, oooDays: 0, holidayDays: 0 }
        : { fraction: 0.5, oooDays: 2, holidayDays: 1 },
  });
  // May: stored target at fraction 1; June: defaults at fraction 0.5.
  assert.equal(targets.billableTarget, 80 + 50);
  assert.equal(targets.opsTarget, 40 + 25);
  assert.equal(targets.target, 120 + 75);
  assert.equal(targets.oooDays, 2);
  assert.equal(targets.holidayDays, 1);
});

test('computeProRatedTargets: falls back to data months, then flat defaults', () => {
  const defaultTarget = { billableHours: 100, opsHours: 50, totalHours: 150 };
  const half = () => ({ fraction: 0.5, oooDays: 0, holidayDays: 0 });

  // No range months → the attorney's own active months are used.
  const fromData = computeProRatedTargets({
    dataMonths: new Set(['2026-05']),
    rangeMonths: [],
    monthTargets: {},
    defaultTarget,
    getMonthProRate: half,
  });
  assert.equal(fromData.target, 75);

  // No months at all → un-pro-rated defaults for one month.
  const fromDefaults = computeProRatedTargets({
    dataMonths: new Set(),
    rangeMonths: [],
    monthTargets: {},
    defaultTarget,
    getMonthProRate: half,
  });
  assert.deepEqual(fromDefaults, {
    target: 150, billableTarget: 100, opsTarget: 50, oooDays: 0, holidayDays: 0,
  });
});

test('computeProRatedTargets: fully-OOO period (fraction 0) yields target 0', () => {
  const targets = computeProRatedTargets({
    dataMonths: new Set(),
    rangeMonths: ['2026-05'],
    monthTargets: {},
    defaultTarget: { billableHours: 100, opsHours: 50, totalHours: 150 },
    getMonthProRate: () => ({ fraction: 0, oooDays: 21, holidayDays: 0 }),
  });
  assert.equal(targets.target, 0);
  // …which utilization then reports as null (→ "N/A"), not 0%.
  assert.equal(calculateUtilization({ billable: 0, ops: 0, target: targets.target }), null);
});

test('buildAttorneyStats: assembles stats with targets, role, and topTransactions', () => {
  const activity = buildUserActivity({ billableEntries, opsEntries, getUserName, getRate });
  const stats = buildAttorneyStats({
    activity,
    rangeMonths: ['2026-05', '2026-06'],
    userTargets: { [ALICE]: { '2026-05': { billableHours: 80, opsHours: 40, totalHours: 120 } } },
    getDefaultTarget: () => ({ billableHours: 100, opsHours: 50, totalHours: 150 }),
    getMonthProRateFor: () => () => ({ fraction: 1, oooDays: 0, holidayDays: 0 }),
    getUserRole: (name) => (name === ALICE ? 'Partner' : 'Attorney'),
    getEmploymentType: (name) => (name === BOB ? 'PTE' : 'FTE'),
  });

  const alice = stats.find((s) => s.name === ALICE);
  assert.equal(alice.billable, 5);
  assert.equal(alice.grossBillables, 500);
  assert.equal(alice.billableTarget, 80 + 100); // stored May + default June
  assert.equal(alice.target, 120 + 150);
  assert.equal(alice.role, 'Partner');
  assert.equal(alice.employmentType, 'FTE');
  assert.deepEqual(alice.topTransactions, ['M&A']);

  const bob = stats.find((s) => s.name === BOB);
  assert.equal(bob.employmentType, 'PTE');
  assert.deepEqual(bob.topTransactions, ['Formation', 'Other']); // sorted by hours desc
});

test('calculateUtilization: percentage of target, null when target is 0/absent', () => {
  assert.equal(calculateUtilization({ billable: 50, ops: 25, target: 100 }), 75);
  assert.equal(calculateUtilization({ billable: 100, ops: 55, target: 150 }), 103);
  assert.equal(calculateUtilization({ billable: 10, ops: 0, target: 0 }), null);
  assert.equal(calculateUtilization({ billable: 10, ops: 0 }), null);
});

test('selectVisibleAttorneys: hidden attorney excluded from display when range predates hideBefore', () => {
  // 'Martyna Skrodzka' has hideBefore 2026-01-01 in hiddenAttorneys.mjs — a
  // range entirely inside 2025 must not display her.
  const attorneys = [
    { name: ALICE },
    { name: BOB },
    { name: 'Martyna Skrodzka' },
  ];
  const visible = selectVisibleAttorneys(attorneys, {
    startDate: new Date(2025, 0, 1),
    endDate: new Date(2025, 11, 31, 23, 59, 59, 999),
  });
  assert.deepEqual(visible.map((a) => a.name).sort(), [ALICE, BOB]);

  // A 2026 range overlaps her configured window → displayed.
  const visible2026 = selectVisibleAttorneys(attorneys, {
    startDate: new Date(2026, 0, 1),
    endDate: new Date(2026, 11, 31, 23, 59, 59, 999),
  });
  assert.ok(visible2026.some((a) => a.name === 'Martyna Skrodzka'));
});

test('selectVisibleAttorneys: inactive / not-yet-joined only show when data overlaps the range', () => {
  const attorneys = [{ name: ALICE }, { name: BOB }];
  const range = { startDate: new Date(2026, 4, 1), endDate: new Date(2026, 5, 30) };

  const withoutData = selectVisibleAttorneys(attorneys, {
    ...range,
    inactiveNames: new Set([ALICE]),
    notYetJoinedNames: new Set([BOB]),
  });
  assert.deepEqual(withoutData, []);

  const withData = selectVisibleAttorneys(attorneys, {
    ...range,
    inactiveNames: new Set([ALICE]),
    notYetJoinedNames: new Set([BOB]),
    namesWithData: new Set([ALICE, BOB]),
  });
  assert.deepEqual(withData.map((a) => a.name).sort(), [ALICE, BOB]);
});

test('buildAttorneyTotalsIncludingHidden: hidden attorneys still count in aggregates', () => {
  // Same dataset plus entries from a hidden attorney (u3 → Martyna Skrodzka).
  const withHidden = [
    ...billableEntries,
    { userId: 'u3', date: pstNoon(2026, 5, 8), billableHours: 7, earnings: 700 },
  ];
  const names = { ...USER_NAMES, u3: 'Martyna Skrodzka' };
  const totals = buildAttorneyTotalsIncludingHidden({
    billableEntries: withHidden,
    opsEntries,
    getUserName: (entry) => names[entry.userId] || entry.userId,
    getDefaultTarget: () => ({ billableHours: 100, opsHours: 50, totalHours: 150 }),
  });

  const hidden = totals.find((t) => t.name === 'Martyna Skrodzka');
  assert.equal(hidden.billable, 7);
  assert.equal(hidden.earnings, 700);
  // This dataset carries flat current-month default targets (never pro-rated).
  assert.equal(hidden.target, 150);
  assert.equal(hidden.billableTarget, 100);

  const totalBillable = totals.reduce((acc, t) => acc + t.billable, 0);
  assert.equal(totalBillable, 5 + 9 + 7); // hidden hours included
  const bob = totals.find((t) => t.name === BOB);
  assert.equal(bob.billable, 9); // legacy `hours` entry normalized in
  assert.equal(bob.ops, 2);
});

test('computeGrossBillables: totals rate x hours and caches rate lookups per user-month', () => {
  let calls = 0;
  const getRateInfo = (userName) => {
    calls += 1;
    return userName === ALICE ? { rate: 100, found: true } : { rate: 0, found: false };
  };

  const { totalGrossBillables, missingRateWarnings } = computeGrossBillables({
    billableEntries: [
      ...billableEntries,
      { userId: 'u1', date: pstNoon(2026, 5, 9), billableHours: 0 }, // zero-hour: skipped
    ],
    getUserName,
    getRateInfo,
  });

  assert.equal(totalGrossBillables, 5 * 100 + 9 * 0);
  // One lookup per (user, month): Alice May + Bob June — the zero-hour and
  // repeat same-month entries never re-query.
  assert.equal(calls, 2);
  assert.deepEqual(missingRateWarnings, [
    { userName: BOB, monthKeys: ['2026-06'], hours: 9 },
  ]);
});

test('computeGrossBillables: no warnings when all rates resolve', () => {
  const { totalGrossBillables, missingRateWarnings } = computeGrossBillables({
    billableEntries,
    getUserName,
    getRateInfo: (userName) => ({ rate: RATES[userName], found: true }),
  });
  assert.equal(totalGrossBillables, 5 * 100 + 9 * 200);
  assert.deepEqual(missingRateWarnings, []);
});

test('computeFirmTotals: hours from including-hidden set, targets/utilization from visible set', () => {
  const visibleAttorneys = [
    { name: 'A', billable: 50, ops: 25, earnings: 100, billableTarget: 100, opsTarget: 50, target: 150, employmentType: 'FTE' }, // 50%
    { name: 'B', billable: 90, ops: 30, earnings: 200, billableTarget: 80, opsTarget: 40, target: 120, employmentType: 'PTE' },  // 100%
    { name: 'C', billable: 0, ops: 0, earnings: 0, billableTarget: 0, opsTarget: 0, target: 0, employmentType: 'FTE' },          // N/A (fully OOO)
  ];
  const attorneysIncludingHidden = [
    ...visibleAttorneys,
    { name: 'Hidden', billable: 10, ops: 5, earnings: 500 },
  ];

  const totals = computeFirmTotals({ visibleAttorneys, attorneysIncludingHidden });
  assert.equal(totals.totalBillable, 150); // hidden hours included
  assert.equal(totals.totalOps, 60);
  assert.equal(totals.totalEarnings, 800);
  assert.equal(totals.totalBillableTarget, 180); // visible only
  assert.equal(totals.totalOpsTarget, 90);
  // N/A utilization (attorney C) is skipped, not averaged in as 0.
  assert.equal(totals.avgUtilization, 75);
  assert.equal(totals.avgUtilizationFTE, 50);
  assert.equal(totals.avgUtilizationPTE, 100);
  assert.equal(totals.attorneyCountFTE, 2);
  assert.equal(totals.attorneyCountPTE, 1);
  assert.equal(totals.attorneyCountTotal, 3);
});
