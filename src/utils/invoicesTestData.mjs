// Data layer for the self-contained "Invoices (testing)" dashboard tab.
// Pure + Node-importable. buildRealDataset() turns a REAL_WORKBOOK-shaped
// object (a live fetch from /api/invoices-workbook, or the frozen snapshot
// fallback) into the view-ready structures, running every derived value through
// the same calc chain the sheet uses. The what-if sandbox edits are applied
// upstream by invoicesOverrides.resolveWorkbook before this runs.

import {
  computeMonthlyWaterfall,
  computeCashProfits,
  computeQuarterRevenue,
  computePaymentTotal,
  derivePnlNetIncome,
} from './invoicesCalc.mjs';
import { REAL_WORKBOOK } from './invoicesRealData.mjs';

export { REAL_WORKBOOK };

export const MONTHS12 = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Derive Profits + Q Revenue per Cash Accounting row (what the Cash tab renders).
export const deriveCashRows = (rows) => {
  const revenues = rows.map((r) => r.revenueAccrued || 0);
  return rows.map((r, m) => {
    const profits = r.filled ? computeCashProfits(r) : 0;
    const endOfQuarter = m % 3 === 2 && rows[m].filled && rows[m - 1].filled && rows[m - 2].filled;
    const qRevenue = endOfQuarter ? computeQuarterRevenue([revenues[m - 2], revenues[m - 1], revenues[m]]) : null;
    return { ...r, profits, qRevenue };
  });
};

// ===========================================================================
// DERIVED — P&L rows (section totals + NET INCOME computed from line inputs)
// ===========================================================================
export const buildPnlRows = (L, n) => {
  const add = (...arrs) => Array.from({ length: n }, (_, i) => arrs.reduce((s, a) => s + ((a && a[i]) || 0), 0));
  const swTot = add(L.software);
  const legalTot = add(L.malpractice, L.franchiseTaxes, L.filingFees);
  const reimbTot = add(L.reimbursements);
  const miscTot = add(L.misc);
  const ocTot = add(L.outsideCounsel);
  const payoutTot = add(L.attorneys);
  const consultTot = add(...Object.values(L.consultants));
  const empTot = add(L.payrollTaxes);
  const totalExp = add(swTot, legalTot, reimbTot, miscTot, ocTot, payoutTot, consultTot, empTot);
  const cgfTot = add(L.charitable, L.cedarGrove);
  const netIncome = Array.from({ length: n }, (_, i) => derivePnlNetIncome(L.revenue[i], totalExp[i], cgfTot[i]));
  return [
    { t: 'band', label: 'REVENUE' },
    { t: 'line', label: 'Revenue', vals: L.revenue },
    { t: 'total', label: 'TOTAL REVENUE', vals: L.revenue },
    { t: 'band', label: 'EXPENSES' },
    { t: 'sub', label: 'Software & Technology' },
    { t: 'line', label: 'DocuSign, Asana, Google, Etc.', vals: L.software },
    { t: 'lineTotal', label: 'Total', vals: swTot },
    { t: 'sub', label: 'Legal & Professional' },
    { t: 'line', label: 'Malpractice Insurance', vals: L.malpractice },
    { t: 'line', label: 'Franchise Taxes', vals: L.franchiseTaxes },
    { t: 'line', label: 'Filing Fees', vals: L.filingFees },
    { t: 'lineTotal', label: 'Total', vals: legalTot },
    { t: 'sub', label: 'Attorney Reimbursements' },
    { t: 'line', label: 'Reimbursements', vals: L.reimbursements },
    { t: 'lineTotal', label: 'Total', vals: reimbTot },
    { t: 'sub', label: 'Misc Expenses' },
    { t: 'line', label: 'Misc Expenses', vals: L.misc },
    { t: 'lineTotal', label: 'Total', vals: miscTot },
    { t: 'sub', label: 'Outside Counsel Expenses' },
    { t: 'line', label: 'Outside Counsel', vals: L.outsideCounsel },
    { t: 'lineTotal', label: 'Total', vals: ocTot },
    { t: 'sub', label: 'Attorney Payout' },
    { t: 'line', label: 'Attorneys', vals: L.attorneys },
    { t: 'lineTotal', label: 'Total', vals: payoutTot },
    { t: 'sub', label: 'Consultants (1099)' },
    ...Object.entries(L.consultants).map(([label, vals]) => ({ t: 'line', label, vals })),
    { t: 'lineTotal', label: 'Total', vals: consultTot },
    { t: 'sub', label: 'Employee-Related Expenses' },
    { t: 'line', label: 'Payroll Taxes', vals: L.payrollTaxes },
    { t: 'lineTotal', label: 'Total Employee-Related', vals: empTot },
    { t: 'grand', label: 'TOTAL EXPENSES', vals: totalExp },
    { t: 'sub', label: 'CGF Donations' },
    { t: 'line', label: 'Charitable Donations', vals: L.charitable },
    { t: 'line', label: 'Cedar Grove Foundation', vals: L.cedarGrove },
    { t: 'lineTotal', label: 'Total', vals: cgfTot },
    { t: 'grand', label: 'NET INCOME', vals: netIncome },
  ];
};

// ===========================================================================
// Dataset factory — turns a REAL_WORKBOOK-shaped object (a live fetch from
// /api/invoices-workbook, or the frozen snapshot fallback) into the view-ready
// structures. Everything derived flows through the calc chain. Pure + tested.
// ===========================================================================
const parseISO = (s) => (s ? new Date(`${s}T00:00:00`) : null);

// One month tab → inputs + recomputed waterfall + detail (matrix/rate table).
// A resolvedWaterfall (from the sandbox override resolver) wins so pinned
// derived cells survive; otherwise the waterfall is recomputed from inputs.
const realMonthDetail = (entry) => ({
  inputs: entry.inputs,
  waterfall: entry.resolvedWaterfall || computeMonthlyWaterfall(entry.inputs),
  sheetErrors: entry.sheetErrors || {},
  attorneys: entry.matrix ? entry.matrix.attorneys : undefined,
  matrix: entry.matrix ? entry.matrix.rows : undefined,
  matrixTotalRows: entry.matrix ? entry.matrix.totalRows : undefined,
  rateHeaders: entry.attorneyTable ? entry.attorneyTable.headers : undefined,
  rateRows: entry.attorneyTable ? entry.attorneyTable.rows : undefined,
});

// The register has no payment-terms column (terms live in the clients sheet /
// Firestore), so paymentTerms falls back to null — reminder cadence uses the
// non-Net-30 default and overdue math is skipped. Accepts ISO strings or Dates.
const toDate = (v) => (v instanceof Date ? v : parseISO(v));
const parseRegister = (rows) => (rows || []).map((r) => ({
  ...r,
  dateSent: toDate(r.dateSent),
  lastReminder: toDate(r.lastReminder),
  dateReceived: toDate(r.dateReceived),
  paymentTerms: r.paymentTerms ?? null,
}));

export function buildRealDataset(workbook) {
  const monthKeys = Object.keys(workbook.months || {});
  const monthData = Object.fromEntries([
    ...monthKeys.map((k) => [k, realMonthDetail(workbook.months[k])]),
    ...Object.entries(workbook.monthsExtra || {}).map(([k, entry]) => [k, realMonthDetail(entry)]),
  ]);

  const cashRows = MONTHS12.map((name, m) => {
    const key = monthKeys[m];
    const cashEntry = key && workbook.cash && workbook.cash[key];
    if (!cashEntry) return { month: name, filled: false, cashReceived: 0, expenses: 0, cgfDonation: 0, attorneyPayout: 0, revenueAccrued: null };
    return { month: name, filled: true, ...cashEntry.inputs, revenueAccrued: monthData[key].waterfall.revenueAccrued };
  });

  const paymentRows = parseRegister(workbook.paymentRegister);
  const copyRows = parseRegister(workbook.paymentRegisterCopy);
  const pnlLines = { ...((workbook.pnl && workbook.pnl.lines) || {}), consultants: (workbook.pnl && workbook.pnl.consultants) || {} };
  const pnlN = ((pnlLines.revenue && pnlLines.revenue.length) || 6); // P&L tab carries Jan–Jun
  // P&L Revenue is cash-basis — on the sheet the Revenue row === Cash Accounting
  // Cash Received (verified bit-exact). Re-derive it from the (possibly
  // overridden) cash rows so a cash/register what-if edit propagates into P&L
  // Revenue → TOTAL REVENUE → NET INCOME (and thence Balance net income). Other
  // P&L lines (expense/consultant/CGF, and the manually-kept Attorney Payout
  // line) are independent sheet cells and stay at their cached values.
  if (Array.isArray(pnlLines.revenue)) {
    pnlLines.revenue = pnlLines.revenue.map((v, i) => (cashRows[i] && cashRows[i].filled ? cashRows[i].cashReceived : v));
  }

  return {
    monthKeys,
    monthData,
    profitsRows: workbook.profitsPaid || [],
    rateSheet: workbook.rateSheet || [],
    expenseRows: workbook.expenses || [],
    balanceRows: workbook.balanceSheet || [],
    paymentRows,
    paymentTotal: computePaymentTotal(paymentRows.map((r) => r.amount)),
    copyRows,
    copyTotal: computePaymentTotal(copyRows.map((r) => r.amount)),
    cashRows,
    pnlLines,
    pnl: { months: MONTHS12.slice(0, pnlN), rows: buildPnlRows(pnlLines, pnlN) },
  };
}

// Frozen dataset (backs the existing named exports + tests; identical values).
// Also exported whole so the tab can fall back to it when a live fetch fails.
export const FROZEN_REAL_DATASET = buildRealDataset(REAL_WORKBOOK);
const FROZEN = FROZEN_REAL_DATASET;
export const REAL_MONTH_KEYS = FROZEN.monthKeys;
export const REAL_MONTH_DATA = FROZEN.monthData;
export const REAL_PROFITS_ROWS = FROZEN.profitsRows;
export const REAL_RATE_SHEET = FROZEN.rateSheet;
export const REAL_EXPENSE_ROWS = FROZEN.expenseRows;
export const REAL_BALANCE_ROWS = FROZEN.balanceRows;
export const REAL_PAYMENT_ROWS = FROZEN.paymentRows;
export const REAL_PAYMENT_TOTAL = FROZEN.paymentTotal;
export const REAL_PAYMENT_COPY_ROWS = FROZEN.copyRows;
export const REAL_PAYMENT_COPY_TOTAL = FROZEN.copyTotal;
export const REAL_CASH_ROWS = FROZEN.cashRows;
export const REAL_PNL_LINES = FROZEN.pnlLines;
export const REAL_PNL = FROZEN.pnl;
