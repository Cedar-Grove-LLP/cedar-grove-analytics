import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseActivationDate, hasJoinedBy } from '../src/utils/userActivation.mjs';

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
