import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivationDate, hasJoinedBy, deriveActivationMonth } from '../src/utils/userActivation.mjs';

test('hasJoinedBy returns true when activationDate is absent/null/undefined, regardless of asOfDate', () => {
  const asOfDate = new Date(2026, 0, 1);
  assert.equal(hasJoinedBy({}, asOfDate), true);
  assert.equal(hasJoinedBy({ activationDate: null }, asOfDate), true);
  assert.equal(hasJoinedBy({ activationDate: undefined }, asOfDate), true);
  assert.equal(hasJoinedBy(undefined, asOfDate), true);
  assert.equal(hasJoinedBy(null, asOfDate), true);
});

test('hasJoinedBy returns true when asOfDate is null (all-time), regardless of activationDate', () => {
  assert.equal(hasJoinedBy({ activationDate: '2026-06' }, null), true);
  assert.equal(hasJoinedBy({ activationDate: '2099-01' }, undefined), true);
  assert.equal(hasJoinedBy({}, null), true);
});

test('hasJoinedBy returns true when activationDate month is before asOfDate', () => {
  const asOfDate = new Date(2026, 5, 15);
  assert.equal(hasJoinedBy({ activationDate: '2026-01' }, asOfDate), true);
});

test('hasJoinedBy returns true when activationDate is the same month as asOfDate (joined this month, inclusive)', () => {
  const asOfDate = new Date(2026, 5, 1); // start of June
  assert.equal(hasJoinedBy({ activationDate: '2026-06' }, asOfDate), true);
  const endOfMonth = new Date(2026, 5, 30, 23, 59, 59, 999);
  assert.equal(hasJoinedBy({ activationDate: '2026-06' }, endOfMonth), true);
});

test('hasJoinedBy returns false when activationDate month is after asOfDate', () => {
  const asOfDate = new Date(2026, 5, 30, 23, 59, 59, 999); // end of June
  assert.equal(hasJoinedBy({ activationDate: '2026-07' }, asOfDate), false);
});

test('hasJoinedBy still accepts a legacy day-precision "YYYY-MM-DD" activationDate', () => {
  const asOfDate = new Date(2026, 5, 15);
  assert.equal(hasJoinedBy({ activationDate: '2026-01-20' }, asOfDate), true);
  assert.equal(hasJoinedBy({ activationDate: '2026-06-16' }, asOfDate), false);
});

test('parseActivationDate returns null for empty string, null, undefined, and a garbage string', () => {
  assert.equal(parseActivationDate(''), null);
  assert.equal(parseActivationDate(null), null);
  assert.equal(parseActivationDate(undefined), null);
  assert.equal(parseActivationDate('not-a-date'), null);
  assert.equal(parseActivationDate('2026'), null);
});

test('parseActivationDate returns null for calendar-invalid month/day input', () => {
  assert.equal(parseActivationDate('2026-13'), null);
  assert.equal(parseActivationDate('2026-02-30'), null);
});

test('parseActivationDate parses "YYYY-MM" as the 1st of that local month', () => {
  const d = parseActivationDate('2026-03');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 1);
});

test('parseActivationDate parses a legacy "YYYY-MM-DD" as a local-midnight Date matching Y/M/D (no UTC off-by-one)', () => {
  const d = parseActivationDate('2026-03-15');
  assert.equal(d.getFullYear(), 2026);
  assert.equal(d.getMonth(), 2);
  assert.equal(d.getDate(), 15);
});

test('deriveActivationMonth returns null for empty/absent entries', () => {
  assert.equal(deriveActivationMonth([]), null);
  assert.equal(deriveActivationMonth(null), null);
  assert.equal(deriveActivationMonth(undefined), null);
});

test('deriveActivationMonth picks the earliest month/year across entries', () => {
  const entries = [
    { month: 'March', year: 2025 },
    { month: 'January', year: 2025 },
    { month: 'December', year: 2024 },
    { month: 'June', year: 2025 },
  ];
  assert.equal(deriveActivationMonth(entries), '2024-12');
});

test('deriveActivationMonth zero-pads the month', () => {
  assert.equal(deriveActivationMonth([{ month: 'April', year: 2026 }]), '2026-04');
});

test('deriveActivationMonth mixes billables and ops (earliest of either wins)', () => {
  const billables = [{ month: 'May', year: 2025 }];
  const ops = [{ month: 'February', year: 2025 }];
  assert.equal(deriveActivationMonth([...billables, ...ops]), '2025-02');
});

test('deriveActivationMonth is case-insensitive and trims month names', () => {
  assert.equal(deriveActivationMonth([{ month: '  july ', year: 2025 }]), '2025-07');
});

test('deriveActivationMonth ignores entries with an unrecognized month (no January fallback)', () => {
  const entries = [
    { month: 'Smarch', year: 2020 },  // garbage — must be skipped, not treated as Jan 2020
    { month: 'August', year: 2025 },
  ];
  assert.equal(deriveActivationMonth(entries), '2025-08');
});

test('deriveActivationMonth ignores entries with a non-integer year', () => {
  const entries = [
    { month: 'January', year: undefined },
    { month: 'March', year: '2025' },  // numeric-coercible string is accepted
    { month: 'May', year: 2026 },
  ];
  assert.equal(deriveActivationMonth(entries), '2025-03');
});
