import { test } from 'node:test';
import assert from 'node:assert/strict';
import { round2, sumColumn } from '../scripts/verify/subject.mjs';

test('sumColumn sums numeric cells below the header and rounds float noise', () => {
  const grid = [
    ['Name', 'Amount'],
    ['A', 0.1],
    ['B', 0.2],
    ['C', 0.3],
  ];
  assert.equal(sumColumn(grid, 0, 1), 0.6);
});

test('sumColumn ignores blank, text, and numeric-looking string cells', () => {
  const grid = [
    ['Name', 'Amount'],
    ['A', 12],
    ['B', '12'],
    ['C', 'N/A'],
    ['D', ''],
    ['E', null],
    ['F', undefined],
  ];
  assert.equal(sumColumn(grid, 0, 1), 12);
});

test('sumColumn returns zero for null, negative, and unpopulated column indexes', () => {
  const grid = [['Name'], ['A']];
  assert.equal(sumColumn(grid, 0, null), 0);
  assert.equal(sumColumn(grid, 0, -1), 0);
  assert.equal(sumColumn(grid, 0, 4), 0);
});

test('sumColumn tolerates rows shorter than the target column', () => {
  const grid = [
    ['A', 'B', 'C', 'Amount'],
    ['x', '', '', 5],
    ['x'],
    ['x', '', '', 7],
  ];
  assert.equal(sumColumn(grid, 0, 3), 12);
});

test('round2 removes common IEEE-754 noise', () => {
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(30392.999999999996), 30393);
});
