import test from 'node:test';
import assert from 'node:assert/strict';
import { assembleWorkbook, serialToISO, RANGES } from '../src/utils/invoicesSheetRanges.mjs';
import { WATERFALL_ROWS, computeMonthlyWaterfall } from '../src/utils/invoicesCalc.mjs';
import { REAL_WORKBOOK } from '../src/utils/invoicesRealData.mjs';

// The live path reads the Sheets API `values.batchGet` grids and reshapes them
// via assembleWorkbook into the REAL_WORKBOOK shape. This test builds those
// grids FROM the frozen snapshot (mirroring the documented tab layout) and
// asserts assembleWorkbook reproduces the snapshot — catching column-index /
// mapping regressions in the parser.

const WF_KEYS = WATERFALL_ROWS.map((r) => r[1]);
const MATRIX_TAIL = [
  ['Sum Billables', 'sumBillables'], ['83(b) Elections', 'elections83b'], ['Filing Fees', 'filingFees'],
  ['Fees Notes', 'feesNotes'], ['Outside Counsel', 'outsideCounsel'], ['Outside Counsel Notes', 'ocNotes'],
  ['Prior Deferred', 'priorDeferred'], ['Prior Deferral Toggle', 'priorToggle'], ['Deferred This Month', 'deferredThisMonth'],
  ['Total Deferred', 'totalDeferred'], ['Write Off', 'writeOff'], ['Invoiced', 'invoiced'],
  ['General Notes', 'generalNotes'], ['Contact Name', 'contactName'], ['Contact Email', 'contactEmail'], ['Payment Terms', 'paymentTerms'],
];
const ATT_COL = 12; // place the attorney table anchored at column L, like the sheet

const isoToSerial = (iso) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86400000) + 25569;

const makeSetter = (grid) => (r1, c1, v) => {
  if (!grid[r1 - 1]) grid[r1 - 1] = [];
  grid[r1 - 1][c1 - 1] = v;
};

function monthGrid(m) {
  const M = REAL_WORKBOOK.months[m];
  const grid = [];
  const set = makeSetter(grid);
  WF_KEYS.forEach((k, i) => set(i + 2, 2, M.sheet[k]));
  // attorney rate table
  set(1, ATT_COL, 'Attorney');
  M.attorneyTable.headers.forEach((h, i) => set(1, ATT_COL + 1 + i, h));
  M.attorneyTable.rows.forEach((row, ri) => {
    set(2 + ri, ATT_COL, row.name);
    row.vals.forEach((v, vi) => set(2 + ri, ATT_COL + 1 + vi, v));
  });
  // client billings matrix
  if (M.matrix) {
    const attorneys = M.matrix.attorneys;
    const headers = ['Client', ...attorneys, ...MATRIX_TAIL.map(([h]) => h)];
    headers.forEach((h, i) => set(20, 1 + i, h));
    const sbCol = 1 + attorneys.length + 1; // 1-based col of "Sum Billables"
    M.matrix.rows.forEach((row, ri) => {
      const r1 = 21 + ri;
      set(r1, 1, row.client);
      row.billings.forEach((v, j) => set(r1, 2 + j, v));
      MATRIX_TAIL.forEach(([, field], ti) => set(r1, sbCol + ti, row[field]));
    });
  }
  return grid;
}

function registerGrid(reg, total) {
  const grid = [];
  const set = makeSetter(grid);
  set(1, 1, 'All 2026 Billing');
  set(1, 2, total);
  reg.forEach((row, i) => {
    const r = 2 + i;
    set(r, 1, row.client);
    set(r, 2, row.amount);
    set(r, 3, row.year);
    set(r, 4, row.dateSent == null ? null : isoToSerial(row.dateSent));
    set(r, 5, row.status);
    set(r, 6, row.lastReminder == null ? null : isoToSerial(row.lastReminder));
    set(r, 7, row.dateReceived == null ? null : isoToSerial(row.dateReceived));
    set(r, 8, row.notes);
  });
  return grid;
}

function cashGrid() {
  const grid = [];
  const set = makeSetter(grid);
  ['january', 'february', 'march', 'april', 'may', 'june'].forEach((m, i) => {
    const e = REAL_WORKBOOK.cash[m];
    const r = 3 + i;
    // Col A month label, as on the real tab — assembleWorkbook detects cash
    // rows by this label rather than by fixed position.
    set(r, 1, m[0].toUpperCase() + m.slice(1));
    set(r, 2, e.inputs.cashReceived);
    set(r, 3, e.inputs.expenses);
    set(r, 4, e.inputs.cgfDonation);
    set(r, 5, e.inputs.attorneyPayout);
    set(r, 6, e.sheet.profits);
    set(r, 7, e.sheet.revenue);
    set(r, 8, e.sheet.qRevenue);
  });
  return grid;
}

const buildGrids = () => ({
  'month:january': monthGrid('january'),
  'month:june': monthGrid('june'),
  cash: cashGrid(),
  paymentStatus: registerGrid(REAL_WORKBOOK.paymentRegister, REAL_WORKBOOK.paymentTotal),
});

test('RANGES covers every tab the workbook shape needs', () => {
  const keys = RANGES.map((r) => r.key);
  for (const m of ['january', 'february', 'march', 'april', 'may', 'june', 'july']) assert.ok(keys.includes(`month:${m}`));
  for (const k of ['cash', 'pnl', 'paymentStatus', 'paymentStatusCopy', 'profitsPaid', 'rateSheet', 'expenses', 'balanceSheet']) assert.ok(keys.includes(k), `missing ${k}`);
  // every range is A1-quoted and read-only in form
  for (const r of RANGES) assert.match(r.range, /^'.+'!/);
});

test('assembleWorkbook reproduces month inputs + waterfall (january)', () => {
  const wb = assembleWorkbook(buildGrids(), { fetchedAt: 't' });
  assert.deepEqual(wb.months.january.inputs, REAL_WORKBOOK.months.january.inputs);
  assert.deepEqual(wb.months.january.sheet, REAL_WORKBOOK.months.january.sheet);
  // recomputing from the parsed inputs matches the sheet's cached derived cells
  const wf = computeMonthlyWaterfall(wb.months.january.inputs);
  for (const k of WF_KEYS) assert.ok(Math.abs(wf[k] - REAL_WORKBOOK.months.january.sheet[k]) < 0.01, `waterfall ${k}`);
});

test('assembleWorkbook reproduces the matrix + attorney table (june, 10 attorneys)', () => {
  const wb = assembleWorkbook(buildGrids(), { fetchedAt: 't' });
  const j = wb.months.june;
  assert.deepEqual(j.matrix.attorneys, REAL_WORKBOOK.months.june.matrix.attorneys);
  assert.deepEqual(j.matrix.rows, REAL_WORKBOOK.months.june.matrix.rows);
  assert.deepEqual(j.attorneyTable, REAL_WORKBOOK.months.june.attorneyTable);
});

test('assembleWorkbook reproduces the register (length + first/last rows)', () => {
  const wb = assembleWorkbook(buildGrids(), { fetchedAt: 't' });
  const reg = wb.paymentRegister;
  assert.equal(reg.length, REAL_WORKBOOK.paymentRegister.length);
  assert.deepEqual(reg[0], REAL_WORKBOOK.paymentRegister[0]);
  assert.deepEqual(reg[reg.length - 1], REAL_WORKBOOK.paymentRegister.at(-1));
  assert.equal(wb.paymentTotal, REAL_WORKBOOK.paymentTotal);
});

test('assembleWorkbook reproduces cash inputs (january)', () => {
  const wb = assembleWorkbook(buildGrids(), { fetchedAt: 't' });
  assert.deepEqual(wb.cash.january, REAL_WORKBOOK.cash.january);
});

test('waterfall error cells are captured in sheetErrors', () => {
  const grid = [];
  const set = makeSetter(grid);
  // gross (row 2) is a #VALUE! error; the rest are numbers
  set(2, 2, '#VALUE! (broken IMPORTRANGE)');
  WF_KEYS.slice(1).forEach((k, i) => set(3 + i, 2, 100 + i));
  const wb = assembleWorkbook({ 'month:january': grid }, {});
  assert.equal(wb.months.january.sheetErrors.gross, '#VALUE! (broken IMPORTRANGE)');
  assert.equal(wb.months.january.sheet.gross, 0);
});

test('serialToISO converts a known Sheets serial', () => {
  assert.equal(serialToISO(25569), '1970-01-01');
  assert.equal(serialToISO(isoToSerial('2026-06-30')), '2026-06-30');
});
