import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBillingRow,
  computeTotals,
  hasAdjustments,
  isBillableRow,
} from '../src/utils/billingSummaryCalc.mjs';

const context = {
  attorneyName: 'Sam McClure',
  date: new Date(2026, 5, 30),
  rate: 400,
  found: true,
};

test('pure adjustment rows are billable and their amount is the adjustment', () => {
  const entry = { billableHours: 0, adjustment: 500 };

  assert.equal(isBillableRow(entry), true);
  assert.equal(buildBillingRow(entry, context).amount, 500);
});

test('negative adjustments keep their sign in rows and totals', () => {
  const row = buildBillingRow(
    { billableHours: 0, adjustment: -125 },
    context
  );

  assert.equal(row.amount, -125);
  assert.deepEqual(computeTotals([row]), {
    hours: 0,
    adjustment: -125,
    amount: -125,
  });
});

test('zero-hours zero-adjustment rows are not billable', () => {
  assert.equal(isBillableRow({ billableHours: 0, adjustment: 0 }), false);
});

test('missing rates are flagged only when the row has hours', () => {
  const missingRate = { ...context, rate: 0, found: false };
  const hoursRow = buildBillingRow(
    { billableHours: 2, adjustment: 50 },
    missingRate
  );
  const adjustmentRow = buildBillingRow(
    { billableHours: 0, adjustment: 50 },
    missingRate
  );

  assert.equal(hoursRow.rateMissing, true);
  assert.equal(hoursRow.amount, 50);
  assert.equal(adjustmentRow.rateMissing, false);
});

test('amount uses client rate times hours plus adjustment, never entry earnings', () => {
  const row = buildBillingRow(
    { billableHours: 2, adjustment: 100, earnings: 99999 },
    { ...context, rate: 550 }
  );

  assert.equal(row.amount, 1200);
  assert.notEqual(row.amount, row.earnings);
});

test('hasAdjustments detects positive and negative nonzero adjustments', () => {
  assert.equal(hasAdjustments([{ adjustment: 0 }, { adjustment: 0 }]), false);
  const normalizedMissingAdjustment = buildBillingRow(
    { billableHours: 1 },
    context
  );
  assert.equal(hasAdjustments([{ adjustment: 0 }, normalizedMissingAdjustment]), false);
  assert.equal(hasAdjustments([{ adjustment: 0 }, { adjustment: 10 }]), true);
  assert.equal(hasAdjustments([{ adjustment: 0 }, { adjustment: -10 }]), true);
});

test('computeTotals sums normal, pure-adjustment, and credit rows', () => {
  const rows = [
    buildBillingRow(
      { billableHours: 2, adjustment: 100 },
      { ...context, rate: 550 }
    ),
    buildBillingRow(
      { billableHours: 0, adjustment: 500 },
      context
    ),
    buildBillingRow(
      { billableHours: 1, adjustment: -125 },
      { ...context, rate: 300 }
    ),
  ];

  assert.deepEqual(computeTotals(rows), {
    hours: 3,
    adjustment: 475,
    amount: 1875,
  });
});
