import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCurrency,
  formatHours,
  formatTimeOffContext,
  formatDate,
  formatShortDate,
} from '../src/utils/formatters.js';

// ---------------------------------------------------------------- formatCurrency

test('formatCurrency: whole dollars, cents, rounding, negative, zero', () => {
  assert.equal(formatCurrency(1000), '$1,000');
  assert.equal(formatCurrency(1234.5), '$1,234.50');
  // 10.999 rounds to 11.00 → whole-dollar branch, no decimals
  assert.equal(formatCurrency(10.999), '$11');
  // Intl currency formatting places the minus before the $ sign (current behavior)
  assert.equal(formatCurrency(-5.5), '-$5.50');
  assert.equal(formatCurrency(0), '$0');
});

// ---------------------------------------------------------------- formatHours

test('formatHours: thousands separator, rounding, whole-number branch', () => {
  // rounds .55 up to .6, thousands separator kept
  assert.equal(formatHours(1234.55), '1,234.6');
  // rounds down to 8.0 → whole-number branch
  assert.equal(formatHours(8.04), '8');
  // rounds up to 0.1
  assert.equal(formatHours(0.05), '0.1');
});

// ---------------------------------------------------------------- formatTimeOffContext

test('formatTimeOffContext: empty when both zero or omitted', () => {
  assert.equal(formatTimeOffContext(0, 0), '');
  assert.equal(formatTimeOffContext(), ''); // both params default to 0
});

test('formatTimeOffContext: out-of-office phrasing', () => {
  assert.equal(formatTimeOffContext(1, 0), '1 day out of office');
  assert.equal(formatTimeOffContext(2, 0), '2 days out of office');
  // 0.5 !== 1 so pluralizes to "days" — current (questionable) behavior
  assert.equal(formatTimeOffContext(0.5, 0), '0.5 days out of office');
});

test('formatTimeOffContext: firm holiday phrasing', () => {
  assert.equal(formatTimeOffContext(0, 1), '1 firm holiday');
  assert.equal(formatTimeOffContext(0, 2), '2 firm holidays');
});

test('formatTimeOffContext: combined OOO and holidays', () => {
  assert.equal(formatTimeOffContext(2, 3), '2 days out of office and 3 firm holidays');
});

// ---------------------------------------------------------------- formatDate

test('formatDate: falsy inputs return "No date"', () => {
  assert.equal(formatDate(null), 'No date');
  assert.equal(formatDate(undefined), 'No date');
  assert.equal(formatDate(''), 'No date');
});

test('formatDate: string dates pass through unchanged', () => {
  assert.equal(formatDate('2026-06-11'), '2026-06-11');
});

test('formatDate: Date objects use toLocaleDateString (locale/TZ dependent)', () => {
  // No locale arg — output depends on the machine's default locale (en-US in CI/dev)
  assert.equal(formatDate(new Date(2026, 5, 11)), '6/11/2026');
});

test('formatDate: Firestore Timestamp-shaped objects', () => {
  assert.equal(
    formatDate({ seconds: 1749600000, nanoseconds: 0 }),
    '6/10/2025',
  );
});

test('formatDate: unsupported types fall through to "No date"', () => {
  assert.equal(formatDate(123), 'No date');
  assert.equal(formatDate({}), 'No date');
});

// ---------------------------------------------------------------- formatShortDate

test('formatShortDate: null/undefined return empty string', () => {
  assert.equal(formatShortDate(null), '');
  assert.equal(formatShortDate(undefined), '');
});

test('formatShortDate: invalid input returns empty string', () => {
  assert.equal(formatShortDate('not a date'), '');
});

test('formatShortDate: UTC-anchored ISO strings show previous local day (America/New_York)', () => {
  // UTC-midnight timestamps display as the previous local calendar day in UTC-4
  assert.equal(formatShortDate('2026-06-11T00:00:00Z'), 'Jun 10, 2026');
  // date-only ISO strings parse as UTC midnight — same TZ-driven off-by-one
  assert.equal(formatShortDate('2026-06-11'), 'Jun 10, 2026');
  // epoch millis for 2026-06-11T00:00:00 UTC — same off-by-one as ISO strings
  assert.equal(formatShortDate(1781136000000), 'Jun 10, 2026');
});

test('formatShortDate: local Date construction has no off-by-one', () => {
  // (year, month, day) uses local time — contrast with UTC-anchored ISO strings above
  assert.equal(formatShortDate(new Date(2026, 5, 11)), 'Jun 11, 2026');
});

test('formatShortDate: epoch zero in America/New_York', () => {
  // epoch 0 in America/New_York is the evening before Jan 1 1970 UTC
  assert.equal(formatShortDate(0), 'Dec 31, 1969');
});
