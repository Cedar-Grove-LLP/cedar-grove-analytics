import test from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveWorkbook,
  wfKey,
  mxBillKey,
  cashKey,
  regKey,
} from '../src/utils/invoicesOverrides.mjs';
import { computeMonthlyWaterfall, computeCashProfits } from '../src/utils/invoicesCalc.mjs';
import { REAL_WORKBOOK } from '../src/utils/invoicesRealData.mjs';
import { buildRealDataset } from '../src/utils/invoicesTestData.mjs';

const clone = (o) => JSON.parse(JSON.stringify(o));
const near = (a, b, eps = 0.01) => Math.abs(a - b) < eps;

test('empty overrides ⇒ workbook is structurally unchanged', () => {
  const { workbook, meta } = resolveWorkbook(REAL_WORKBOOK, {});
  assert.equal(meta.size, 0);
  assert.deepEqual(workbook.months.june.inputs, REAL_WORKBOOK.months.june.inputs);
  assert.deepEqual(workbook.paymentRegister, REAL_WORKBOOK.paymentRegister);
});

test('direct waterfall-input override propagates through the whole chain', () => {
  const base = computeMonthlyWaterfall(REAL_WORKBOOK.months.june.inputs);
  const newBillables = REAL_WORKBOOK.months.june.inputs.attorneyBillables + 10000;
  const { workbook, meta } = resolveWorkbook(REAL_WORKBOOK, { [wfKey('june', 'attorneyBillables')]: newBillables });
  const wf = workbook.months.june.resolvedWaterfall;
  // gross, netAccrued, revenue, cgf, revMinusCgf, netRevBeforeOpEx, firmProfits all move
  assert.ok(near(wf.gross, base.gross + 10000));
  assert.ok(near(wf.revenueAccrued, base.revenueAccrued + 10000));
  assert.ok(near(wf.cgfDonation, base.cgfDonation + 1000)); // 10% of the extra revenue
  assert.ok(near(wf.firmProfits, base.firmProfits + 10000 - 1000)); // less the extra CGF
  assert.equal(meta.get(wfKey('june', 'attorneyBillables')).state, 'edited');
  assert.equal(meta.get(wfKey('june', 'firmProfits')).state, 'derived-changed');
});

test('editing a matrix billing cell ripples to the waterfall + cash revenue', () => {
  const monthKey = 'june';
  const dsBase = buildRealDataset(REAL_WORKBOOK);
  const baseRevenue = dsBase.monthData[monthKey].waterfall.revenueAccrued;
  const baseCashRevenue = dsBase.cashRows.find((r) => r.month === 'June').revenueAccrued;

  const row0 = REAL_WORKBOOK.months.june.matrix.rows[0];
  const bump = 5000;
  const { workbook } = resolveWorkbook(REAL_WORKBOOK, { [mxBillKey(monthKey, 0, 0)]: row0.billings[0] + bump });
  const ds = buildRealDataset(workbook);

  // attorneyBillables (B4) grew by the bump, so revenue grew by the same.
  assert.ok(near(ds.monthData[monthKey].waterfall.revenueAccrued, baseRevenue + bump), 'month revenue moved');
  assert.ok(near(ds.cashRows.find((r) => r.month === 'June').revenueAccrued, baseCashRevenue + bump), 'cash revenue moved');
});

test('pinning a derived cell freezes it against upstream edits but still resolves', () => {
  const monthKey = 'june';
  const pinned = 999999;
  // Pin firmProfits AND bump an upstream input — pin must win.
  const { workbook, meta } = resolveWorkbook(REAL_WORKBOOK, {
    [wfKey(monthKey, 'firmProfits')]: pinned,
    [wfKey(monthKey, 'attorneyBillables')]: REAL_WORKBOOK.months.june.inputs.attorneyBillables + 50000,
  });
  assert.equal(workbook.months[monthKey].resolvedWaterfall.firmProfits, pinned);
  assert.equal(meta.get(wfKey(monthKey, 'firmProfits')).state, 'pinned');
});

test('pin on a MIDDLE derived cell propagates downstream', () => {
  const monthKey = 'june';
  const pinnedRevenue = 200000;
  const { workbook } = resolveWorkbook(REAL_WORKBOOK, { [wfKey(monthKey, 'revenueAccrued')]: pinnedRevenue });
  const wf = workbook.months[monthKey].resolvedWaterfall;
  assert.equal(wf.revenueAccrued, pinnedRevenue);
  assert.ok(near(wf.cgfDonation, pinnedRevenue * 0.1), 'CGF recomputed from pinned revenue');
  assert.ok(near(wf.revenueMinusCgf, pinnedRevenue - pinnedRevenue * 0.1));
});

test('clearing a pin (dropping the key) restores the computed value', () => {
  const monthKey = 'june';
  const withPin = resolveWorkbook(REAL_WORKBOOK, { [wfKey(monthKey, 'firmProfits')]: 1 }).workbook;
  assert.equal(withPin.months[monthKey].resolvedWaterfall.firmProfits, 1);
  const cleared = resolveWorkbook(REAL_WORKBOOK, {}).workbook;
  const computed = computeMonthlyWaterfall(REAL_WORKBOOK.months[monthKey].inputs).firmProfits;
  // no resolvedWaterfall when nothing is overridden → dataset falls back to compute
  assert.equal(cleared.months[monthKey].resolvedWaterfall, undefined);
  assert.ok(near(buildRealDataset(cleared).monthData[monthKey].waterfall.firmProfits, computed));
});

test('register amount edit moves the register total and that month Cash Received', () => {
  // Pick a register row received in a 2026 cash month (Jan–Jun) so it feeds a
  // Cash Received cell. (Prior-year rows are covered by the next test.)
  const cashMonthKeys = Object.keys(REAL_WORKBOOK.cash);
  const monthName = (mi) => ['january', 'february', 'march', 'april', 'may', 'june'][mi];
  const idx = REAL_WORKBOOK.paymentRegister.findIndex((r) => {
    if (!r.dateReceived || !String(r.dateReceived).startsWith('2026')) return false;
    return cashMonthKeys.includes(monthName(new Date(`${r.dateReceived}T00:00:00`).getMonth()));
  });
  assert.ok(idx >= 0, 'a 2026 received row exists');
  const row = REAL_WORKBOOK.paymentRegister[idx];
  const mName = monthName(new Date(`${row.dateReceived}T00:00:00`).getMonth());
  const bump = 4321;

  const { workbook } = resolveWorkbook(REAL_WORKBOOK, { [regKey(idx)]: row.amount + bump });
  assert.ok(near(workbook.paymentTotal, REAL_WORKBOOK.paymentTotal + bump), 'register total moved');
  const baseReceived = REAL_WORKBOOK.cash[mName].inputs.cashReceived;
  assert.ok(near(workbook.cash[mName].inputs.cashReceived, baseReceived + bump), 'cash received moved');
});

test('editing a PRIOR-YEAR (2025) register row moves the total but NOT any 2026 cash month', () => {
  const idx = REAL_WORKBOOK.paymentRegister.findIndex((r) => r.dateReceived && String(r.dateReceived).startsWith('2025'));
  assert.ok(idx >= 0, 'a 2025 received row exists');
  const row = REAL_WORKBOOK.paymentRegister[idx];
  const { workbook } = resolveWorkbook(REAL_WORKBOOK, { [regKey(idx)]: row.amount + 9999 });
  assert.ok(near(workbook.paymentTotal, REAL_WORKBOOK.paymentTotal + 9999), 'register total still moves');
  for (const mKey of Object.keys(REAL_WORKBOOK.cash)) {
    assert.equal(
      workbook.cash[mKey].inputs.cashReceived,
      REAL_WORKBOOK.cash[mKey].inputs.cashReceived,
      `${mKey} cash received unchanged by a 2025 payment edit`,
    );
  }
});

test('cash input edit recomputes that month Profits', () => {
  const monthKey = 'march';
  const base = REAL_WORKBOOK.cash[monthKey].inputs;
  const newExpenses = base.expenses + 7000;
  const { workbook, meta } = resolveWorkbook(REAL_WORKBOOK, { [cashKey(monthKey, 'expenses')]: newExpenses });
  const expected = computeCashProfits({ ...base, expenses: newExpenses });
  assert.ok(near(workbook.cash[monthKey].sheet.profits, expected));
  assert.equal(meta.get(cashKey(monthKey, 'expenses')).state, 'edited');
});

test('resolveWorkbook does not mutate the input workbook', () => {
  const snapshot = clone(REAL_WORKBOOK);
  resolveWorkbook(REAL_WORKBOOK, { [wfKey('june', 'attorneyBillables')]: 12345, [regKey(0)]: 99 });
  assert.deepEqual(REAL_WORKBOOK.months.june.inputs, snapshot.months.june.inputs);
  assert.equal(REAL_WORKBOOK.paymentRegister[0].amount, snapshot.paymentRegister[0].amount);
});
