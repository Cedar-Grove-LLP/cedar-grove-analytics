import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  filterEntriesByWindow,
  collectActiveMonths,
  computeAttorneyDetailTargets,
  computeAttorneyDetailStats,
  buildClientBreakdown,
  buildMatterBreakdown,
  buildTransactionBreakdown,
  buildOpsBreakdown,
  buildMonthlyTrend,
  selectRecentEntries,
  hasAdjustmentData,
} from '../src/utils/attorneyDetail.mjs';

// Firestore-style {seconds} timestamps pin the PST calendar day regardless of
// the machine timezone (20:00 UTC = noon PST/PDT) — same convention as
// tests/analytics-aggregation.test.mjs.
const pstNoon = (y, m, d) => ({ seconds: Date.UTC(y, m - 1, d, 20) / 1000 });

const billableEntries = [
  { date: pstNoon(2026, 5, 5), billableHours: 3, earnings: 300, billingCategory: 'M&A', client: 'Acme', matter: 'Acme SPA' },
  { date: pstNoon(2026, 5, 20), billableHours: 2, earnings: 200, adjustment: 50, billingCategory: 'Adjustment', client: 'Beta' },
  { date: pstNoon(2026, 6, 10), billableHours: 4, earnings: 400, client: 'Acme', matter: 'Acme SPA' },
  // Zero-hour pure-adjustment style row: counts for earnings/adjustment but
  // is excluded from the transaction-type breakdown.
  { date: pstNoon(2026, 6, 11), billableHours: 0, earnings: 100, adjustment: 100, billingCategory: 'Formation', client: 'Gamma', matter: 'Gamma Inc.' },
];

const opsEntries = [
  { date: pstNoon(2026, 5, 7), opsHours: 1.5, category: 'Admin' },
  { date: pstNoon(2026, 6, 12), opsHours: 2, category: 'BD' },
  { date: pstNoon(2026, 6, 13), opsHours: 0, category: 'Admin' }, // zero hours → excluded from ops breakdown
];

// ---------------------------------------------------------------------------
// filterEntriesByWindow
// ---------------------------------------------------------------------------

test('filterEntriesByWindow: null/undefined entries yield []', () => {
  assert.deepEqual(filterEntriesByWindow(null, new Date(), new Date()), []);
  assert.deepEqual(filterEntriesByWindow(undefined, null, null), []);
});

test('filterEntriesByWindow: missing startDate returns the input array as-is', () => {
  const result = filterEntriesByWindow(billableEntries, null, new Date());
  assert.equal(result, billableEntries); // same reference, no copy
});

test('filterEntriesByWindow: filters inclusively by entry date', () => {
  const start = new Date(2026, 4, 6); // May 6 local midnight
  const end = new Date(2026, 5, 10, 23, 59, 59, 999); // Jun 10 end of day
  const result = filterEntriesByWindow(billableEntries, start, end);
  assert.deepEqual(result.map((e) => e.billableHours), [2, 4]);
  // Boundary day is included: May 5 entry appears when start moves to May 5.
  const withBoundary = filterEntriesByWindow(billableEntries, new Date(2026, 4, 5), end);
  assert.equal(withBoundary.length, 3);
});

// ---------------------------------------------------------------------------
// collectActiveMonths
// ---------------------------------------------------------------------------

test('collectActiveMonths: unique YYYY-MM keys from entries', () => {
  const months = collectActiveMonths([...billableEntries, ...opsEntries]);
  assert.deepEqual([...months].sort(), ['2026-05', '2026-06']);
  assert.equal(collectActiveMonths([]).size, 0);
});

// ---------------------------------------------------------------------------
// computeAttorneyDetailTargets
// ---------------------------------------------------------------------------

const neverCalled = () => {
  throw new Error('getMonthProRate must not be called');
};

test('computeAttorneyDetailTargets: no active months → flat defaults, unrounded', () => {
  const result = computeAttorneyDetailTargets({
    activeMonths: new Set(),
    monthTargets: {},
    currentMonthKey: '2026-07',
    getMonthProRate: neverCalled,
  });
  assert.deepEqual(result, {
    billableTarget: 100,
    opsTarget: 50,
    totalTarget: 150,
    oooDays: 0,
    holidayDays: 0,
  });
});

test('computeAttorneyDetailTargets: defaults come from the current-month stored target', () => {
  const result = computeAttorneyDetailTargets({
    activeMonths: new Set(),
    monthTargets: { '2026-07': { billableHours: 80, opsHours: 40, totalHours: 120.25 } },
    currentMonthKey: '2026-07',
    getMonthProRate: neverCalled,
  });
  // Historical view behavior: the empty-months branch does NOT round, so a
  // stored 120.25 passes through untouched.
  assert.deepEqual(result, {
    billableTarget: 80,
    opsTarget: 40,
    totalTarget: 120.25,
    oooDays: 0,
    holidayDays: 0,
  });
});

test('computeAttorneyDetailTargets: pro-rates stored/default targets per active month', () => {
  const proRates = {
    '2026-05': { fraction: 1, oooDays: 0, holidayDays: 1 },
    '2026-06': { fraction: 0.5, oooDays: 3, holidayDays: 0 },
  };
  const result = computeAttorneyDetailTargets({
    activeMonths: new Set(['2026-05', '2026-06']),
    monthTargets: {
      '2026-05': { billableHours: 90, opsHours: 30, totalHours: 120 },
      // 2026-06 has no stored target → falls back to current-month defaults.
      '2026-07': { billableHours: 60, opsHours: 20, totalHours: 80 },
    },
    currentMonthKey: '2026-07',
    getMonthProRate: (monthKey, year, month) => {
      assert.equal(monthKey, `${year}-${String(month).padStart(2, '0')}`);
      return proRates[monthKey];
    },
  });
  // May: 90/30/120 × 1; June: 60/20/80 × 0.5 → totals 120 / 40 / 160.
  assert.deepEqual(result, {
    billableTarget: 120,
    opsTarget: 40,
    totalTarget: 160,
    oooDays: 3,
    holidayDays: 1,
  });
});

test('computeAttorneyDetailTargets: rounds pro-rated totals to 1 decimal', () => {
  const result = computeAttorneyDetailTargets({
    activeMonths: new Set(['2026-05']),
    monthTargets: {},
    currentMonthKey: '2026-07',
    getMonthProRate: () => ({ fraction: 1 / 3, oooDays: 0, holidayDays: 0 }),
  });
  // 100/3 = 33.33… → 33.3; 50/3 = 16.66… → 16.7; 150/3 = 50.
  assert.equal(result.billableTarget, 33.3);
  assert.equal(result.opsTarget, 16.7);
  assert.equal(result.totalTarget, 50);
});

// ---------------------------------------------------------------------------
// computeAttorneyDetailStats
// ---------------------------------------------------------------------------

const targets = { billableTarget: 10, opsTarget: 5, totalTarget: 15 };

test('computeAttorneyDetailStats: empty entries → zeroed stats, 0% against positive targets', () => {
  const result = computeAttorneyDetailStats({ billableEntries: [], opsEntries: [], targets });
  assert.equal(result.totalHours, 0);
  assert.equal(result.billableHours, 0);
  assert.equal(result.opsHours, 0);
  assert.equal(result.totalEarnings, 0);
  assert.equal(result.totalAdjustments, 0);
  assert.equal(result.matterCount, 0);
  assert.equal(result.uniqueTransactionTypes, 0);
  assert.equal(result.uniqueClients, 0);
  assert.equal(result.avgHoursPerMatter, 0);
  assert.equal(result.lastActivity, null);
  assert.equal(result.firstActivity, null);
  assert.equal(result.utilization, 0);
  assert.equal(result.billableUtilization, 0);
  assert.equal(result.opsUtilization, 0);
});

test('computeAttorneyDetailStats: empty entries with zero targets → null utilization', () => {
  const result = computeAttorneyDetailStats({
    billableEntries: [],
    opsEntries: [],
    targets: { billableTarget: 0, opsTarget: 0, totalTarget: 0 },
  });
  assert.equal(result.utilization, null);
  assert.equal(result.billableUtilization, null);
  assert.equal(result.opsUtilization, null);
});

test('computeAttorneyDetailStats: aggregates hours, earnings, adjustments, uniques', () => {
  const result = computeAttorneyDetailStats({ billableEntries, opsEntries, targets });
  assert.equal(result.billableHours, 9);       // 3 + 2 + 4 + 0
  assert.equal(result.opsHours, 3.5);          // 1.5 + 2 + 0
  assert.equal(result.totalHours, 12.5);
  assert.equal(result.totalEarnings, 1000);
  assert.equal(result.totalAdjustments, 150);
  assert.equal(result.matterCount, 2);         // Acme SPA, Gamma Inc.
  assert.equal(result.uniqueTransactionTypes, 3); // M&A, Adjustment, Formation
  assert.equal(result.uniqueClients, 3);       // Acme, Beta, Gamma
  assert.equal(result.avgHoursPerMatter, 4.5); // 9 billable / 2 matters
  // First/last activity span billable + ops entries.
  assert.equal(result.firstActivity.getTime(), new Date(2026, 4, 5).getTime());
  assert.equal(result.lastActivity.getTime(), new Date(2026, 5, 13).getTime());
  // Utilization: 12.5/15 → 83%, 9/10 → 90%, 3.5/5 → 70%.
  assert.equal(result.utilization, 83);
  assert.equal(result.billableUtilization, 90);
  assert.equal(result.opsUtilization, 70);
});

test('computeAttorneyDetailStats: zero targets with entries → null utilization', () => {
  const result = computeAttorneyDetailStats({
    billableEntries,
    opsEntries,
    targets: { billableTarget: 0, opsTarget: 0, totalTarget: 0 },
  });
  assert.equal(result.utilization, null);
  assert.equal(result.billableUtilization, null);
  assert.equal(result.opsUtilization, null);
});

// ---------------------------------------------------------------------------
// buildClientBreakdown
// ---------------------------------------------------------------------------

test('buildClientBreakdown: groups by client, sorted by hours descending', () => {
  const result = buildClientBreakdown(billableEntries);
  assert.deepEqual(result.map((c) => c.name), ['Acme', 'Beta', 'Gamma']);
  const acme = result[0];
  assert.equal(acme.hours, 7);
  assert.equal(acme.billableHours, 7);
  assert.equal(acme.earnings, 700);
  assert.equal(acme.count, 2);
  // Zero-hour entries still count for earnings and entry count.
  const gamma = result[2];
  assert.deepEqual(gamma, { name: 'Gamma', hours: 0, billableHours: 0, earnings: 100, count: 1 });
});

test('buildClientBreakdown: missing client falls back to Unknown', () => {
  const result = buildClientBreakdown([{ date: pstNoon(2026, 5, 1), billableHours: 1, earnings: 10 }]);
  assert.equal(result[0].name, 'Unknown');
});

// ---------------------------------------------------------------------------
// buildMatterBreakdown
// ---------------------------------------------------------------------------

test('buildMatterBreakdown: groups by matter, skips entries without one', () => {
  const result = buildMatterBreakdown(billableEntries);
  assert.deepEqual(result, [
    { name: 'Acme SPA', hours: 7, count: 2 },
    { name: 'Gamma Inc.', hours: 0, count: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// buildTransactionBreakdown
// ---------------------------------------------------------------------------

test('buildTransactionBreakdown: only positive-hour entries, with % of billable', () => {
  const result = buildTransactionBreakdown(billableEntries);
  // Formation row has 0 hours → excluded entirely. Missing category → 'Other'.
  assert.deepEqual(result.map((t) => t.type), ['Other', 'M&A', 'Adjustment']);
  assert.deepEqual(result.map((t) => t.hours), [4, 3, 2]);
  assert.deepEqual(result.map((t) => t.percentage), [44, 33, 22]); // of 9 hours
  assert.deepEqual(result.map((t) => t.earnings), [400, 300, 200]);
  assert.deepEqual(result.map((t) => t.count), [1, 1, 1]);
});

test('buildTransactionBreakdown: empty input → empty result', () => {
  assert.deepEqual(buildTransactionBreakdown([]), []);
});

// ---------------------------------------------------------------------------
// buildOpsBreakdown
// ---------------------------------------------------------------------------

test('buildOpsBreakdown: groups positive-hour ops entries by category with %', () => {
  const result = buildOpsBreakdown(opsEntries);
  assert.deepEqual(result, [
    { category: 'BD', hours: 2, count: 1, percentage: 57 },
    { category: 'Admin', hours: 1.5, count: 1, percentage: 43 },
  ]);
});

// ---------------------------------------------------------------------------
// buildMonthlyTrend
// ---------------------------------------------------------------------------

test('buildMonthlyTrend: per-month series sorted ascending with short labels', () => {
  const result = buildMonthlyTrend([...billableEntries, ...opsEntries]);
  assert.deepEqual(result.map((m) => m.month), ['2026-05', '2026-06']);
  assert.deepEqual(result.map((m) => m.label), ['May', 'Jun']);
  const may = result[0];
  assert.equal(may.billableHours, 5);
  assert.equal(may.opsHours, 1.5);
  assert.equal(may.totalHours, 6.5);
  assert.equal(may.earnings, 500);
  assert.equal(may.count, 3);
  const jun = result[1];
  assert.equal(jun.billableHours, 4);
  assert.equal(jun.opsHours, 2);
  assert.equal(jun.totalHours, 6);
  assert.equal(jun.earnings, 500);
  assert.equal(jun.count, 4);
});

// ---------------------------------------------------------------------------
// selectRecentEntries
// ---------------------------------------------------------------------------

test('selectRecentEntries: most recent first, input untouched, limit applied', () => {
  const combined = [...billableEntries, ...opsEntries];
  const before = [...combined];
  const result = selectRecentEntries(combined);
  assert.deepEqual(combined, before); // no in-place mutation
  const times = result.map((e) => e.date.seconds);
  const sorted = [...times].sort((a, b) => b - a);
  assert.deepEqual(times, sorted);
  assert.equal(result.length, combined.length);

  const limited = selectRecentEntries(combined, 2);
  assert.equal(limited.length, 2);
  assert.equal(limited[0].date.seconds, pstNoon(2026, 6, 13).seconds);
  assert.equal(limited[1].date.seconds, pstNoon(2026, 6, 12).seconds);
});

test('selectRecentEntries: default limit is 50', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({
    date: pstNoon(2026, 1, (i % 28) + 1),
    billableHours: 1,
  }));
  assert.equal(selectRecentEntries(many).length, 50);
});

// ---------------------------------------------------------------------------
// hasAdjustmentData
// ---------------------------------------------------------------------------

test('hasAdjustmentData: true on net adjustments or any visible entry adjustment', () => {
  assert.equal(hasAdjustmentData({ totalAdjustments: 150 }, []), true);
  assert.equal(hasAdjustmentData({ totalAdjustments: -25 }, []), true);
  // Offsetting adjustments net to 0 but individual entries still carry one.
  assert.equal(
    hasAdjustmentData({ totalAdjustments: 0 }, [{ adjustment: 100 }, { adjustment: -100 }]),
    true
  );
  assert.equal(hasAdjustmentData({ totalAdjustments: 0 }, [{}, { adjustment: 0 }]), false);
});
