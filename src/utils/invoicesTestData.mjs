// Data layer for the self-contained "Invoices (testing)" dashboard tab.
// Pure + Node-importable so tests can verify the CROSS-TAB WIRING (which cell
// feeds which) — not just the calc functions in invoicesCalc.mjs.
//
// Two datasets:
//   • Dummy — generated placeholder inputs, wired together like the workbook's
//     cross-sheet references (Expenses → Cash → P&L; month waterfalls → Cash).
//   • Real (Jan–Jun) — actual workbook figures from invoicesRealData.mjs
//     (regenerate with scripts/extract-invoices-workbook.py).

import {
  computeMonthlyWaterfall,
  computeCashProfits,
  computeQuarterRevenue,
  computePaymentTotal,
  sumRowBillables,
  sumColumn,
  sumWhereMonth,
  derivePnlNetIncome,
} from './invoicesCalc.mjs';
import { REAL_WORKBOOK } from './invoicesRealData.mjs';

export { REAL_WORKBOOK };

export const MONTHS12 = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const dNum = (i) => 1000 * ((i % 12) + 1);
const D = (y, m, d) => new Date(y, m - 1, d);

// ===========================================================================
// SOURCE 1 — Expenses V2 (feeds Cash Accounting expenses + P&L expense lines)
// ===========================================================================
const EXP_SOURCE = [
  { category: 'DocuSign', label: 'DOCUSIGN', pnlCat: 'Software & Technology', seed: 1 },
  { category: 'Google Workspace', label: 'GOOGLE', pnlCat: 'Software & Technology', seed: 2 },
  { category: 'AMBA (Malpractice)', label: 'AMBA ADMINISTRATORS', pnlCat: 'Malpractice Insurance', seed: 3 },
  { category: 'Franchise Tax Board', label: 'FTB', pnlCat: 'Franchise Taxes', seed: 4 },
  { category: 'Court Filing Fees', label: 'SoS / PACER', pnlCat: 'Filing Fees', seed: 5 },
  { category: 'Attorney Reimb.', label: 'Reimbursements', pnlCat: 'Reimbursements', seed: 6 },
  { category: 'Miscellaneous', label: 'Misc', pnlCat: 'Misc Expenses', seed: 7 },
  { category: 'Co-Counsel', label: 'Outside Counsel', pnlCat: 'Outside Counsel', seed: 8 },
  { category: 'Valyria', label: 'Send Money', pnlCat: 'Valyria', seed: 9 },
  { category: 'Valery Uscanga', label: 'Send Money', pnlCat: 'Valery Uscanga', seed: 10 },
  { category: 'Martyna Skrodzka', label: 'Send Money', pnlCat: 'Martyna Skrodzka', seed: 11 },
  { category: 'Nick Agate', label: 'Send Money', pnlCat: 'Nick Agate', seed: 12 },
  { category: 'David Popkin', label: 'Send Money', pnlCat: 'David Popkin', seed: 13 },
  { category: 'Paige Wilson', label: 'Send Money', pnlCat: 'Paige Wilson', seed: 14 },
  { category: 'Accountants', label: 'Bookkeeping', pnlCat: 'Accountants', seed: 15 },
  { category: 'GUSTO (Payroll Taxes)', label: 'GUSTO; NET', pnlCat: 'Payroll Taxes', seed: 16, highlight: true },
  { category: 'Charitable Donations', label: 'Donation', pnlCat: 'Charitable Donations', seed: 17 },
  { category: 'Cedar Grove Foundation', label: 'CGF', pnlCat: 'Cedar Grove Foundation', seed: 18 },
];
const expVals = (seed) => Array.from({ length: 12 }, (_, m) => (m < 7 ? dNum(seed + m) : 0));
export const EXP_ROWS = EXP_SOURCE.map((r) => ({ ...r, vals: expVals(r.seed) }));
export const expenseMonthTotal = (m) => sumColumn(EXP_ROWS.map((r) => r.vals[m]));
export const expenseCat = (catName, m) => sumColumn(EXP_ROWS.filter((r) => r.pnlCat === catName).map((r) => r.vals[m]));

// ===========================================================================
// SOURCE 2 — Payment Status register (feeds Cash Received via Date Received)
// ===========================================================================
export const PAYMENT_ROWS = [
  { client: 'Client B', amount: 9200, year: 2026, dateSent: D(2026, 1, 3), paymentTerms: 15, status: 'Paid', lastReminder: null, dateReceived: D(2026, 1, 20), notes: '' },
  { client: 'Client C', amount: 12400, year: 2026, dateSent: D(2026, 1, 10), paymentTerms: 30, status: 'Paid', lastReminder: null, dateReceived: D(2026, 2, 12), notes: '' },
  { client: 'Client D', amount: 8600, year: 2026, dateSent: D(2026, 2, 5), paymentTerms: 15, status: 'Paid', lastReminder: null, dateReceived: D(2026, 2, 25), notes: '' },
  { client: 'Client E', amount: 15100, year: 2026, dateSent: D(2026, 3, 1), paymentTerms: 30, status: 'Paid', lastReminder: null, dateReceived: D(2026, 3, 20), notes: '' },
  { client: 'Client F', amount: 7300, year: 2026, dateSent: D(2026, 4, 2), paymentTerms: 15, status: 'Paid', lastReminder: null, dateReceived: D(2026, 4, 18), notes: '' },
  { client: 'Client G', amount: 11200, year: 2026, dateSent: D(2026, 5, 6), paymentTerms: 30, status: 'Paid', lastReminder: null, dateReceived: D(2026, 5, 22), notes: '' },
  { client: 'Client H', amount: 9800, year: 2026, dateSent: D(2026, 6, 15), paymentTerms: 30, status: 'Paid', lastReminder: null, dateReceived: D(2026, 6, 30), notes: '' },
  { client: 'Client I', amount: 6400, year: 2026, dateSent: D(2026, 7, 1), paymentTerms: 15, status: 'Paid', lastReminder: null, dateReceived: D(2026, 7, 14), notes: '' },
  { client: 'Client A', amount: 3480, year: 2026, dateSent: D(2026, 5, 20), paymentTerms: 30, status: 'Not Paid', lastReminder: null, dateReceived: null, notes: '' },
  { client: 'Client C', amount: 1210, year: 2026, dateSent: D(2026, 6, 10), paymentTerms: 30, status: 'Payment Initiated', lastReminder: D(2026, 7, 11), dateReceived: null, notes: 'Net 30' },
  { client: 'Client D', amount: 2020, year: 2026, dateSent: D(2026, 6, 25), paymentTerms: 15, status: 'Not Paid', lastReminder: D(2026, 7, 11), dateReceived: null, notes: '' },
  { client: 'Client E', amount: 825, year: 2025, dateSent: D(2026, 5, 1), paymentTerms: 15, status: 'Write Off', lastReminder: D(2026, 6, 1), dateReceived: null, notes: 'Not paid as of 8/8' },
  { client: 'Client F', amount: 715, year: 2026, dateSent: D(2026, 7, 2), paymentTerms: 30, status: 'Not Paid', lastReminder: null, dateReceived: null, notes: '' },
  { client: 'Client H', amount: 300, year: 2026, dateSent: D(2026, 6, 28), paymentTerms: 15, status: 'Payment Initiated', lastReminder: null, dateReceived: null, notes: '' },
];
export const PAYMENT_TOTAL = computePaymentTotal(PAYMENT_ROWS.map((r) => r.amount));
export const cashReceivedMonth = (m) => sumWhereMonth(PAYMENT_ROWS, 'dateReceived', 'amount', m, 2026);

// ===========================================================================
// SOURCE 3 — Month tabs (matrix + rate table → waterfall)
// ===========================================================================
const FULL_NAME = {
  Sam: 'Sam McClure', Colin: 'Colin van Loon', 'Michael O': 'Michael Ohta (W2)',
  Michael: 'Michael Ohta (W2)', Molly: 'Molly Manning (W2)', 'Michael L': 'Michael Levin (W2)',
  Valery: 'Valery Uscanga (1099)', David: 'David Popkin (1099)', Nick: 'Nick Agate (1099)',
  Paige: 'Paige Wilson (1099)', Martyna: 'Martyna Skrodzka (1099)',
};
export const MONTH_ATTORNEYS = {
  july: ['Sam', 'Colin', 'Michael O', 'Molly', 'Michael L', 'Valery', 'David', 'Nick', 'Paige', 'Martyna'],
  june: ['Sam', 'Colin', 'Michael O', 'Molly', 'Michael L', 'Valery', 'David', 'Nick', 'Paige', 'Martyna'],
  'june-original': ['Sam', 'Colin', 'Michael O', 'Molly', 'Michael L', 'Valery', 'David', 'Nick', 'Paige', 'Martyna'],
  may: ['Sam', 'Michael O', 'Colin', 'Nick', 'David', 'Paige', 'Valery', 'Martyna', 'Michael L'],
  april: ['Sam', 'Michael', 'Colin', 'Nick', 'David', 'Paige', 'Valery', 'Martyna'],
  march: ['Sam', 'Michael', 'Colin', 'Nick', 'David', 'Paige', 'Valery', 'Martyna'],
  february: ['Sam', 'Michael', 'Colin', 'Nick', 'David', 'Paige', 'Valery'],
  january: ['Sam', 'Michael', 'Colin', 'Nick', 'David', 'Paige'],
};
const MONTH_SEED = { july: 7, june: 6, 'june-original': 6, may: 5, april: 4, march: 3, february: 2, january: 1 };
export const MONTH_INDEX = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, 'june-original': 5 };
export const INDEX_KEY = ['january', 'february', 'march', 'april', 'may', 'june', 'july'];

const buildMatrix = (attorneys, seed) =>
  Array.from({ length: 14 }, (_, i) => {
    const billings = attorneys.map((_, j) => ((i + j + seed) % 5 === 0 ? dNum(i + j) : 0));
    const sumBillables = sumRowBillables(billings);
    const filingFees = i % 5 === 2 ? dNum(i) : 0;
    const outsideCounsel = i % 7 === 3 ? dNum(i) : 0;
    const deferredThisMonth = i % 6 === 4 ? dNum(i) : 0;
    const writeOff = i % 9 === 5 ? dNum(i) : 0;
    return {
      client: `Client ${String.fromCharCode(65 + i)}`, billings, sumBillables,
      elections83b: i % 6 === 0 ? 250 * ((i % 4) + 1) : 0, filingFees, feesNotes: '',
      outsideCounsel, ocNotes: '', priorDeferred: 0, priorToggle: '', deferredThisMonth,
      totalDeferred: deferredThisMonth, writeOff, invoiced: sumBillables + filingFees + outsideCounsel,
      generalNotes: '', contactName: i % 3 === 0 ? 'Jane Doe' : '', contactEmail: i % 3 === 0 ? 'jane@client.com' : '',
      paymentTerms: i % 2 === 0 ? 15 : 30,
    };
  });
const buildRateTable = (attorneys) =>
  attorneys.map((short, i) => ({
    name: FULL_NAME[short] || short, clientRate: 500 + i * 20, takeHome: 250 + i * 10,
    billableEarnings: dNum(i + 1), earnings83b: i % 4 === 0 ? 250 : 0,
    personalReimb: i % 3 === 0 ? dNum(i) : 0, check: i % 3 !== 0, diff: 0,
  }));

// Clone a month's structure and derive the waterfall inputs from the matrix /
// rate-table totals — the same L18/M18/... → B4/B5/... wiring the sheet uses.
export const buildMonthData = (attorneys, seed, opEx) => {
  const matrix = buildMatrix(attorneys, seed);
  const rateTable = buildRateTable(attorneys);
  const inputs = {
    attorneyBillables: sumColumn(matrix.map((r) => r.sumBillables)),
    flatFee83b: sumColumn(matrix.map((r) => r.elections83b)),
    filingFees: sumColumn(matrix.map((r) => r.filingFees)),
    outsideCounsel: sumColumn(matrix.map((r) => r.outsideCounsel)),
    writeOffs: sumColumn(matrix.map((r) => r.writeOff)),
    deferred: sumColumn(matrix.map((r) => r.deferredThisMonth)),
    attorneyPayout: sumColumn(rateTable.map((r) => r.billableEarnings)),
    opEx,
  };
  return { attorneys, matrix, rateTable, inputs, waterfall: computeMonthlyWaterfall(inputs) };
};

// Dummy months — OpEx (B15) pulls that month's Cash Accounting expenses.
export const MONTH_DATA = Object.fromEntries(
  Object.keys(MONTH_ATTORNEYS).map((key) => [key, buildMonthData(MONTH_ATTORNEYS[key], MONTH_SEED[key], expenseMonthTotal(MONTH_INDEX[key]))]),
);

// Profits Paid (Sam) — dummy ledger (real rows come from the workbook factory).
export const DUMMY_PROFITS_ROWS = Array.from({ length: 13 }, (_, i) => ({
  date: `0${(i % 6) + 1}-15-2026`,
  description: 'Sam',
  amount: -dNum(i),
  note: 'Sample note / memo',
  highlight: [0, 3, 6, 7].includes(i) ? 'green' : [10, 11].includes(i) ? 'tan' : '',
}));

// Derive Profits + Q Revenue per row (what the Cash tab renders). Shared by the
// dummy and real datasets.
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
// DERIVED — Cash Accounting rows (dummy). Attorney Payout is one month in
// arrears (Cash E(month) = prior month's accrual payout), matching the sheet.
// ===========================================================================
export const DUMMY_CASH_ROWS = MONTHS12.map((name, m) => {
  const key = INDEX_KEY[m];
  const prevKey = INDEX_KEY[m - 1];
  return {
    month: name, filled: m <= 6,
    cashReceived: cashReceivedMonth(m),
    expenses: expenseMonthTotal(m),
    cgfDonation: m === 0 ? 5000 : m === 3 ? 15000 : 0,
    attorneyPayout: prevKey && MONTH_DATA[prevKey] ? MONTH_DATA[prevKey].inputs.attorneyPayout : 0,
    revenueAccrued: key && MONTH_DATA[key] ? MONTH_DATA[key].waterfall.revenueAccrued : null,
  };
});

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

const line12 = (catName) => Array.from({ length: 12 }, (_, m) => expenseCat(catName, m));
export const DUMMY_PNL_LINES = {
  revenue: DUMMY_CASH_ROWS.map((r) => r.cashReceived),
  software: line12('Software & Technology'),
  malpractice: line12('Malpractice Insurance'),
  franchiseTaxes: line12('Franchise Taxes'),
  filingFees: line12('Filing Fees'),
  reimbursements: line12('Reimbursements'),
  misc: line12('Misc Expenses'),
  outsideCounsel: line12('Outside Counsel'),
  attorneys: DUMMY_CASH_ROWS.map((r) => r.attorneyPayout),
  consultants: {
    Valyria: line12('Valyria'), 'Valery Uscanga': line12('Valery Uscanga'), 'Martyna Skrodzka': line12('Martyna Skrodzka'),
    'Nick Agate': line12('Nick Agate'), 'David Popkin': line12('David Popkin'), 'Paige Wilson': line12('Paige Wilson'), Accountants: line12('Accountants'),
  },
  payrollTaxes: line12('Payroll Taxes'),
  charitable: line12('Charitable Donations'),
  cedarGrove: line12('Cedar Grove Foundation'),
};
export const DUMMY_PNL = { months: MONTHS12, rows: buildPnlRows(DUMMY_PNL_LINES, 12) };

// ===========================================================================
// DUMMY workbook — the dummy sources reshaped into the same REAL_WORKBOOK
// structure, so Dummy mode runs through the exact same override-resolver +
// dataset pipeline as Live mode (what-if edits behave identically).
// ===========================================================================
const RATE_LEVELS = [
  ['A1', 'A', false], ['A1', 'B', false], ['A2', 'A', false], ['A2', 'B', false],
  ['C1', 'A', false], ['C1', 'B', false], ['C2', 'A', false], ['C2', 'B', false],
  ['C3', 'A', false], ['C3', 'B', false], ['C4', 'A', false], ['C4', 'B', false],
  ['C5', 'A', false], ['C5', 'B', true], ['C6', 'A', true], ['C6', 'B', true],
  ['P1', 'A', true], ['P1', 'B', true], ['P2', 'A', true], ['P2', 'B', true],
];
export const DUMMY_RATE_ROWS = RATE_LEVELS.map(([level, tier, hasColin], i) => ({
  level, tier,
  clientRate: 500 + i * 20,
  attorneyRate: 250 + i * 10,
  colinRate: hasColin ? 300 + i * 10 : null,
  salary: level.startsWith('P') ? 'Variable' : 200000 + i * 12000,
  cravath: i % 2 === 0 && !level.startsWith('P') ? 250000 + i * 15000 : null,
}));

const DUMMY_RATE_HEADERS = ['Client Rate', 'Take-Home Rate', 'Billable Earnings', '83(b) Earnings (Cash Bonus)', 'Personal Reimbursements', 'Check', 'Diff'];
const dummyMonthEntry = (key) => {
  const m = MONTH_DATA[key];
  return {
    inputs: { ...m.inputs },
    sheet: computeMonthlyWaterfall(m.inputs), // dummy "sheet" cache == computed (no drift by construction)
    sheetErrors: {},
    attorneyTable: {
      headers: DUMMY_RATE_HEADERS,
      rows: m.rateTable.map((r) => ({ name: r.name, vals: [r.clientRate, r.takeHome, r.billableEarnings, r.earnings83b, r.personalReimb, r.check, r.diff] })),
    },
    matrix: { attorneys: m.attorneys, rows: m.matrix.map((r) => ({ ...r, billings: [...r.billings] })), totalRows: m.matrix.length },
  };
};

export const DUMMY_WORKBOOK = {
  source: 'Dummy dataset (generated placeholders)',
  extractedOn: null,
  months: Object.fromEntries(INDEX_KEY.map((k) => [k, dummyMonthEntry(k)])),
  monthsExtra: { 'june-original': dummyMonthEntry('june-original') },
  cash: Object.fromEntries(INDEX_KEY.map((k, m) => {
    const row = DUMMY_CASH_ROWS[m];
    return [k, {
      inputs: { cashReceived: row.cashReceived, expenses: row.expenses, cgfDonation: row.cgfDonation, attorneyPayout: row.attorneyPayout },
      sheet: { profits: computeCashProfits(row), revenue: row.revenueAccrued, qRevenue: null },
    }];
  })),
  pnl: {
    lines: Object.fromEntries(Object.entries(DUMMY_PNL_LINES).filter(([k]) => k !== 'consultants')),
    consultants: DUMMY_PNL_LINES.consultants,
    sheet: {},
  },
  paymentTotal: PAYMENT_TOTAL,
  paymentRegister: PAYMENT_ROWS.map((r) => ({ ...r })),
  paymentRegisterCopy: PAYMENT_ROWS.map((r) => ({ ...r })),
  paymentTotalCopy: PAYMENT_TOTAL,
  profitsPaid: DUMMY_PROFITS_ROWS,
  rateSheet: DUMMY_RATE_ROWS,
  expenses: EXP_ROWS.map((r) => ({ ...r, vals: [...r.vals] })),
  balanceSheet: [], // dummy Balance Sheet stays the static scaffold in the view
};

// ===========================================================================
// REAL dataset factory — turns a REAL_WORKBOOK-shaped object (the frozen
// snapshot OR a live fetch from /api/invoices-workbook) into the view-ready
// structures. Everything derived flows through the same calc chain, so live and
// frozen render identically. Pure + Node-importable (tested).
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

// The real register has no payment-terms column (terms live in the clients
// sheet / Firestore), so paymentTerms falls back to null — reminder cadence
// uses the non-Net-30 default and overdue math is skipped. The dummy register
// carries terms (and Date objects), both preserved as-is.
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
