import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLayout, resolveTabToMonth, LAYOUT_SIGNATURES, TAB_MONTH_OVERRIDES } from '../src/utils/verify/sheetLayout.mjs';

// Header rows encoded verbatim from the live books (blank spacer cells kept
// where the real grid has them, since resolveLayout must resolve columns by
// real position, not by a filtered/compacted row).

const STD_2026_HEADER = [
  'Client', 'Date', 'Hours', 'Billables Earnings', 'Billing Category', 'Matter',
  'Client Filing Fees', 'Notes', '', 'Ops', 'Category', 'Date', 'Hours', '',
  'Company', 'Name', 'Flat Fee', '', 'Reimbursement Description', 'Reimbursement Amount',
];

const MCCLURE_ADJUSTMENT_2026_HEADER = [
  'Client', 'Date', 'Hours', 'Adjustment ($)', 'Billables Earnings', 'Billing Category',
  'Matter', 'Client Filing Fees', 'Notes', '', 'Ops', 'Category', 'Date', 'Hours', '',
  'Company', 'Name', 'Flat Fee', '', 'Reimbursement Description', 'Reimbursement Amount',
];

const LEGACY_CLIENT_INVOICE_HEADER = [
  'Client', 'Date', 'Hours', 'Client Invoice', 'Billing Category', 'Notes', 'Reimbursement',
  '', 'Ops', 'Category', 'Date', 'Hours', '', 'Company', 'Name', 'Flat Fee',
];

const LEGACY_EARNINGS_HEADER = [
  'Client', 'Date', 'Hours', 'Earnings', 'Billing Category', 'Reimbursements', 'Notes',
  '', 'Ops', 'Category', 'Date', 'Hours', '', 'Company', 'Name', 'Flat Fee',
];

const VANLOON_BILLABLE_EARNINGS_HEADER = [
  'Client', 'Date', 'Hours', 'Billable Earnings', 'Billing Category', 'Reimbursements',
  'Notes', '', 'Ops', 'Category', 'Date', 'Hours', '', 'Company', 'Name', 'Flat Fee',
];

const USCANGA_BILLABLE_TO_CLIENT_HEADER = [
  'Client', 'Date', 'Hours', 'Billable to Client', 'Billing Category', 'Matter',
  'Reimbursements', 'Notes', '', 'Ops', 'Category', 'Date', 'Hours', '',
  'Company', 'Name', 'Flat Fee',
];

const CLIENT_MATRIX_HEADER = [
  'Client', 'Hrs Estimate (Val)', 'Hourly', 'Sam', 'Billables', 'Fees', 'Fees Notes',
  'General Notes', '', 'Ops', 'Category', 'Date', 'Hours',
];

function gridWithHeaderAt(header, rowIndex = 10) {
  const rows = [];
  for (let i = 0; i < rowIndex; i += 1) rows.push([]);
  rows.push(header);
  return rows;
}

describe('resolveLayout — catalogued header rows', () => {
  test('row 11, 2026 std layout', () => {
    const result = resolveLayout(gridWithHeaderAt(STD_2026_HEADER, 10));
    assert.equal(result.signatureId, 'std-2026-r11');
    assert.equal(result.headerRowIndex, 10);
    assert.equal(result.layout, 'per-entry');
    assert.equal(result.earningsLabel, 'Billables Earnings');
    assert.equal(result.columns.client, 0);
    assert.equal(result.columns.date, 1);
    assert.equal(result.columns.hours, 2);
    assert.equal(result.columns.earnings, 3);
    assert.equal(result.columns.matter, 5);
    assert.equal(result.columns.clientFilingFees, 6);
    assert.equal(result.columns.adjustment, null);
    // ops block: second Date/Hours occurrence, not the billable one
    assert.equal(result.columns.ops, 9);
    assert.equal(result.columns.opsDate, 11);
    assert.equal(result.columns.opsHours, 12);
    assert.equal(result.columns.reimbursementDescription, 18);
    assert.equal(result.columns.reimbursementAmount, 19);
  });

  test('row 11, McClure 2026 Jun/Jul — Adjustment ($) shifts everything right by one', () => {
    const result = resolveLayout(gridWithHeaderAt(MCCLURE_ADJUSTMENT_2026_HEADER, 10));
    assert.equal(result.signatureId, 'mcclure-adjustment-2026-r11');
    assert.equal(result.columns.adjustment, 3);
    assert.equal(result.columns.earnings, 4);
  });

  test('Adjustment ($) shift is resolved by label, never a hardcoded index', () => {
    const std = resolveLayout(gridWithHeaderAt(STD_2026_HEADER, 10));
    const shifted = resolveLayout(gridWithHeaderAt(MCCLURE_ADJUSTMENT_2026_HEADER, 10));
    assert.equal(shifted.columns.earnings - std.columns.earnings, 1);
    assert.equal(shifted.columns.matter - std.columns.matter, 1);
    assert.equal(shifted.columns.opsHours - std.columns.opsHours, 1);
  });

  test('row 9, legacy client-invoice layout', () => {
    const result = resolveLayout(gridWithHeaderAt(LEGACY_CLIENT_INVOICE_HEADER, 8));
    assert.equal(result.signatureId, 'legacy-client-invoice-r9');
    assert.equal(result.headerRowIndex, 8);
    assert.equal(result.earningsLabel, 'Client Invoice');
    assert.equal(result.columns.earnings, 3);
    assert.equal(result.columns.reimbursement, 6);
    assert.equal(result.columns.opsHours, 11);
  });

  test('row 9, legacy earnings layout', () => {
    const result = resolveLayout(gridWithHeaderAt(LEGACY_EARNINGS_HEADER, 8));
    assert.equal(result.signatureId, 'legacy-earnings-r9');
    assert.equal(result.earningsLabel, 'Earnings');
    assert.equal(result.columns.earnings, 3);
    assert.equal(result.columns.reimbursement, 5);
  });

  test('row 9, van Loon Oct-Dec 2025 layout', () => {
    const result = resolveLayout(gridWithHeaderAt(VANLOON_BILLABLE_EARNINGS_HEADER, 8));
    assert.equal(result.signatureId, 'vanloon-billable-earnings-2025-r9');
    assert.equal(result.earningsLabel, 'Billable Earnings');
    assert.equal(result.columns.earnings, 3);
  });

  test('Uscanga 2026 Jan-Mar layout', () => {
    const result = resolveLayout(gridWithHeaderAt(USCANGA_BILLABLE_TO_CLIENT_HEADER, 8));
    assert.equal(result.signatureId, 'uscanga-billable-to-client-2026-r9');
    assert.equal(result.earningsLabel, 'Billable to Client');
    assert.equal(result.columns.earnings, 3);
    assert.equal(result.columns.matter, 5);
  });

  test('client-matrix layout (McClure 2025) — hours resolves to Hrs Estimate (Val), not the ops Hours', () => {
    const result = resolveLayout(gridWithHeaderAt(CLIENT_MATRIX_HEADER, 8));
    assert.equal(result.signatureId, 'mcclure-client-matrix-2025');
    assert.equal(result.layout, 'client-matrix');
    assert.equal(result.earningsLabel, 'Billables');
    assert.equal(result.columns.hours, 1); // Hrs Estimate (Val), not the ops Hours
    assert.equal(result.columns.earnings, 4); // Billables — client-rate dollars
    // the matrix's single "Hours" cell is the ops one — resolved as the
    // 1st (only) occurrence, not skipped as if it were the billable column
    assert.equal(result.columns.opsHours, 12);
  });

  test('every LAYOUT_SIGNATURES entry round-trips through resolveLayout', () => {
    for (const sig of LAYOUT_SIGNATURES) {
      const result = resolveLayout(gridWithHeaderAt(sig.header, 5));
      assert.equal(result.signatureId, sig.id, `expected ${sig.id} to resolve from its own header`);
      assert.equal(result.layout, sig.layout);
      assert.equal(result.earningsLabel, sig.earningsLabel);
    }
  });
});

describe('resolveLayout — unrecognized layout', () => {
  test('no row contains both Client and an hours-ish column -> signatureId null, no guessing', () => {
    const grid = [
      ['Total Billable Hours', 32.49, '', '', '', 'Ops Hours', 158.56],
      ['Billable Earnings', 19168],
      // McClure's "Dec 2024" tab header: "Estimated hour (Val)" instead of
      // "Hrs Estimate (Val)" — deliberately does not match either marker.
      [32, 'Client', 'Estimated hour (Val)', 'Hourly', 'Rollover', 'Sam', 'Colin', 'Miika',
        'Billables', 'Fees', 'Fees Notes', '83(b) Elections', 'Invoiced', 'Deferred',
        'General Notes', 'Contact name', 'Contact email', '', 'Ops', 'Category', 'Date'],
    ];
    const result = resolveLayout(grid);
    assert.deepEqual(result, { signatureId: null });
  });

  test('empty grid -> signatureId null', () => {
    assert.deepEqual(resolveLayout([]), { signatureId: null });
    assert.deepEqual(resolveLayout(undefined), { signatureId: null });
  });

  test('recognized header row but uncatalogued column set still resolves — not conflated with signatureId:null', () => {
    // Real Jan25/Feb25 matrix tabs carry extra columns (Rollover, Colin,
    // Miika, Contact name/email, ...) the catalogue's simplified template
    // doesn't have. Column resolution is label-driven, so it still works.
    const header = ['Client', 'Hrs Estimate (Val)', 'Hourly', 'Rollover', 'Sam', 'Colin',
      'Miika', 'Billables', 'Fees', 'Fees Notes', '83(b) Elections', 'Invoiced', 'Deferred',
      'General Notes', 'Contact name', 'Contact email', '', 'Ops', 'Category', 'Date'];
    const result = resolveLayout(gridWithHeaderAt(header, 8));
    assert.notEqual(result.signatureId, null);
    assert.ok(result.signatureId.startsWith('custom:'));
    assert.equal(result.layout, 'client-matrix');
    assert.equal(result.columns.earnings, 7); // Billables
  });
});

describe('resolveTabToMonth', () => {
  test('"July" matches (mcclure-2025 is a registered 2025 book)', () => {
    const result = resolveTabToMonth('mcclure-2025', 'July');
    assert.deepEqual(result, { monthKey: '2025-07', status: 'matched', reason: null });
  });

  test('"July25" is ignored as a duplicate of "July"', () => {
    const result = resolveTabToMonth('mcclure-2025', 'July25');
    assert.equal(result.status, 'ignored');
    assert.equal(result.monthKey, null);
    assert.match(result.reason, /duplicate of "July"/);
    assert.match(result.reason, /the sync used "July"/);
  });

  test('"Copy of June25" is ignored as a duplicate backup', () => {
    const result = resolveTabToMonth('mcclure-2025', 'Copy of June25');
    assert.equal(result.status, 'ignored');
    assert.equal(result.monthKey, null);
    assert.match(result.reason, /duplicate/);
  });

  test('"Dec 2024" is unparseable', () => {
    const result = resolveTabToMonth('mcclure-2025', 'Dec 2024');
    assert.equal(result.status, 'unparseable');
    assert.equal(result.monthKey, null);
  });

  test('"Jan25".."June25" all match 2025-01..2025-06 via the generic parser (no override needed)', () => {
    const expected = {
      Jan25: '2025-01', Feb25: '2025-02', Mar25: '2025-03',
      Apr25: '2025-04', May25: '2025-05', June25: '2025-06',
    };
    for (const [tab, monthKey] of Object.entries(expected)) {
      const result = resolveTabToMonth('mcclure-2025', tab);
      assert.equal(result.status, 'matched', `${tab} should match`);
      assert.equal(result.monthKey, monthKey);
    }
  });

  test('bare month name in a 2026 book resolves against that workbook\'s year', () => {
    const result = resolveTabToMonth('vanloon-2026', 'July');
    assert.deepEqual(result, { monthKey: '2026-07', status: 'matched', reason: null });
  });

  test('bare month name in a 2025 book resolves against that workbook\'s year', () => {
    const result = resolveTabToMonth('ohta-2025', 'September');
    assert.deepEqual(result, { monthKey: '2025-09', status: 'matched', reason: null });
  });

  test('unknown workbook key with a parseable tab name still resolves month-only (no year) -> unparseable', () => {
    const result = resolveTabToMonth('not-a-real-workbook', 'March');
    assert.equal(result.status, 'unparseable');
    assert.equal(result.monthKey, null);
  });

  test('garbage tab name is unparseable', () => {
    const result = resolveTabToMonth('vanloon-2026', 'Q3 Notes');
    assert.equal(result.status, 'unparseable');
    assert.equal(result.monthKey, null);
  });

  test('TAB_MONTH_OVERRIDES entries are frozen and take precedence over the generic parser', () => {
    assert.ok(Object.isFrozen(TAB_MONTH_OVERRIDES));
    assert.ok(Object.isFrozen(TAB_MONTH_OVERRIDES['mcclure-2025']));
    // "July25" would otherwise generic-parse cleanly to 2025-07, colliding
    // with "July" — the override is what prevents that collision.
    assert.notEqual(resolveTabToMonth('mcclure-2025', 'July25').monthKey, '2025-07');
  });
});
