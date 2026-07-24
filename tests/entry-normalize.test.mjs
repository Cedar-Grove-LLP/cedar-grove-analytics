import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeBillableEntry,
  normalizeEightThreeBEntry,
  normalizeOpsEntry,
  parseMoney,
} from '../src/utils/entryNormalize.mjs';

test('parseMoney handles formatted strings, numbers, and negative values', () => {
  assert.equal(parseMoney('$1,234.00'), 1234);
  assert.equal(parseMoney(1234), 1234);
  assert.equal(parseMoney('-$500'), -500);
  assert.equal(parseMoney('-500.00'), -500);
});

test('normalizeBillableEntry parses money fields and applies defaults', () => {
  const entry = normalizeBillableEntry({
    hours: '2.5',
    earnings: '$1,234.00',
    adjustment: '$1,234.00',
    reimbursements: '$1,234.00',
  }, 'sam', 'April', 2026);

  assert.equal(entry.billableHours, 2.5);
  assert.equal(entry.earnings, 1234);
  assert.equal(entry.adjustment, 1234);
  assert.equal(entry.reimbursements, 1234);
  assert.equal(entry.billingCategory, 'Other');
  assert.equal(entry.client, 'Unknown');
  assert.equal(entry.matter, '');
});

test('normalizeBillableEntry defaults absent adjustment and reimbursements to zero', () => {
  const entry = normalizeBillableEntry({}, 'sam');
  assert.equal(entry.adjustment, 0);
  assert.equal(entry.reimbursements, 0);
});

test('normalizeBillableEntry never infers hours from earnings or adjustment', () => {
  const entry = normalizeBillableEntry({ hours: '', earnings: 1000, adjustment: 500 }, 'sam');
  assert.equal(entry.billableHours, 0);
  assert.equal(entry.adjustment, 500);
});

test('normalizeBillableEntry preserves a negative adjustment', () => {
  const entry = normalizeBillableEntry({ adjustment: -150 }, 'sam');
  assert.equal(entry.adjustment, -150);
});

test('normalizeOpsEntry handles blank categories, notes, and formatted hours', () => {
  const blankCategory = normalizeOpsEntry({ hours: '6.5', category: '   ', description: 'Admin' }, 'sam');
  assert.equal(blankCategory.opsHours, 6.5);
  assert.equal(blankCategory.category, 'Other');
  assert.equal(blankCategory.notes, 'Admin');

  const formattedHours = normalizeOpsEntry({ hours: '$1,234.5' }, 'sam');
  assert.equal(formattedHours.opsHours, 1234.5);
});

test('normalizeEightThreeBEntry parses flat fees and defaults absent fees', () => {
  const parsed = normalizeEightThreeBEntry({ flatFee: '$250.00' }, 'sam', 'April', 2026);
  assert.equal(parsed.flatFee, 250);
  assert.equal(parsed.description, '');
  assert.equal(parsed.client, 'Unknown');

  assert.equal(normalizeEightThreeBEntry({}, 'sam').flatFee, 0);
});
