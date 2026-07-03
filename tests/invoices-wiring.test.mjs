import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHS12,
  EXP_ROWS,
  expenseMonthTotal,
  expenseCat,
  PAYMENT_ROWS,
  cashReceivedMonth,
  MONTH_DATA,
  MONTH_INDEX,
  INDEX_KEY,
  REAL_MONTH_KEYS,
  REAL_MONTH_DATA,
  DUMMY_CASH_ROWS,
  REAL_CASH_ROWS,
  deriveCashRows,
  DUMMY_PNL_LINES,
  DUMMY_PNL,
  REAL_PNL,
  REAL_WORKBOOK,
} from '../src/utils/invoicesTestData.mjs';
import { computeMonthlyWaterfall, computeCashProfits, sumWhereMonth } from '../src/utils/invoicesCalc.mjs';

// ===========================================================================
// CROSS-TAB WIRING invariants — verifies the dependency graph between the
// Invoices (testing) sub-tabs (which cell feeds which), on BOTH datasets.
// The calc functions are tested elsewhere; this guards the plumbing.
// ===========================================================================

const near = (actual, expected, eps = 0.02, msg = '') =>
  assert.ok(Math.abs(actual - expected) <= eps, `${msg} expected ${expected}, got ${actual}`);

// 'Misc Expenses' is both a section header (no vals) and a line — match lines only.
const row = (pnl, label) => pnl.rows.find((r) => r.label === label && r.vals);

test('dummy: month waterfalls are derived from their own matrix/rate-table totals', () => {
  for (const [key, data] of Object.entries(MONTH_DATA)) {
    const wf = computeMonthlyWaterfall(data.inputs);
    for (const [k, v] of Object.entries(wf)) near(data.waterfall[k], v, 0.001, `${key}.${k}:`);
    // inputs really are the matrix column totals
    near(data.inputs.attorneyBillables, data.matrix.reduce((s, r) => s + r.sumBillables, 0), 0.001, `${key} billables:`);
    near(data.inputs.attorneyPayout, data.rateTable.reduce((s, r) => s + r.billableEarnings, 0), 0.001, `${key} payout:`);
    // month OpEx (B15) ← that month's Expenses V2 total ('Cash Accounting Summary'!C-ref)
    near(data.inputs.opEx, expenseMonthTotal(MONTH_INDEX[key]), 0.001, `${key} opEx:`);
  }
});

test('dummy: Cash Accounting columns pull from the right tabs', () => {
  DUMMY_CASH_ROWS.forEach((r, m) => {
    // Cash Received ← Payment Status register, by Date Received month (SUMIFS)
    near(r.cashReceived, sumWhereMonth(PAYMENT_ROWS, 'dateReceived', 'amount', m, 2026), 0.001, `${r.month} cashReceived:`);
    near(r.cashReceived, cashReceivedMonth(m), 0.001, `${r.month} cashReceived helper:`);
    // Expenses ← Expenses V2 month total
    near(r.expenses, expenseMonthTotal(m), 0.001, `${r.month} expenses:`);
    // Attorney Payout ← PRIOR month's accrual payout (1 month in arrears)
    const prevKey = INDEX_KEY[m - 1];
    const expectedPayout = prevKey && MONTH_DATA[prevKey] ? MONTH_DATA[prevKey].inputs.attorneyPayout : 0;
    near(r.attorneyPayout, expectedPayout, 0.001, `${r.month} payout arrears:`);
    // Revenue ← that month tab's Revenue (Accrued) (INDIRECT(month!B10))
    const key = INDEX_KEY[m];
    if (key && MONTH_DATA[key]) near(r.revenueAccrued, MONTH_DATA[key].waterfall.revenueAccrued, 0.001, `${r.month} revenue link:`);
  });
});

test('dummy: derived cash Profits & Q Revenue follow the sheet formulas', () => {
  const derived = deriveCashRows(DUMMY_CASH_ROWS);
  derived.forEach((r, m) => {
    if (r.filled) near(r.profits, computeCashProfits(r), 0.001, `${r.month} profits:`);
    if (m % 3 === 2 && r.qRevenue != null) {
      const q = (derived[m - 2].revenueAccrued || 0) + (derived[m - 1].revenueAccrued || 0) + (derived[m].revenueAccrued || 0);
      near(r.qRevenue, q, 0.001, `${r.month} qRevenue:`);
    }
  });
});

test('dummy: P&L pulls Revenue from Cash Received and expenses from Expenses V2 categories', () => {
  // Revenue row ← Cash Accounting Cash Received
  const rev = row(DUMMY_PNL, 'Revenue');
  rev.vals.forEach((v, m) => near(v, DUMMY_CASH_ROWS[m].cashReceived, 0.001, `${MONTHS12[m]} pnl revenue:`));
  // Every expense line ← SUMIF of the tagged vendors in Expenses V2
  const lineChecks = [
    ['DocuSign, Asana, Google, Etc.', 'Software & Technology'],
    ['Malpractice Insurance', 'Malpractice Insurance'],
    ['Franchise Taxes', 'Franchise Taxes'],
    ['Filing Fees', 'Filing Fees'],
    ['Reimbursements', 'Reimbursements'],
    ['Misc Expenses', 'Misc Expenses'],
    ['Outside Counsel', 'Outside Counsel'],
    ['Payroll Taxes', 'Payroll Taxes'],
    ['Cedar Grove Foundation', 'Cedar Grove Foundation'],
  ];
  for (const [label, cat] of lineChecks) {
    const line = row(DUMMY_PNL, label);
    line.vals.forEach((v, m) => near(v, expenseCat(cat, m), 0.001, `${label} ${MONTHS12[m]}:`));
  }
  // Attorneys line ← Cash Accounting payout column
  row(DUMMY_PNL, 'Attorneys').vals.forEach((v, m) => near(v, DUMMY_CASH_ROWS[m].attorneyPayout, 0.001, `attorneys ${MONTHS12[m]}:`));
});

const checkPnlIdentities = (pnl, lines, n, tag) => {
  // TOTAL EXPENSES = sum of the section totals (recomputed independently here)
  const sections = ['Software & Technology', 'Legal & Professional', 'Attorney Reimbursements', 'Misc Expenses', 'Outside Counsel Expenses', 'Attorney Payout', 'Consultants (1099)', 'Employee-Related Expenses'];
  const totalsRows = pnl.rows.filter((r) => r.t === 'lineTotal');
  assert.equal(totalsRows.length, sections.length + 1, `${tag}: one Total per section + CGF`); // +1 CGF total
  const totalExp = row(pnl, 'TOTAL EXPENSES');
  const cgfTot = totalsRows[totalsRows.length - 1];
  for (let m = 0; m < n; m++) {
    const sumSections = totalsRows.slice(0, -1).reduce((s, r) => s + (r.vals[m] || 0), 0);
    near(totalExp.vals[m], sumSections, 0.02, `${tag} TOTAL EXPENSES[${m}]:`);
    // NET INCOME = Revenue − Total Expenses − CGF
    const ni = row(pnl, 'NET INCOME').vals[m];
    near(ni, (lines.revenue[m] || 0) - totalExp.vals[m] - (cgfTot.vals[m] || 0), 0.02, `${tag} NET INCOME[${m}]:`);
  }
};

test('dummy: P&L internal identities (section totals → TOTAL EXPENSES → NET INCOME)', () => {
  checkPnlIdentities(DUMMY_PNL, DUMMY_PNL_LINES, 12, 'dummy');
});

test('real: P&L internal identities hold on the workbook dataset', () => {
  checkPnlIdentities(REAL_PNL, { revenue: REAL_WORKBOOK.pnl.lines.revenue }, 6, 'real');
});

test('real: Cash Accounting Revenue column links to the month waterfalls', () => {
  REAL_CASH_ROWS.forEach((r, m) => {
    const key = REAL_MONTH_KEYS[m];
    if (!key || !r.filled) { assert.equal(r.filled, false); return; }
    near(r.revenueAccrued, REAL_MONTH_DATA[key].waterfall.revenueAccrued, 0.001, `${r.month} revenue link:`);
  });
});

test('real: Cash Accounting payout matches the arrears pattern (Feb..Jun ← prior accrual payout)', () => {
  // In the workbook, Cash E(month) = prior month's accrual Attorney Payout (B13).
  const cashKeys = Object.keys(REAL_WORKBOOK.cash);
  for (let m = 1; m < cashKeys.length; m++) {
    const prev = cashKeys[m - 1];
    near(
      REAL_WORKBOOK.cash[cashKeys[m]].inputs.attorneyPayout,
      REAL_WORKBOOK.months[prev].sheet.attorneyPayout,
      0.02,
      `${cashKeys[m]} arrears:`,
    );
  }
});

test('wiring sanity: dummy sources are internally consistent', () => {
  // Expenses V2 rows cover 12 months each
  for (const r of EXP_ROWS) assert.equal(r.vals.length, 12);
  // Payment register: paid rows have Date Received, unpaid don't
  for (const r of PAYMENT_ROWS) {
    if (r.status === 'Paid') assert.ok(r.dateReceived instanceof Date, `${r.client} paid needs dateReceived`);
    else assert.equal(r.dateReceived, null, `${r.client} unpaid must not have dateReceived`);
  }
});
