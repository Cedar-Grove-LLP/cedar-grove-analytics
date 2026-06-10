import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRate, findRateInfo, monthKeyFromDate } from '../src/utils/rateLookup.mjs';

const rates2026 = {
  '2026-01': { rate: 300 },
  '2026-04': { rate: 350 },
};

test('exact month match wins', () => {
  const info = findRateInfo(rates2026, '2026-04');
  assert.deepEqual(info, {
    rate: 350, found: true, sourceMonthKey: '2026-04', requestedMonthKey: '2026-04',
  });
});

test('backward fallback picks the nearest prior month', () => {
  const info = findRateInfo(rates2026, '2026-03');
  assert.equal(info.rate, 300);
  assert.equal(info.found, true);
  assert.equal(info.sourceMonthKey, '2026-01');
});

test('2025 lookup against 2026-only rates reports found:false, never a silent rate', () => {
  // The headline bug: missing 2025 rates rendered as $0 with no signal.
  const info = findRateInfo(rates2026, '2025-01');
  assert.deepEqual(info, {
    rate: 0, found: false, sourceMonthKey: null, requestedMonthKey: '2025-01',
  });
});

test('no forward fallback exists', () => {
  assert.equal(findRateInfo(rates2026, '2025-12').found, false);
});

test('findRate stays behavior-identical to findRateInfo().rate', () => {
  for (const key of ['2026-01', '2026-02', '2026-04', '2026-12', '2025-06', '1999-01']) {
    assert.equal(findRate(rates2026, key), findRateInfo(rates2026, key).rate, key);
  }
});

test('explicit rate 0 falls through to backward fallback (legacy truthy-check behavior)', () => {
  const map = { '2026-01': { rate: 250 }, '2026-02': { rate: 0 } };
  assert.equal(findRate(map, '2026-02'), 250);
});

test('null/empty rates map misses', () => {
  assert.equal(findRateInfo(null, '2026-01').found, false);
  assert.equal(findRateInfo({}, '2026-01').found, false);
  assert.equal(findRateInfo(rates2026, null).found, false);
});

test('monthKeyFromDate handles Date, {seconds}, string, and invalid input', () => {
  assert.equal(monthKeyFromDate(new Date(2025, 0, 15)), '2025-01');
  assert.equal(
    monthKeyFromDate({ seconds: Date.UTC(2025, 2, 10, 12) / 1000 }),
    '2025-03'
  );
  assert.equal(monthKeyFromDate('2025-06-15T12:00:00'), '2025-06');
  assert.equal(monthKeyFromDate(undefined), null);
  assert.equal(monthKeyFromDate('not a date'), null);
  assert.equal(monthKeyFromDate({}), null);
});

test('monthKeyFromDate prefers {seconds} over other shapes (hook parity)', () => {
  const tsLike = {
    seconds: Date.UTC(2025, 0, 15, 12) / 1000,
    toDate: () => new Date(2030, 5, 1),
  };
  assert.equal(monthKeyFromDate(tsLike), '2025-01');
});
