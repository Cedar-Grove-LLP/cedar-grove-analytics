import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDateRange,
  derivePriorPeriodWindow,
  listRangeMonthKeys,
} from '../src/utils/dateHelpers.js';

// Wednesday, July 15 2026, 10:30 local — injected as "now" so every branch is
// deterministic regardless of when the suite runs.
const NOW = new Date(2026, 6, 15, 10, 30, 0, 0);

// Firestore-style {seconds} timestamps pin the PST calendar day regardless of
// the machine timezone (20:00 UTC = noon PST/PDT).
const pstNoonSeconds = (y, m, d) => ({ seconds: Date.UTC(y, m - 1, d, 20) / 1000 });

const at = (y, m, d, hh = 0, mm = 0, ss = 0, ms = 0) => new Date(y, m - 1, d, hh, mm, ss, ms);

test('calculateDateRange: current-week starts on Monday of this week', () => {
  const { startDate, endDate } = calculateDateRange('current-week', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 13));
  assert.equal(endDate.getTime(), NOW.getTime());
});

test('calculateDateRange: last-week covers the previous Monday-Sunday', () => {
  const { startDate, endDate } = calculateDateRange('last-week', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 6));
  assert.deepEqual(endDate, at(2026, 7, 12, 23, 59, 59, 999));
});

test('calculateDateRange: current-month starts on the 1st, ends now', () => {
  const { startDate, endDate } = calculateDateRange('current-month', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 1));
  assert.equal(endDate.getTime(), NOW.getTime());
});

test('calculateDateRange: last-month covers the whole previous calendar month', () => {
  const { startDate, endDate } = calculateDateRange('last-month', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 6, 1));
  assert.deepEqual(endDate, at(2026, 6, 30, 23, 59, 59, 999));
});

test('calculateDateRange: trailing-60 starts 60 days back at midnight', () => {
  const { startDate, endDate } = calculateDateRange('trailing-60', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 5, 16));
  assert.equal(endDate.getTime(), NOW.getTime());
});

test('calculateDateRange: custom spans the given days inclusive', () => {
  const { startDate, endDate } = calculateDateRange('custom', '2026-03-05', '2026-03-10', [], NOW);
  assert.deepEqual(startDate, at(2026, 3, 5));
  assert.deepEqual(endDate, at(2026, 3, 10, 23, 59, 59, 999));
});

test('calculateDateRange: custom without both dates falls back to month start', () => {
  const { startDate, endDate } = calculateDateRange('custom', '2026-03-05', null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 1));
  assert.equal(endDate.getTime(), NOW.getTime());
});

test('calculateDateRange: all-time starts at the earliest entry date', () => {
  const entries = [
    { date: pstNoonSeconds(2026, 2, 10) },
    { date: pstNoonSeconds(2026, 1, 5) },
  ];
  const { startDate, endDate } = calculateDateRange('all-time', null, null, entries, NOW);
  assert.deepEqual(startDate, at(2026, 1, 5));
  assert.equal(endDate.getTime(), NOW.getTime());
});

test('calculateDateRange: all-time with no entries falls back to current month start', () => {
  const { startDate } = calculateDateRange('all-time', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 1));
});

test('calculateDateRange: unknown range key defaults to current month start', () => {
  const { startDate } = calculateDateRange('bogus', null, null, [], NOW);
  assert.deepEqual(startDate, at(2026, 7, 1));
});

test('calculateDateRange: now parameter is optional (back-compat with 4-arg callers)', () => {
  const { startDate, endDate } = calculateDateRange('current-month', null, null, []);
  assert.ok(startDate instanceof Date);
  assert.ok(endDate instanceof Date);
  assert.equal(startDate.getDate(), 1);
});

test('derivePriorPeriodWindow: all-time has no prior period', () => {
  const cur = calculateDateRange('all-time', null, null, [], NOW);
  assert.deepEqual(derivePriorPeriodWindow('all-time', cur, NOW), {
    startDate: null,
    endDate: null,
    hasPrior: false,
  });
});

test('derivePriorPeriodWindow: missing current boundaries have no prior period', () => {
  assert.equal(derivePriorPeriodWindow('current-month', {}, NOW).hasPrior, false);
  assert.equal(
    derivePriorPeriodWindow('current-month', { startDate: NOW, endDate: null }, NOW).hasPrior,
    false
  );
});

test('derivePriorPeriodWindow: last-month maps to the whole month before it', () => {
  const cur = calculateDateRange('last-month', null, null, [], NOW);
  const prior = derivePriorPeriodWindow('last-month', cur, NOW);
  assert.equal(prior.hasPrior, true);
  assert.deepEqual(prior.startDate, at(2026, 5, 1));
  assert.deepEqual(prior.endDate, at(2026, 5, 31, 23, 59, 59, 999));
});

test('derivePriorPeriodWindow: current-month compares against the same elapsed span of last month', () => {
  const cur = calculateDateRange('current-month', null, null, [], NOW);
  const prior = derivePriorPeriodWindow('current-month', cur, NOW);
  const elapsedMs = cur.endDate.getTime() - cur.startDate.getTime();
  assert.equal(prior.hasPrior, true);
  assert.deepEqual(prior.startDate, at(2026, 6, 1));
  // Same elapsed span, aligned to the start of June — NOT the full month.
  assert.equal(prior.endDate.getTime(), prior.startDate.getTime() + elapsedMs);
  assert.equal(prior.endDate.getMonth(), 5); // still June
});

test('derivePriorPeriodWindow: current-week compares against the same elapsed span of last week', () => {
  const cur = calculateDateRange('current-week', null, null, [], NOW);
  const prior = derivePriorPeriodWindow('current-week', cur, NOW);
  const elapsedMs = cur.endDate.getTime() - cur.startDate.getTime();
  assert.deepEqual(prior.startDate, at(2026, 7, 6));
  assert.equal(prior.endDate.getTime(), prior.startDate.getTime() + elapsedMs);
});

test('derivePriorPeriodWindow: fixed-length windows get the equal-length window immediately before', () => {
  for (const key of ['last-week', 'trailing-60']) {
    const cur = calculateDateRange(key, null, null, [], NOW);
    const prior = derivePriorPeriodWindow(key, cur, NOW);
    const elapsedMs = cur.endDate.getTime() - cur.startDate.getTime();
    assert.equal(prior.hasPrior, true, key);
    assert.equal(prior.endDate.getTime(), cur.startDate.getTime() - 1, key);
    assert.equal(prior.startDate.getTime(), prior.endDate.getTime() - elapsedMs, key);
  }
});

test('derivePriorPeriodWindow: custom range gets the immediately preceding equal-length window', () => {
  // June window: no DST transition inside the elapsed span, so the pure
  // millisecond arithmetic lands on clean local midnights.
  const cur = calculateDateRange('custom', '2026-06-05', '2026-06-10', [], NOW);
  const prior = derivePriorPeriodWindow('custom', cur, NOW);
  assert.deepEqual(prior.endDate, at(2026, 6, 4, 23, 59, 59, 999));
  assert.deepEqual(prior.startDate, at(2026, 5, 30));
});

test('listRangeMonthKeys: enumerates every touched calendar month inclusive', () => {
  assert.deepEqual(
    listRangeMonthKeys(at(2026, 3, 15), at(2026, 6, 2)),
    ['2026-03', '2026-04', '2026-05', '2026-06']
  );
});

test('listRangeMonthKeys: single-month range yields one key', () => {
  assert.deepEqual(listRangeMonthKeys(at(2026, 7, 1), at(2026, 7, 31)), ['2026-07']);
});

test('listRangeMonthKeys: crosses year boundaries', () => {
  assert.deepEqual(
    listRangeMonthKeys(at(2025, 11, 20), at(2026, 2, 3)),
    ['2025-11', '2025-12', '2026-01', '2026-02']
  );
});

test('listRangeMonthKeys: missing boundary yields empty list', () => {
  assert.deepEqual(listRangeMonthKeys(null, at(2026, 7, 1)), []);
  assert.deepEqual(listRangeMonthKeys(at(2026, 7, 1), null), []);
});
