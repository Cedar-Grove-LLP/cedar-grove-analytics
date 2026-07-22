import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveSummaryCells } from '../src/utils/verify/summaryCells.mjs';

test('summary label resolves a numeric adjacent value above the header', () => {
  const grid = [
    [' total billable hours ', 42.5],
    [],
    ['Client', 'Date', 'Hours'],
  ];
  assert.deepEqual(resolveSummaryCells(grid, 2).totalBillableHours, {
    value: 42.5,
    label: 'total billable hours',
    row: 0,
  });
});

test('summary currency string is parsed after strict validation', () => {
  const grid = [
    ['Billables Earnings', '$1,234.56'],
    ['Client', 'Date', 'Hours'],
  ];
  assert.equal(resolveSummaryCells(grid, 1).billableEarnings.value, 1234.56);
});

test('unknown summary label remains undefined rather than becoming zero', () => {
  const grid = [
    ['Mystery Total', 77],
    ['Client', 'Date', 'Hours'],
  ];
  assert.equal(resolveSummaryCells(grid, 1).mysteryTotal, undefined);
  assert.equal(resolveSummaryCells(grid, 1).totalBillableHours, undefined);
});

test('Sheets error-string summary remains unavailable rather than becoming zero', () => {
  const grid = [
    ['Total Billable Hours', '#N/A'],
    ['Client', 'Date', 'Hours'],
  ];
  assert.equal(resolveSummaryCells(grid, 1).totalBillableHours, undefined);
});

test('arbitrary non-numeric summary string remains unavailable', () => {
  const grid = [
    ['Total Payment', 'not available'],
    ['Client', 'Date', 'Hours'],
  ];
  assert.equal(resolveSummaryCells(grid, 1).totalPayment, undefined);
});
