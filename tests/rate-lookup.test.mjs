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

test('pre-history lookup bills retrospectively at the earliest stored rate', () => {
  // 2024/2025 hours under a rates[] array that starts in 2026 used to bill
  // at a flagged $0; they now use the earliest known rate, marked
  // retrospective so callers can distinguish it from a real backward match.
  const info = findRateInfo(rates2026, '2025-01');
  assert.deepEqual(info, {
    rate: 300, found: true, retrospective: true,
    sourceMonthKey: '2026-01', requestedMonthKey: '2025-01',
  });
  assert.equal(findRateInfo(rates2026, '2025-12').rate, 300);
});

test('retrospective fallback skips leading zero-rate entries', () => {
  const map = { '2026-01': { rate: 0 }, '2026-03': { rate: 275 } };
  const info = findRateInfo(map, '2025-06');
  assert.equal(info.rate, 275);
  assert.equal(info.retrospective, true);
  assert.equal(info.sourceMonthKey, '2026-03');
});

test('retrospective fallback never applies mid-history (backward-only there)', () => {
  // A prior month exists but holds rate 0 → still a flagged miss, the
  // earliest-rate fallback must not paper over mid-history gaps.
  const map = { '2026-01': { rate: 0 }, '2026-05': { rate: 350 } };
  assert.equal(findRateInfo(map, '2026-03').found, false);
});

test('a zero-rate entry AT the earliest stored key is a miss, not a forward-looking "retrospective"', () => {
  // Regression: requesting the earliest key itself (which holds a falsy
  // rate) must not fall into the retrospective branch and forward-look to a
  // LATER month's nonzero rate — that's a real forward peek mislabeled as
  // "retrospective", not the "bill at the earliest known rate" the feature
  // intends. It must report found:false exactly like any other mid-history
  // zero-rate gap.
  const map = { '2025-01': { rate: 0 }, '2026-06': { rate: 400 } };
  assert.deepEqual(findRateInfo(map, '2025-01'), {
    rate: 0, found: false, sourceMonthKey: null, requestedMonthKey: '2025-01',
  });
  // A month genuinely BEFORE the whole history still gets the retrospective
  // fallback to the earliest known nonzero rate (skipping the leading $0).
  assert.deepEqual(findRateInfo(map, '2024-06'), {
    rate: 400, found: true, retrospective: true,
    sourceMonthKey: '2026-06', requestedMonthKey: '2024-06',
  });
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

test('a fallback entry holding rate 0/undefined reports found:false, not a silent $0', () => {
  // Hours billed against these maps yield $0 — the warning must fire.
  const zeroRate = { '2026-01': { rate: 0 } };
  assert.deepEqual(findRateInfo(zeroRate, '2026-03'), {
    rate: 0, found: false, sourceMonthKey: null, requestedMonthKey: '2026-03',
  });
  const malformed = { '2026-01': {} };
  assert.equal(findRateInfo(malformed, '2026-03').found, false);
  // findRate (billing math) is unchanged: still 0 either way.
  assert.equal(findRate(zeroRate, '2026-03'), 0);
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
