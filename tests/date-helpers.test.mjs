import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateDateRange,
  countBusinessDays,
  getEntryDate,
  getMonthBusinessDays,
  getMonthNumber,
  getMonthProRateFraction,
  getUSFederalHolidays,
  isBusinessDay,
  toDateKey,
} from '../src/utils/dateHelpers.js';

const dateKeys = (dates) => dates.map(toDateKey);

const businessDayKeys = (startDate, endDate) => {
  const keys = [];
  const current = new Date(startDate);
  while (current <= endDate) {
    if (isBusinessDay(current)) keys.push(toDateKey(current));
    current.setDate(current.getDate() + 1);
  }
  return keys;
};

// ===== Section 1: getMonthProRateFraction invariants =====

test('a clean full month has an exact pro-rate fraction of one', () => {
  const result = getMonthProRateFraction(
    2026, 4, new Date(2026, 3, 1), new Date(2026, 3, 30)
  );
  assert.equal(result.fraction, 1);
  assert.equal(result.baselineMonthDays, result.availableDays);
});

test('the first half of a month is approximately half its working days', () => {
  const { fraction } = getMonthProRateFraction(
    2026, 4, new Date(2026, 3, 1), new Date(2026, 3, 15)
  );
  assert.ok(Math.abs(fraction - 0.5) < 0.15);
});

test('a window made entirely full OOO has zero available days and fraction', () => {
  const start = new Date(2026, 3, 6);
  const end = new Date(2026, 3, 10);
  const oooMap = new Map(businessDayKeys(start, end).map((key) => [key, 1]));
  const result = getMonthProRateFraction(2026, 4, start, end, null, oooMap);
  assert.equal(result.availableDays, 0);
  assert.equal(result.fraction, 0);
});

test('a half-day OOO contributes exactly half a day', () => {
  const day = new Date(2026, 3, 8);
  const clean = getMonthProRateFraction(
    2026, 4, new Date(2026, 3, 1), new Date(2026, 3, 30)
  );
  const withHalfDay = getMonthProRateFraction(
    2026, 4, day, day, null, new Map([['2026-04-08', 0.5]])
  );
  assert.equal(withHalfDay.availableDays, 0.5);
  assert.equal(withHalfDay.baselineMonthDays, clean.baselineMonthDays - 0.5);
});

test('a weekday holiday lowers both sides of a full-month fraction equally', () => {
  const start = new Date(2026, 3, 1);
  const end = new Date(2026, 3, 30);
  const clean = getMonthProRateFraction(2026, 4, start, end);
  const withHoliday = getMonthProRateFraction(
    2026, 4, start, end, new Set(['2026-04-08'])
  );
  assert.equal(withHoliday.fraction, 1);
  assert.equal(withHoliday.baselineMonthDays, clean.baselineMonthDays - 1);
});

// ===== Section 2: getUSFederalHolidays golden lists for 2025, 2026, 2027 =====

test('2025 federal holidays match the golden calendar', () => {
  const actual = getUSFederalHolidays(2025);
  assert.equal(actual.length, 12);
  assert.deepEqual(dateKeys(actual), [
    '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26',
    '2025-06-19', '2025-07-04', '2025-09-01', '2025-10-13',
    '2025-11-11', '2025-11-27', '2025-11-28', '2025-12-25',
  ]);
});

test('2026 federal holidays match the golden calendar', () => {
  const actual = getUSFederalHolidays(2026);
  assert.equal(actual.length, 12);
  // July 4 is Saturday, so Independence Day is observed Friday, July 3.
  assert.deepEqual(dateKeys(actual), [
    '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25',
    '2026-06-19', '2026-07-03', '2026-09-07', '2026-10-12',
    '2026-11-11', '2026-11-26', '2026-11-27', '2026-12-25',
  ]);
});

test('2027 federal holidays match the golden calendar', () => {
  const actual = getUSFederalHolidays(2027);
  assert.equal(actual.length, 12);
  // Saturday Juneteenth shifts to Jun 18, Sunday Independence Day to Jul 5,
  // and Saturday Christmas to Dec 24.
  assert.deepEqual(dateKeys(actual), [
    '2027-01-01', '2027-01-18', '2027-02-15', '2027-05-31',
    '2027-06-18', '2027-07-05', '2027-09-06', '2027-10-11',
    '2027-11-11', '2027-11-25', '2027-11-26', '2027-12-24',
  ]);
});

// ===== Section 3: countBusinessDays with and without excludeDates =====

test('business-day counting crosses a month boundary and honors exclusions', () => {
  const start = new Date(2026, 0, 29);
  const end = new Date(2026, 1, 3);
  const plain = countBusinessDays(start, end);
  assert.equal(plain, 4);
  assert.equal(countBusinessDays(start, end, new Set(['2026-02-02'])), plain - 1);
  assert.equal(countBusinessDays(start, end, new Set(['2026-02-07'])), plain);
});

// ===== Section 4: getMonthBusinessDays elapsed/remaining with asOfDate =====

test('month business days report none elapsed before the month', () => {
  const result = getMonthBusinessDays(2026, 4, new Date(2026, 2, 31));
  assert.deepEqual(result, { total: result.total, elapsed: 0, remaining: result.total });
});

test('month business days split elapsed and remaining inside the month', () => {
  const result = getMonthBusinessDays(2026, 4, new Date(2026, 3, 15));
  assert.equal(result.elapsed + result.remaining, result.total);
  assert.ok(result.elapsed > 0);
  assert.ok(result.remaining > 0);
});

test('month business days are fully elapsed after the month', () => {
  const result = getMonthBusinessDays(2026, 4, new Date(2026, 4, 1));
  assert.deepEqual(result, { total: result.total, elapsed: result.total, remaining: 0 });
});

test('omitting asOfDate reports the full month as elapsed', () => {
  const result = getMonthBusinessDays(2026, 4);
  assert.deepEqual(result, { total: result.total, elapsed: result.total, remaining: 0 });
});

// ===== Section 5: getMonthNumber silent fallback =====

test('an unrecognized month name silently falls back to January', () => {
  // This does not throw: it can mask an upstream invalid-input bug if unchecked.
  assert.equal(getMonthNumber('Bogus'), 1);
});

// ===== Section 6: calculateDateRange last-week Monday math and custom range =====

const withFixedNow = (isoString, callback) => {
  const RealDate = globalThis.Date;
  const fixedTime = new RealDate(isoString).getTime();
  class MockDate extends RealDate {
    constructor(...args) {
      super(...(args.length === 0 ? [fixedTime] : args));
    }
  }
  globalThis.Date = MockDate;
  try {
    return callback();
  } finally {
    globalThis.Date = RealDate;
  }
};

test('last-week resolves Monday through Sunday when now is a PST Sunday', () => {
  // The Date override is scoped and unconditionally restored to exercise the
  // production function rather than duplicating its Monday-offset formula.
  const result = withFixedNow('2026-03-15T19:00:00Z', () => calculateDateRange('last-week'));
  assert.equal(toDateKey(result.startDate), '2026-03-02');
  assert.equal(toDateKey(result.endDate), '2026-03-08');
  assert.deepEqual(
    [result.startDate.getHours(), result.startDate.getMinutes(), result.startDate.getSeconds(),
      result.startDate.getMilliseconds()],
    [0, 0, 0, 0]
  );
  assert.deepEqual(
    [result.endDate.getHours(), result.endDate.getMinutes(), result.endDate.getSeconds(),
      result.endDate.getMilliseconds()],
    [23, 59, 59, 999]
  );
});

test('last-week resolves Monday through Sunday when now is a PST Monday', () => {
  const result = withFixedNow('2026-03-16T19:00:00Z', () => calculateDateRange('last-week'));
  assert.equal(toDateKey(result.startDate), '2026-03-09');
  assert.equal(toDateKey(result.endDate), '2026-03-15');
});

test('a custom date range uses local midnight through inclusive end-of-day', () => {
  const { startDate, endDate } = calculateDateRange(
    'custom', '2026-03-01', '2026-03-05'
  );
  assert.deepEqual(
    [startDate.getFullYear(), startDate.getMonth(), startDate.getDate(),
      startDate.getHours(), startDate.getMinutes(), startDate.getSeconds(),
      startDate.getMilliseconds()],
    [2026, 2, 1, 0, 0, 0, 0]
  );
  assert.deepEqual(
    [endDate.getFullYear(), endDate.getMonth(), endDate.getDate(),
      endDate.getHours(), endDate.getMinutes(), endDate.getSeconds(),
      endDate.getMilliseconds()],
    [2026, 2, 5, 23, 59, 59, 999]
  );
});

// ===== Section 7: getEntryDate =====

test('Firestore seconds and toDate shapes produce identical entry dates', () => {
  const seconds = Date.parse('2026-03-01T05:00:00Z') / 1000;
  const fromSeconds = getEntryDate({ date: { seconds } });
  const fromToDate = getEntryDate({ date: { toDate: () => new Date(seconds * 1000) } });
  assert.equal(fromSeconds.getTime(), fromToDate.getTime());
});

test('entry instants are projected onto their PST calendar day', () => {
  const result = getEntryDate({ date: '2026-03-01T05:00:00Z' });
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 1);
  assert.equal(result.getDate(), 28);
});

test('an invalid entry date string passes through as Invalid Date', () => {
  // Documents current (questionable) behavior: a NaN Date silently propagates
  // unless callers explicitly check it.
  assert.equal(Number.isNaN(getEntryDate({ date: 'not-a-date' }).getTime()), true);
});

test('an entry without date falls back to first-of-month local midnight', () => {
  const result = getEntryDate({ month: 'March', year: 2026 });
  assert.equal(result.getFullYear(), 2026);
  assert.equal(result.getMonth(), 2);
  assert.equal(result.getDate(), 1);
  assert.equal(result.getHours(), 0);
  assert.equal(toDateKey(result), '2026-03-01');
});
