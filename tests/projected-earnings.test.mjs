import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAX_RANK,
  buildProjectedRow,
  findLatestRate,
  findRankForRate,
  partnerSharePct,
  predictedAnnualProfit,
  predictedRankForMonth,
  sumTotals,
  takeHomeField,
} from '../src/utils/projectedEarnings.mjs';

const levels = Array.from({ length: 20 }, (_, rank) => ({
  rank,
  level: `L${rank}`,
  tier: `T${rank}`,
  clientRate: 200 + rank * 10,
  attorneyRate: 100 + rank * 5,
  colinRate: rank < 13 ? null : 150 + rank * 5,
}));

const entryDate = (entry) => new Date(entry.date);
const today = new Date(2026, 1, 15);

const makeRow = ({
  user = { id: 'user-1', name: 'Alex Attorney' },
  rate = 200,
  entries = [],
  targets = {},
  currentMonth = 2,
  currentYear = 2026,
  promoted = true,
  annualProfit = 0,
  customLevels = levels,
} = {}) => buildProjectedRow({
  user,
  levels: customLevels,
  allBillableEntries: entries,
  allRates: { [user.name || user.id]: { '2026-01': { rate } } },
  allTargets: { [user.name || user.id]: targets },
  today,
  currentMonth,
  currentYear,
  promoted,
  annualProfit,
  getEntryDate: entryDate,
});

test('exact client-rate match projects from its rank and a missing match projects zero earnings', () => {
  const targets = { '2026-04': { billableHours: 10 } };
  const matched = makeRow({ rate: 220, targets });
  const unmatched = makeRow({ rate: 999, targets });

  assert.equal(findRankForRate(levels, 220, 'clientRate'), 2);
  assert.equal(matched.startLevelLabel, 'L2/T2');
  assert.equal(matched.endLevelLabel, 'L3/T3');
  assert.equal(matched.projectedEarnings, 10 * levels[3].attorneyRate);
  assert.equal(unmatched.hasRankMatch, false);
  assert.equal(unmatched.projectedHours, 10);
  assert.equal(unmatched.projectedEarnings, 0);
});

test('Colin take-home falls back for blank/null rates and uses a real Colin rate at rank 13+', () => {
  assert.equal(takeHomeField('Colin Van Loon'), 'colinRate');
  assert.equal(takeHomeField('Someone Else'), 'attorneyRate');

  const blankLevels = levels.map((level) => ({ ...level }));
  blankLevels[1].colinRate = '';
  const target = (month) => ({ [`2026-${String(month).padStart(2, '0')}`]: { billableHours: 1 } });
  assert.equal(makeRow({ user: { id: 'colin', name: 'Colin Van Loon' }, rate: 210, targets: target(2), customLevels: blankLevels }).projectedEarnings, levels[1].attorneyRate);
  assert.equal(makeRow({ user: { id: 'colin', name: 'Colin Van Loon' }, rate: 220, targets: target(2) }).projectedEarnings, levels[2].attorneyRate);
  assert.equal(makeRow({ user: { id: 'colin', name: 'Colin Van Loon' }, rate: 330, targets: target(2) }).projectedEarnings, levels[13].colinRate);
});

test('rank projection applies Q2, Q4, both, only future boundaries, and the rank cap', () => {
  assert.equal(predictedRankForMonth(3, 2, 6), 4);
  assert.equal(predictedRankForMonth(3, 8, 11), 4);
  assert.equal(predictedRankForMonth(3, 2, 11), 5);
  assert.equal(predictedRankForMonth(3, 5, 11), 4);
  assert.equal(predictedRankForMonth(19, 2, 11), MAX_RANK);
  assert.equal(predictedRankForMonth(18, 2, 11), MAX_RANK);
});

test('PTE attorneys hold the stored rate flat across Q2 and Q4', () => {
  const row = makeRow({
    user: { id: 'pte', name: 'Pat Part-time', employmentType: 'PTE' },
    rate: 275,
    targets: {
      '2026-02': { billableHours: 2 },
      '2026-04': { billableHours: 3 },
      '2026-10': { billableHours: 4 },
    },
  });
  assert.equal(row.hasRankMatch, true);
  assert.equal(row.canPromote, false);
  assert.equal(row.projectedHours, 9);
  assert.equal(row.projectedEarnings, 9 * 275);
});

test('promotion override off holds an eligible FTE at its starting rank', () => {
  const row = makeRow({
    rate: 220,
    promoted: false,
    targets: { '2026-04': { billableHours: 2 }, '2026-10': { billableHours: 3 } },
  });
  assert.equal(row.canPromote, true);
  assert.equal(row.endLevelLabel, 'L2/T2');
  assert.equal(row.projectedEarnings, 5 * levels[2].attorneyRate);
});

test('current-month projection blends actual hours and floors excess actuals at zero', () => {
  const targets = { '2026-02': { billableHours: 10 } };
  const partial = makeRow({
    targets,
    entries: [{ userId: 'user-1', year: 2026, date: '2026-02-10', billableHours: 4, earnings: 400 }],
  });
  const excess = makeRow({
    targets,
    entries: [{ userId: 'user-1', year: 2026, date: '2026-02-10', billableHours: 12, earnings: 1200 }],
  });
  assert.equal(partial.projectedHours, 6);
  assert.equal(partial.projectedEarnings, 6 * levels[0].attorneyRate);
  assert.equal(excess.projectedHours, 0);
  assert.equal(excess.projectedEarnings, 0);
});

test('zero or absent monthly targets are skipped entirely', () => {
  const row = makeRow({ targets: { '2026-02': { billableHours: 0 }, '2026-03': {} } });
  assert.equal(row.projectedHours, 0);
  assert.equal(row.projectedEarnings, 0);
});

test('YTD includes valid entries through today and excludes future-dated entries', () => {
  const row = makeRow({
    targets: { '2026-02': { billableHours: 10 } },
    entries: [
      { userId: 'user-1', year: 2026, date: '2026-02-15', billableHours: 3, earnings: 300 },
      { userId: 'user-1', year: 2026, date: '2026-02-16', billableHours: 8, earnings: 800 },
    ],
  });
  assert.equal(row.ytdHours, 3);
  assert.equal(row.ytdEarnings, 300);
  assert.equal(row.projectedHours, 7);
});

test('predicted annual profit averages only finite completed current-year months', () => {
  const metrics = [
    { month: 'January', year: 2026, firmProfit: 1000 },
    { month: 'January', year: 2026, firmProfit: undefined },
    { month: 'January', year: 2026 },
    { month: 'February', year: '2026', firmProfit: 2000 },
    { month: 'February', year: 2026, firmProfit: NaN },
    { month: 'March', year: 2026, firmProfit: 9000 },
    { month: 'January', year: 2025, firmProfit: 8000 },
  ];
  assert.equal(predictedAnnualProfit(metrics, 3, 2026), 18000);
  assert.equal(predictedAnnualProfit(metrics, 1, 2026), 0);
  assert.equal(predictedAnnualProfit([], 6, 2026), 0);
});

test('partner shares integrate into partner totals while non-partners receive none', () => {
  assert.equal(partnerSharePct('Sam McClure'), 0.95);
  assert.equal(partnerSharePct('Colin Van Loon'), 0.05);
  assert.equal(partnerSharePct('Alex Attorney'), 0);

  const sam = makeRow({ user: { id: 'sam', name: 'Sam McClure' }, annualProfit: 12000 });
  const colin = makeRow({ user: { id: 'colin', name: 'Colin Van Loon' }, annualProfit: 12000 });
  const other = makeRow({ annualProfit: 12000 });
  assert.equal(sam.profitShare, 11400);
  assert.equal(colin.profitShare, 600);
  assert.equal(other.profitShare, 0);
  assert.equal(other.isPartner, false);
  for (const row of [sam, other]) {
    assert.equal(row.totalProjectedEarnings, row.ytdEarnings + row.projectedEarnings + row.profitShare);
  }
});

test('sumTotals sums all six fields and returns zero totals for an empty list', () => {
  const zeroes = {
    ytdEarnings: 0, ytdHours: 0, projectedHours: 0,
    projectedEarnings: 0, profitShare: 0, totalProjectedEarnings: 0,
  };
  assert.deepEqual(sumTotals([]), zeroes);
  assert.deepEqual(sumTotals([
    { ytdEarnings: 1, ytdHours: 2, projectedHours: 3, projectedEarnings: 4, profitShare: 5, totalProjectedEarnings: 6 },
    { ytdEarnings: 10, ytdHours: 20, projectedHours: 30, projectedEarnings: 40, profitShare: 50, totalProjectedEarnings: 60 },
  ]), {
    ytdEarnings: 11, ytdHours: 22, projectedHours: 33,
    projectedEarnings: 44, profitShare: 55, totalProjectedEarnings: 66,
  });
});

test('latest-rate and rank helpers preserve empty, falsy, missing, and exact-match behavior', () => {
  assert.deepEqual(findLatestRate({
    '2026-01': { rate: 200 },
    '2025-12': { rate: 190 },
    '2026-10': { rate: 300 },
  }), { rate: 300, monthKey: '2026-10' });
  assert.equal(findLatestRate({}), null);
  assert.equal(findLatestRate(), null);
  assert.equal(findRankForRate(levels, 0, 'clientRate'), -1);
  assert.equal(findRankForRate(levels, null, 'clientRate'), -1);
  assert.equal(findRankForRate(levels, undefined, 'clientRate'), -1);
  assert.equal(findRankForRate(levels, 999, 'clientRate'), -1);
  assert.equal(findRankForRate(levels, 230, 'clientRate'), 3);
});
