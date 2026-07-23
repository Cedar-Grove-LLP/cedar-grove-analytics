// Invoice-prep computation for the Billing Summaries page
// (src/utils/billingSummaryRows.mjs). Contract: Amount = rate × hours +
// adjustment (calc key billingSummaryAmount); pure adjustment rows (0 hours)
// belong on the bill; the Adjustment column/total appears only when the
// selection has one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBillableRow,
  entryMonthKey,
  buildBillingRows,
  selectionHasAdjustments,
  computeBillingTotals,
  buildBillingCsvRows,
  buildBillingSummaryCsv,
  billingSummaryFilename,
} from '../src/utils/billingSummaryRows.mjs';
import { buildCsv } from '../src/utils/buildCsv.mjs';

// Entry dates use 20:00 UTC, which is noon PST — getEntryDate normalizes to
// the PST calendar day, so these are stable regardless of the machine TZ.
const d = (iso) => `${iso}T20:00:00Z`;

const USER_MAP = { u1: 'Sam McClure', u2: 'Jane Roe' };

// Rate book: Sam $500/hr, Jane $300/hr; anyone else has no usable rate
// (found: false → hours bill at $0 and the row is flagged, not hidden).
const getRateInfo = (attorneyName) => {
  if (attorneyName === 'Sam McClure') return { rate: 500, found: true };
  if (attorneyName === 'Jane Roe') return { rate: 300, found: true };
  return { rate: 0, found: false };
};

const build = (entries) =>
  buildBillingRows(entries, {
    month: '2026-03',
    client: 'Acme',
    userMap: USER_MAP,
    getRateInfo,
  });

test('isBillableRow: hours or a nonzero adjustment puts a row on the bill', () => {
  assert.equal(isBillableRow({ billableHours: 1.5 }), true);
  assert.equal(isBillableRow({ billableHours: 0, adjustment: 250 }), true);
  assert.equal(isBillableRow({ billableHours: 0, adjustment: -50 }), true);
  assert.equal(isBillableRow({ billableHours: 0, adjustment: 0 }), false);
  assert.equal(isBillableRow({ billableHours: 0 }), false);
});

test('entryMonthKey: PST calendar month, zero-padded', () => {
  assert.equal(entryMonthKey({ date: d('2026-03-05') }), '2026-03');
  // 04:00 UTC on Mar 1 is still Feb 28 in PST
  assert.equal(entryMonthKey({ date: '2026-03-01T04:00:00Z' }), '2026-02');
});

test('amount without adjustment is rate × hours', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].amount, 300 * 2);
  assert.equal(rows[0].adjustment, 0);
  assert.equal(rows[0].rateMissing, false);
});

test('amount with adjustment is rate × hours + adjustment (credits subtract)', () => {
  const rows = build([
    { userId: 'u1', client: 'Acme', date: d('2026-03-05'), billableHours: 2, adjustment: 150 },
    { userId: 'u1', client: 'Acme', date: d('2026-03-06'), billableHours: 1, adjustment: -75 },
  ]);
  assert.equal(rows[0].amount, 500 * 2 + 150);
  assert.equal(rows[1].amount, 500 * 1 - 75);
});

test('pure adjustment row (0 hours) is included, amount = adjustment', () => {
  const rows = build([
    { userId: 'u1', client: 'Acme', date: d('2026-03-31'), billableHours: 0, adjustment: 250 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].billableHours, 0);
  assert.equal(rows[0].amount, 500 * 0 + 250);
  // 0-hour rows are never flagged rateMissing — no hours bill at $0
  assert.equal(rows[0].rateMissing, false);
});

test('rows with neither hours nor adjustment are excluded', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 0 },
    { userId: 'u2', client: 'Acme', date: d('2026-03-06'), billableHours: 0, adjustment: 0 },
  ]);
  assert.deepEqual(rows, []);
});

test('filters by month and client; missing client falls back to "Unknown"', () => {
  const entries = [
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 1 },
    { userId: 'u2', client: 'Other', date: d('2026-03-05'), billableHours: 1 },
    { userId: 'u2', client: 'Acme', date: d('2026-04-05'), billableHours: 1 },
    { userId: 'u2', date: d('2026-03-07'), billableHours: 1 }, // no client
  ];
  assert.equal(build(entries).length, 1);
  const unknown = buildBillingRows(entries, {
    month: '2026-03', client: 'Unknown', userMap: USER_MAP, getRateInfo,
  });
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].attorneyName, 'Jane Roe');
});

test('returns [] when entries, month, or client is missing', () => {
  const args = { month: '2026-03', client: 'Acme', userMap: USER_MAP, getRateInfo };
  assert.deepEqual(buildBillingRows(null, args), []);
  assert.deepEqual(buildBillingRows([{ client: 'Acme', billableHours: 1, date: d('2026-03-05') }], { ...args, month: '' }), []);
  assert.deepEqual(buildBillingRows([{ client: 'Acme', billableHours: 1, date: d('2026-03-05') }], { ...args, client: '' }), []);
});

test('rows sort by date; attorneyName falls back to userId when unmapped', () => {
  const rows = build([
    { userId: 'u-unmapped', client: 'Acme', date: d('2026-03-20'), billableHours: 1 },
    { userId: 'u2', client: 'Acme', date: d('2026-03-02'), billableHours: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.attorneyName), ['Jane Roe', 'u-unmapped']);
});

test('missing-rate row bills at $0 and is flagged rateMissing (pins current behavior)', () => {
  const rows = build([
    { userId: 'u-unmapped', client: 'Acme', date: d('2026-03-10'), billableHours: 3, adjustment: 40 },
  ]);
  assert.equal(rows[0].rateMissing, true);
  assert.equal(rows[0].rate, 0);
  // The adjustment still lands on the bill even when the hours bill at $0.
  assert.equal(rows[0].amount, 0 * 3 + 40);
});

test('category prefers billingCategory, then category, then "Other"; notes default empty', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 1, billingCategory: 'EL', category: 'X' },
    { userId: 'u2', client: 'Acme', date: d('2026-03-06'), billableHours: 1, category: 'Hourly' },
    { userId: 'u2', client: 'Acme', date: d('2026-03-07'), billableHours: 1 },
  ]);
  assert.deepEqual(rows.map((r) => r.category), ['EL', 'Hourly', 'Other']);
  assert.equal(rows[2].notes, '');
});

test('selectionHasAdjustments: true only when some row carries a nonzero adjustment', () => {
  const plain = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2 },
  ]);
  assert.equal(selectionHasAdjustments(plain), false);
  const withAdj = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2 },
    { userId: 'u1', client: 'Acme', date: d('2026-03-06'), billableHours: 0, adjustment: -50 },
  ]);
  assert.equal(selectionHasAdjustments(withAdj), true);
});

test('totals sum hours, adjustments, and amounts', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2 },          // 600
    { userId: 'u1', client: 'Acme', date: d('2026-03-06'), billableHours: 1.5, adjustment: 100 }, // 850
    { userId: 'u1', client: 'Acme', date: d('2026-03-31'), billableHours: 0, adjustment: -50 },   // -50
  ]);
  assert.deepEqual(computeBillingTotals(rows), { hours: 3.5, adjustment: 50, amount: 1400 });
  assert.deepEqual(computeBillingTotals([]), { hours: 0, adjustment: 0, amount: 0 });
});

test('CSV rows omit the Adjustment column when the selection has none', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2, notes: 'call' },
  ]);
  const { headers, rows: csvRows } = buildBillingCsvRows(rows);
  assert.deepEqual(headers, ['Date', 'Attorney', 'Rate', 'Hours', 'Amount', 'Category', 'Notes']);
  assert.equal(csvRows.length, 2); // 1 entry + totals row
  assert.deepEqual(csvRows[0], [
    rows[0].date.toLocaleDateString(), 'Jane Roe', 300, 2, '600.00', 'Other', 'call',
  ]);
  assert.deepEqual(csvRows[1], ['', '', '', '2.0', '600.00', '', '']);
});

test('CSV output for a small selection with adjustments (via pure buildCsv)', () => {
  const rows = build([
    { userId: 'u2', client: 'Acme', date: d('2026-03-05'), billableHours: 2, notes: 'says "hi"' },
    { userId: 'u1', client: 'Acme', date: d('2026-03-31'), billableHours: 0, adjustment: 250, billingCategory: 'Adjustment' },
  ]);
  const { headers, rows: csvRows } = buildBillingCsvRows(rows);
  assert.deepEqual(headers, ['Date', 'Attorney', 'Rate', 'Hours', 'Adjustment', 'Amount', 'Category', 'Notes']);
  assert.deepEqual(csvRows, [
    [rows[0].date.toLocaleDateString(), 'Jane Roe', 300, 2, '0.00', '600.00', 'Other', 'says "hi"'],
    [rows[1].date.toLocaleDateString(), 'Sam McClure', 500, 0, '250.00', '250.00', 'Adjustment', ''],
    ['', '', '', '2.0', '250.00', '850.00', '', ''],
  ]);

  const csv = buildBillingSummaryCsv(rows);
  assert.equal(csv, buildCsv(headers, csvRows));
  const lines = csv.split('\n');
  assert.equal(lines.length, 4); // header + 2 entries + totals
  assert.ok(lines[1].includes('"says ""hi"""')); // quotes escaped by buildCsv
  assert.equal(lines[3], '"","","","2.0","250.00","850.00","",""');
});

test('billingSummaryFilename collapses whitespace in the client name', () => {
  assert.equal(billingSummaryFilename('Acme Corp LLC', '2026-03'), 'billing-summary-Acme-Corp-LLC-2026-03.csv');
});
