import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlyWaterfall,
  computeCashProfits,
  computeQuarterRevenue,
  derivePnlNetIncome,
} from '../src/utils/invoicesCalc.mjs';
import {
  buildPnlRows,
  REAL_PNL_LINES,
  REAL_PAYMENT_ROWS,
  REAL_PAYMENT_TOTAL,
} from '../src/utils/invoicesTestData.mjs';
import { sumWhereMonth, computeRowSumBillables } from '../src/utils/invoicesCalc.mjs';
import { REAL_WORKBOOK } from '../src/utils/invoicesRealData.mjs';

// ===========================================================================
// EXHAUSTIVE WORKBOOK DIFF — recomputes EVERY derived cell from the workbook's
// inputs using our calc chain and compares against the sheet's own cached
// values (captured by scripts/extract-invoices-workbook.py).
//
// This catches both kinds of divergence:
//   • our logic drifting from the sheet, and
//   • the SHEET's formulas changing under us (e.g. the CGF rate) — re-run the
//     extractor on a fresh export and this suite re-verifies everything.
// ===========================================================================

const near = (actual, expected, eps = 0.02, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);

const MONTHS = Object.keys(REAL_WORKBOOK.months);
const DERIVED_WF_KEYS = ['gross', 'netAccrued', 'revenueAccrued', 'cgfDonation', 'revenueMinusCgf', 'netRevenueBeforeOpEx', 'firmProfits'];

test(`workbook snapshot present (${REAL_WORKBOOK.source}, ${REAL_WORKBOOK.extractedOn})`, () => {
  assert.ok(MONTHS.length >= 6, 'expected at least Jan–Jun');
});

for (const m of MONTHS) {
  test(`waterfall ${m}: every derived cell matches the sheet`, () => {
    const { inputs, sheet } = REAL_WORKBOOK.months[m];
    const errs = REAL_WORKBOOK.months[m].sheetErrors || {};
    const wf = computeMonthlyWaterfall(inputs);
    // Cells the sheet itself shows as errors (July #VALUE!) can't be compared.
    for (const k of DERIVED_WF_KEYS) { if (!errs[k]) near(wf[k], sheet[k], 0.02, `${m}.${k}:`); }
    // inputs should round-trip too (they're copied straight from the sheet)
    for (const k of Object.keys(inputs)) { if (!errs[k]) near(wf[k], sheet[k], 0.02, `${m}.${k} (input):`); }
  });

  test(`cash ${m}: Profits and Revenue match the sheet`, { skip: !REAL_WORKBOOK.cash[m] && `no cash row for ${m} in the sheet` }, () => {
    const { inputs, sheet } = REAL_WORKBOOK.cash[m];
    near(computeCashProfits(inputs), sheet.profits, 0.02, `${m}.profits:`);
    // Cash Revenue (G) = that month tab's accrual Revenue (INDIRECT(month!B10))
    near(REAL_WORKBOOK.months[m].sheet.revenueAccrued, sheet.revenue, 0.02, `${m}.revenue link:`);
  });
}

// --- Month-tab detail: client matrix + attorney table → waterfall inputs ------
const ALL_MONTH_TABS = { ...REAL_WORKBOOK.months, ...(REAL_WORKBOOK.monthsExtra || {}) };
for (const [key, entry] of Object.entries(ALL_MONTH_TABS)) {
  test(`matrix ${key}: column totals feed the waterfall inputs (L18→B4 etc.)`, { skip: !entry.matrix && 'no matrix captured' }, () => {
    const errs = entry.sheetErrors || {};
    const S = (f) => entry.matrix.rows.reduce((s, r) => s + (r[f] || 0), 0);
    const links = [
      ['sumBillables', 'attorneyBillables'],
      ['elections83b', 'flatFee83b'],
      ['filingFees', 'filingFees'],
      ['outsideCounsel', 'outsideCounsel'],
      ['deferredThisMonth', 'deferred'],
      ['writeOff', 'writeOffs'],
    ];
    for (const [field, input] of links) {
      if (errs[input]) continue; // the sheet cell itself is an error (e.g. July #VALUE!)
      near(S(field), entry.inputs[input], 0.02, `${key} ${field}→${input}:`);
    }
  });

  test(`matrix ${key}: every row's Sum Billables = Σ attorney cols + billed prior deferrals`, { skip: !entry.matrix && 'no matrix captured' }, () => {
    let overrides = 0;
    for (const r of entry.matrix.rows) {
      const expect = computeRowSumBillables(r.billings, r.priorDeferred, r.priorToggle);
      if (Math.abs(r.sumBillables - expect) > 0.01) {
        // A blanked-out L cell (manual override) is the only allowed exception.
        assert.equal(r.sumBillables, 0, `${key} ${r.client}: ${r.sumBillables} vs ${expect}`);
        overrides += 1;
      }
    }
    assert.ok(overrides <= 2, `${key}: too many manual overrides (${overrides})`);
  });

  test(`attorney table ${key}: Σ Billable Earnings = waterfall Attorney Payout (B13)`, { skip: !entry.attorneyTable && 'no table captured' }, () => {
    const idx = entry.attorneyTable.headers.indexOf('Billable Earnings');
    assert.ok(idx >= 0, `no Billable Earnings column in ${key}`);
    const sum = entry.attorneyTable.rows.reduce((s, r) => s + (typeof r.vals[idx] === 'number' ? r.vals[idx] : 0), 0);
    if (!(entry.sheetErrors || {}).attorneyPayout) near(sum, entry.inputs.attorneyPayout, 0.02, `${key} payout:`);
  });
}

test('0630 register copy: SUM(amounts) reproduces its B1 total', { skip: !REAL_WORKBOOK.paymentRegisterCopy && 'copy not captured' }, () => {
  const sum = REAL_WORKBOOK.paymentRegisterCopy.reduce((s, r) => s + r.amount, 0);
  near(sum, REAL_WORKBOOK.paymentTotalCopy, 0.02);
  assert.ok(REAL_WORKBOOK.paymentRegisterCopy.length >= 400);
});

test('cash: Q Revenue cells match quarter sums of accrual Revenue', () => {
  const cashKeys = Object.keys(REAL_WORKBOOK.cash);
  const rev = (m) => REAL_WORKBOOK.cash[m].sheet.revenue;
  for (let i = 0; i < cashKeys.length; i++) {
    const q = REAL_WORKBOOK.cash[cashKeys[i]].sheet.qRevenue;
    if (q == null) continue;
    near(computeQuarterRevenue([rev(cashKeys[i - 2]), rev(cashKeys[i - 1]), rev(cashKeys[i])]), q, 0.02, `${cashKeys[i]} qRevenue:`);
  }
});

test('Profits Paid ledger: captured, well-formed, newest-first', { skip: !REAL_WORKBOOK.profitsPaid && 'snapshot predates ledger capture — re-run the extractor' }, () => {
  const ledger = REAL_WORKBOOK.profitsPaid;
  assert.ok(ledger.length >= 13, `expected the full ledger, got ${ledger.length} rows`);
  for (const row of ledger) {
    assert.match(row.date, /^\d{2}-\d{2}-\d{4}$/, `date format: ${row.date}`);
    assert.ok(row.amount < 0, `payouts are negative: ${row.date} ${row.amount}`);
    assert.ok(['', 'green', 'tan'].includes(row.highlight), `highlight: ${row.highlight}`);
  }
  // newest-first ordering, like the sheet
  const ts = ledger.map((r) => new Date(`${r.date.slice(6)}-${r.date.slice(0, 2)}-${r.date.slice(3, 5)}`).getTime());
  for (let i = 1; i < ts.length; i++) assert.ok(ts[i - 1] >= ts[i], `ledger out of order at row ${i}`);
});

// --- Payment Status register ------------------------------------------------
test('payment register: SUM(amounts) reproduces the sheet B1 total', { skip: !REAL_WORKBOOK.paymentRegister && 'snapshot predates register capture' }, () => {
  near(REAL_PAYMENT_TOTAL, REAL_WORKBOOK.paymentTotal, 0.02);
  assert.ok(REAL_PAYMENT_ROWS.length >= 400, `expected the full register, got ${REAL_PAYMENT_ROWS.length}`);
  const known = new Set(['Paid', 'Not Paid', 'Payment Initiated', 'Write Off']);
  for (const r of REAL_PAYMENT_ROWS) assert.ok(known.has(r.status), `unknown status: ${r.status}`);
});

test('payment register → Cash Received: SUMIFS by Date Received reproduces every month', { skip: !REAL_WORKBOOK.paymentRegister && 'snapshot predates register capture' }, () => {
  Object.keys(REAL_WORKBOOK.cash).forEach((m, i) => {
    near(
      sumWhereMonth(REAL_PAYMENT_ROWS, 'dateReceived', 'amount', i, 2026),
      REAL_WORKBOOK.cash[m].inputs.cashReceived,
      0.02,
      `${m} cashReceived:`,
    );
  });
});

// --- Expenses V2 → P&L SUMIF lines -------------------------------------------
test('Expenses V2 tags reproduce the P&L SUMIF lines (Jan–Mar)', { skip: !REAL_WORKBOOK.expenses && 'snapshot predates expenses capture' }, () => {
  const byTag = (tag, m) => REAL_WORKBOOK.expenses.filter((r) => r.pnlCat === tag).reduce((s, r) => s + r.vals[m], 0);
  const checks = [
    ['software', 'Software & Technology'],
    ['malpractice', 'Malpractice Insurance'],
    ['franchiseTaxes', 'Franchise Taxes'],
    ['filingFees', 'Filing Fees'],
    ['reimbursements', 'Reimbursements'],
    ['misc', 'Misc Expenses'],
    ['outsideCounsel', 'Outside Counsel'],
    ['payrollTaxes', 'Payroll Taxes'],
  ];
  for (const [key, tag] of checks) {
    for (let m = 0; m < 3; m++) {
      near(byTag(tag, m), REAL_WORKBOOK.pnl.lines[key][m], 0.02, `${key}[${m}]:`);
    }
  }
  for (const name of ['Valyria', 'Valery Uscanga', 'Accountants']) {
    for (let m = 0; m < 3; m++) {
      near(byTag(name, m), REAL_WORKBOOK.pnl.consultants[name][m], 0.02, `${name}[${m}]:`);
    }
  }
});

// --- Rate Sheet ---------------------------------------------------------------
test('rate sheet: full ladder captured; client rates ascend; C5B→P1B attorney-rate +12.5 chain', { skip: !REAL_WORKBOOK.rateSheet && 'snapshot predates rate-sheet capture' }, () => {
  const rows = REAL_WORKBOOK.rateSheet;
  assert.equal(rows.length, 20, 'A1..P2 × A/B tiers');
  assert.equal(rows[0].level, 'A1');
  assert.equal(rows[19].level, 'P2');
  for (let i = 1; i < rows.length; i++) assert.ok(rows[i].clientRate >= rows[i - 1].clientRate, `client rate dips at ${rows[i].level}${rows[i].tier}`);
  // Sheet formulas D15..D19 are =prev+12.5 (indices 13..17)
  for (let i = 13; i <= 17; i++) near(rows[i].attorneyRate, rows[i - 1].attorneyRate + 12.5, 0.001, `attorneyRate chain @${rows[i].level}${rows[i].tier}:`);
});

// --- Balance Sheet --------------------------------------------------------------
test('balance sheet: total formulas hold on captured values', { skip: !REAL_WORKBOOK.balanceSheet && 'snapshot predates balance-sheet capture' }, () => {
  const rows = REAL_WORKBOOK.balanceSheet;
  const val = (label) => {
    const r = rows.find((x) => x.label === label);
    return typeof r?.value === 'number' ? r.value : 0;
  };
  const assets = ['Cash - Operating Account', 'Cash - Savings', 'Accounts Receivable - Client Fees', 'Other Current Assets'];
  near(val('Total Current Assets'), assets.reduce((s, l) => s + val(l), 0), 0.02, 'current assets total:');
  near(val('TOTAL ASSETS'), val('Total Current Assets'), 0.02, 'total assets:');
  near(val('TOTAL LIABILITIES'), val('Total Current Liabilities') + val('Total Long-term Liabilities'), 0.02, 'total liabilities:');
});

test('P&L: recomputed grid matches the sheet row-for-row', () => {
  const n = REAL_WORKBOOK.pnl.lines.revenue.length;
  const rows = buildPnlRows(REAL_PNL_LINES, n);
  const rowByLabel = (label) => rows.find((r) => r.label === label);
  const sheet = REAL_WORKBOOK.pnl.sheet;
  for (let i = 0; i < n; i++) {
    near(rowByLabel('TOTAL REVENUE').vals[i], sheet.totalRevenue[i], 0.02, `totalRevenue[${i}]:`);
    near(rowByLabel('TOTAL EXPENSES').vals[i], sheet.totalExpenses[i], 0.02, `totalExpenses[${i}]:`);
    near(rowByLabel('NET INCOME').vals[i], sheet.netIncome[i], 0.02, `netIncome[${i}]:`);
    near(
      derivePnlNetIncome(sheet.totalRevenue[i], sheet.totalExpenses[i], sheet.cgfTotal[i]),
      sheet.netIncome[i], 0.02, `netIncome identity[${i}]:`,
    );
  }
});
