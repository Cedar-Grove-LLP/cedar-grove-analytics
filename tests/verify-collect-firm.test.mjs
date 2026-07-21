import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLabelValue,
  serialToISO,
  sheetMonthDay,
  fsMonthDay,
  tsToISO,
} from '../scripts/verify/collect-firm.mjs';

test('findLabelValue reads numeric column B values for exact column A labels', () => {
  const grid = [
    ['Heading', 999],
    ['Revenue (Accrued):', 12345.67],
  ];
  assert.equal(findLabelValue(grid, 'Revenue (Accrued):'), 12345.67);
});

test('findLabelValue returns null for missing labels and non-numeric adjacent values', () => {
  const grid = [
    ['Revenue (Accrued):', '#N/A'],
    ['Attorney Billables:', 'Query completed with an empty output.'],
  ];
  assert.equal(findLabelValue(grid, 'Firm Profits (Accrued):'), null);
  assert.equal(findLabelValue(grid, 'Revenue (Accrued):'), null);
  assert.equal(findLabelValue(grid, 'Attorney Billables:'), null);
});

test('serialToISO converts Sheets serials and rejects non-finite inputs', () => {
  assert.equal(serialToISO(1), '1899-12-31');
  assert.equal(serialToISO(25569), '1970-01-01');
  assert.equal(serialToISO('25569'), null);
  assert.equal(serialToISO(NaN), null);
});

test('sheetMonthDay formats serial dates without leading zeros and rejects invalid serials', () => {
  assert.equal(sheetMonthDay(44990), '3/5');
  assert.equal(sheetMonthDay(null), null);
  assert.equal(sheetMonthDay(Infinity), null);
});

test('sheet and Firestore date formats normalize to equal month/day values', () => {
  assert.equal(fsMonthDay('2/5/2025'), '2/5');
  assert.equal(fsMonthDay('2025-02-05T00:00:00.000Z'), '2/5');
  assert.equal(sheetMonthDay(45701), fsMonthDay('2/13/2025'));
  assert.equal(fsMonthDay(undefined), null);
  assert.equal(fsMonthDay(null), null);
  assert.equal(fsMonthDay(''), null);
});

test('tsToISO supports Timestamp-like objects, seconds objects, Dates, and falsy input', () => {
  const date = new Date('2025-02-05T12:34:56.000Z');
  assert.equal(tsToISO({ toDate: () => date }), date.toISOString());
  assert.equal(tsToISO({ _seconds: 0 }), '1970-01-01T00:00:00.000Z');
  assert.equal(tsToISO(date), date.toISOString());
  assert.equal(tsToISO(null), null);
});

test('amount mismatch tolerance is strictly greater than 0.005', () => {
  const mismatch = (sheetAmount, fsAmount) => Math.abs(sheetAmount - (fsAmount || 0)) > 0.005;
  assert.equal(mismatch(100.005, 100), false);
  assert.equal(mismatch(100.006, 100), true);
});
