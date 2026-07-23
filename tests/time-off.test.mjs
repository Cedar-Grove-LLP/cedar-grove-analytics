import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  countTimeOffInRange,
  getHolidaySet,
  isOffsiteTitle,
  parseOooDayFraction,
  parseTimeOff,
  proRateMonth,
} from '../src/utils/timeOff.js';

const oooEvent = (title, over = {}) => ({
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  start: '2026-07-06',
  end: '2026-07-06',
  title,
  ...over,
});

test('parseOooDayFraction recognizes full-day and partial-day title conventions', () => {
  const cases = [
    ['Half day', { offFraction: 0.5, partial: true, label: 'Half day' }],
    ['half-day', { offFraction: 0.5, partial: true, label: 'Half day' }],
    ['1/2 day', { offFraction: 0.5, partial: true, label: 'Half day' }],
    ['½ day', { offFraction: 0.5, partial: true, label: 'Half day' }],
    ['2PM onwards', { offFraction: 0.5, partial: true, label: 'Partial (PM)' }],
    ['leaving early', { offFraction: 0.5, partial: true, label: 'Partial (PM)' }],
    ['afternoon off', { offFraction: 0.5, partial: true, label: 'Partial (PM)' }],
    ['AM only', { offFraction: 0.5, partial: true, label: 'Partial (AM)' }],
    ['morning', { offFraction: 0.5, partial: true, label: 'Partial (AM)' }],
    ['Vacation', { offFraction: 1, partial: false, label: null }],
    ['', { offFraction: 1, partial: false, label: null }],
    ['OOO', { offFraction: 1, partial: false, label: null }],
  ];

  for (const [title, expected] of cases) {
    assert.deepEqual(parseOooDayFraction(title), expected, title || '(empty title)');
  }

  // Unrecognized titles silently count as a full day off.
  assert.deepEqual(
    parseOooDayFraction('Dentist appointment'),
    { offFraction: 1, partial: false, label: null },
  );
});

test('parseOooDayFraction currently treats any word starting with leav as PM partial', () => {
  // The broad `\bleav` match also catches unrelated words such as "leavened".
  assert.deepEqual(
    parseOooDayFraction('Leavened bread'),
    { offFraction: 0.5, partial: true, label: 'Partial (PM)' },
  );
});

test('isOffsiteTitle recognizes supported variants without matching officer', () => {
  for (const title of ['Firm Off-Site', 'Offsite', 'Off Site', 'Off-site visit', 'The offsite']) {
    assert.equal(isOffsiteTitle(title), true, title);
  }
  assert.equal(isOffsiteTitle('Officer meeting'), false);
});

test('parseTimeOff excludes off-sites from both person indexes', () => {
  const parsed = parseTimeOff({
    holidays: [],
    outOfOffice: [oooEvent('Firm Off-Site')],
  });

  assert.equal(parsed.oooByEmail.size, 0);
  assert.equal(parsed.oooByName.size, 0);
});

test('parseTimeOff keeps the largest overlapping OOO fraction regardless of insertion order', () => {
  const halfDay = oooEvent('Half day');
  const fullDay = oooEvent('Vacation');

  for (const outOfOffice of [[halfDay, fullDay], [fullDay, halfDay]]) {
    const parsed = parseTimeOff({ holidays: [], outOfOffice });
    assert.equal(parsed.oooByEmail.get('ada@example.com').get('2026-07-06'), 1);
    assert.equal(parsed.oooByName.get('ada lovelace').get('2026-07-06'), 1);
  }
});

test('parseTimeOff normalizes non-zero-padded holiday dates', () => {
  const parsed = parseTimeOff({
    holidays: [{ date: '2026-7-3', name: 'Firm holiday' }],
    outOfOffice: [],
  });

  assert.equal(parsed.holidaySet.has('2026-07-03'), true);
});

test('parseTimeOff tolerates missing documents and collections', () => {
  for (const doc of [null, undefined, {}]) {
    const parsed = parseTimeOff(doc);
    assert.equal(parsed.holidaySet.size, 0);
    assert.equal(parsed.oooByEmail.size, 0);
    assert.equal(parsed.oooByName.size, 0);
    assert.equal(parsed.hasHolidays, false);
  }
});

test('getHolidaySet uses synced holidays as a replacement rather than merging fallback holidays', () => {
  const parsed = parseTimeOff({
    holidays: [{ date: '2026-07-03', name: 'Firm holiday' }],
    outOfOffice: [],
  });
  const holidays = getHolidaySet(parsed, new Date(2026, 0, 1), new Date(2026, 11, 31));

  assert.equal(holidays, parsed.holidaySet);
  assert.equal(holidays.has('2026-01-01'), false);
});

test('getHolidaySet falls back to federal holidays for every spanned year', () => {
  const holidays = getHolidaySet(null, new Date(2025, 6, 1), new Date(2026, 6, 10));

  assert.equal(holidays.has('2025-07-04'), true);
  assert.equal(holidays.has('2026-07-03'), true);
});

test('getHolidaySet returns an empty set when fallback range dates are missing', () => {
  const holidays = getHolidaySet(null);
  assert.equal(holidays.size, 0);
});

test('proRateMonth clamps an in-progress current month to now', () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const now = new Date(year, month - 1, 15, 12);
  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;

  const result = proRateMonth(
    year,
    month,
    { startDate: null, endDate: null, currentMonthKey, now },
    new Set(),
    new Map(),
  );

  assert.equal(result.effectiveEnd, now);
});

test('proRateMonth gives an explicit mid-month end precedence over the current-month now clamp', () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = today.getMonth() + 1;
  const endDate = new Date(year, month - 1, 10, 18);
  const now = new Date(year, month - 1, 20, 12);
  const currentMonthKey = `${year}-${String(month).padStart(2, '0')}`;

  const result = proRateMonth(
    year,
    month,
    { startDate: null, endDate, currentMonthKey, now },
    new Set(),
    new Map(),
  );

  assert.equal(result.effectiveEnd, endDate);
  assert.notEqual(result.effectiveEnd, now);
});

test('proRateMonth gives a full past clean month a fraction of one', () => {
  const year = new Date().getFullYear() - 1;
  const month = 3;
  const result = proRateMonth(
    year,
    month,
    {
      startDate: new Date(year, month - 1, 1),
      endDate: new Date(year, month, 0, 23, 59, 59, 999),
      currentMonthKey: 'not-current',
      now: new Date(),
    },
    null,
    null,
  );

  assert.equal(result.fraction, 1);
});

test('countTimeOffInRange gives holidays precedence over overlapping OOO', () => {
  const holidaySet = new Set(['2026-07-06']);
  const oooMap = new Map([['2026-07-06', 1]]);
  const result = countTimeOffInRange(
    null,
    null,
    new Date(2026, 6, 6),
    new Date(2026, 6, 6),
    holidaySet,
    oooMap,
  );

  assert.deepEqual(result, { oooBusinessDays: 0, holidayBusinessDays: 1 });
});

test('countTimeOffInRange sums partial OOO across separate weekdays', () => {
  const oooMap = new Map([
    ['2026-07-06', 0.5],
    ['2026-07-07', 0.5],
  ]);
  const result = countTimeOffInRange(
    null,
    null,
    new Date(2026, 6, 6),
    new Date(2026, 6, 7),
    new Set(),
    oooMap,
  );

  assert.deepEqual(result, { oooBusinessDays: 1, holidayBusinessDays: 0 });
});
