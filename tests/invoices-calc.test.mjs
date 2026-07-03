import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeMonthlyWaterfall,
  computeCashProfits,
  computeQuarterRevenue,
  computePaymentTotal,
  sumRowBillables,
  sumColumn,
  CGF_DONATION_RATE,
  addDays,
  daysBetween,
  nextBusinessDay,
  isNet30,
  calculateNextReminder,
  invoiceDueDate,
  daysOverdue,
  isReminderDue,
  computePaymentRollup,
  nextCalendarMonth,
  derivePnlNetIncome,
  sumWhereMonth,
} from '../src/utils/invoicesCalc.mjs';

const ymd = (y, m, d) => new Date(y, m - 1, d);
const isWeekday = (date) => date.getDay() !== 0 && date.getDay() !== 6;

// Values below are SYNTHETIC (round placeholder inputs with hand-computed
// expected outputs) — they verify the formula CHAIN is wired correctly without
// embedding real compensation figures in the repo. The real-data equivalents
// live in the gitignored tests/invoices-real-january-june.test.mjs (local-only).

const near = (actual, expected, eps = 0.02) =>
  assert.ok(Math.abs(actual - expected) <= eps, `expected ~${expected}, got ${actual}`);

test('CGF Donation rate is 10% of accrual revenue', () => {
  assert.equal(CGF_DONATION_RATE, 0.1);
});

test('monthly waterfall — full chain (synthetic round inputs)', () => {
  const wf = computeMonthlyWaterfall({
    attorneyBillables: 300000, flatFee83b: 3000, filingFees: 2000, outsideCounsel: 1000,
    writeOffs: 0, deferred: 10000, attorneyPayout: 150000, opEx: 0,
  });
  near(wf.gross, 306000);                 // Σ(B4:B7)
  near(wf.netAccrued, 303000);            // 306000 − 0 − 2000 − 1000
  near(wf.revenueAccrued, 293000);        // 303000 − 10000
  near(wf.cgfDonation, 29300);            // 10%
  near(wf.revenueMinusCgf, 263700);
  near(wf.netRevenueBeforeOpEx, 113700);  // 263700 − 150000
  near(wf.firmProfits, 113700);           // − 0 OpEx
});

test('monthly waterfall — with Write Offs + OpEx (synthetic)', () => {
  const wf = computeMonthlyWaterfall({
    attorneyBillables: 130000, flatFee83b: 500, filingFees: 5000, outsideCounsel: 200,
    writeOffs: 2000, deferred: 2000, attorneyPayout: 75000, opEx: 23000,
  });
  near(wf.gross, 135700);
  near(wf.netAccrued, 128500);            // 135700 − 2000 − 5000 − 200
  near(wf.revenueAccrued, 126500);
  near(wf.cgfDonation, 12650);
  near(wf.firmProfits, 15850);            // 113850 − 75000 − 23000
});

test('monthly waterfall — larger OpEx month (synthetic)', () => {
  const wf = computeMonthlyWaterfall({
    attorneyBillables: 210000, flatFee83b: 4000, filingFees: 1200, outsideCounsel: 600,
    writeOffs: 0, deferred: 8000, attorneyPayout: 120000, opEx: 20000,
  });
  near(wf.gross, 215800);
  near(wf.netAccrued, 214000);
  near(wf.revenueAccrued, 206000);
  near(wf.cgfDonation, 20600);
  near(wf.firmProfits, 45400);            // 185400 − 120000 − 20000
});

test('cash-basis Profits = Received − (Expenses + CGF + Payout)', () => {
  near(computeCashProfits({ cashReceived: 180000, expenses: 23000, cgfDonation: 17000, attorneyPayout: 67000 }), 73000);
  // goes negative when outflows exceed receipts
  near(computeCashProfits({ cashReceived: 100000, expenses: 20000, cgfDonation: 50000, attorneyPayout: 110000 }), -80000);
});

test('Q Revenue = sum of the quarter accrual revenues', () => {
  near(computeQuarterRevenue([126500, 190000, 185000]), 501500); // Q1 (Jan–Mar)
  near(computeQuarterRevenue([206000, 250000, 293000]), 749000); // Q2 (Apr–Jun)
});

test('payment register total sums the amounts', () => {
  near(computePaymentTotal([300, 2000, 100, 800, 200]), 3400);
});

test('per-client Sum Billables = row sum of attorney billings', () => {
  // [Sam, Colin, MichaelO, Molly, MichaelL, Valery, David, Nick, Paige, Martyna]
  near(sumRowBillables([4000, 0, 0, 11000, 0, 0, 0, 0, 0, 0]), 15000);
  near(sumRowBillables([1400, 0, 500, 200, 0, 0, 0, 0, 0, 500]), 2600);
  near(sumRowBillables([100, 0, 0, 0, 1600, 0, 0, 0, 0, 0]), 1700);
});

test('column total feeds the waterfall Attorney Billables input', () => {
  const sumBillablesCol = [15000, 2600, 1700];
  near(sumColumn(sumBillablesCol), 19300);
  // that total is exactly what would be passed as attorneyBillables (B4 = L18)
  const wf = computeMonthlyWaterfall({ attorneyBillables: sumColumn(sumBillablesCol) });
  near(wf.gross, 19300);
});

// --- Reminder engine (mirrors Payment reminders.gs cadence) ----------------
test('date helpers: addDays, daysBetween, nextBusinessDay', () => {
  assert.equal(daysBetween(ymd(2026, 6, 1), addDays(ymd(2026, 6, 1), 16)), 16);
  // 2026-06-06 is a Saturday → rolls to Monday the 8th
  const rolled = nextBusinessDay(ymd(2026, 6, 6));
  assert.ok(isWeekday(rolled));
  assert.equal(rolled.getDate(), 8);
  assert.equal(isNet30(30), true);
  assert.equal(isNet30(15), false);
});

test('calculateNextReminder: first reminder is Date Sent + 16 (Net-30 → +31), on a business day', () => {
  const sent = ymd(2026, 6, 1);
  const r1 = calculateNextReminder(sent, null, false);
  assert.equal(r1.number, 1);
  assert.ok(isWeekday(r1.dueDate));
  const gap = daysBetween(sent, r1.dueDate);
  assert.ok(gap >= 16 && gap <= 18, `expected ~16, got ${gap}`);

  const r1n30 = calculateNextReminder(sent, null, true);
  const gapN = daysBetween(sent, r1n30.dueDate);
  assert.ok(gapN >= 31 && gapN <= 33, `expected ~31, got ${gapN}`);
});

test('calculateNextReminder: advances to 2nd/3rd from lastReminder, then null', () => {
  const sent = ymd(2026, 6, 1);
  const r1 = calculateNextReminder(sent, null, false).dueDate;
  const r2 = calculateNextReminder(sent, r1, false);
  assert.equal(r2.number, 2);
  assert.ok(daysBetween(r1, r2.dueDate) >= 10 && daysBetween(r1, r2.dueDate) <= 12);

  const r3 = calculateNextReminder(sent, r2.dueDate, false);
  assert.equal(r3.number, 3);
  assert.match(r3.name, /3rd/);

  assert.equal(calculateNextReminder(sent, r3.dueDate, false), null);
});

test('invoice due date + daysOverdue', () => {
  const sent = ymd(2026, 6, 1);
  assert.equal(daysBetween(sent, invoiceDueDate(sent, 15)), 15);
  assert.equal(daysOverdue(sent, 15, ymd(2026, 7, 1), 'Not Paid'), 15);
  assert.equal(daysOverdue(sent, 15, ymd(2026, 7, 1), 'Paid'), 0); // settled → 0
  assert.equal(daysOverdue(sent, 30, ymd(2026, 6, 20), 'Not Paid'), 0); // not yet due
});

test('isReminderDue respects the 3-day lookahead window', () => {
  const today = ymd(2026, 7, 1);
  assert.equal(isReminderDue({ dueDate: ymd(2026, 7, 3) }, today), true); // within 3 days
  assert.equal(isReminderDue({ dueDate: ymd(2026, 7, 10) }, today), false); // too far out
  assert.equal(isReminderDue(null, today), false);
});

test('cross-sheet wiring: net income + SUMIFS-by-month', () => {
  // NET INCOME = Revenue − Total Expenses − CGF
  near(derivePnlNetIncome(1000, 400, 100), 500);
  // Cash Received = Σ amounts whose Date Received falls in the month
  const register = [
    { amount: 9200, dateReceived: new Date(2026, 0, 20) },
    { amount: 12400, dateReceived: new Date(2026, 1, 12) },
    { amount: 8600, dateReceived: new Date(2026, 1, 25) },
    { amount: 500, dateReceived: new Date(2025, 1, 25) }, // wrong year — excluded
    { amount: 700, dateReceived: null }, // unpaid — excluded
  ];
  near(sumWhereMonth(register, 'dateReceived', 'amount', 0, 2026), 9200); // January
  near(sumWhereMonth(register, 'dateReceived', 'amount', 1, 2026), 21000); // February (2 invoices)
});

test('nextCalendarMonth advances one month and rolls the year at December', () => {
  assert.deepEqual(nextCalendarMonth('July', 2026), { name: 'August', year: 2026 });
  assert.deepEqual(nextCalendarMonth('December', 2026), { name: 'January', year: 2027 });
  assert.equal(nextCalendarMonth('Nope', 2026), null);
});

test('computePaymentRollup: totals, per-status, outstanding, overdue', () => {
  const rows = [
    { amount: 100, status: 'Paid' },
    { amount: 200, status: 'Not Paid', dateSent: ymd(2026, 6, 1), paymentTerms: 15 }, // overdue by 7/1
    { amount: 300, status: 'Write Off' },
    { amount: 50, status: 'Payment Initiated', dateSent: ymd(2026, 6, 20), paymentTerms: 30 }, // not yet due
  ];
  const r = computePaymentRollup(rows, ymd(2026, 7, 1));
  near(r.total, 650);
  assert.equal(r.byStatus['Not Paid'].count, 1);
  near(r.byStatus['Not Paid'].amount, 200);
  near(r.outstanding, 250); // Not Paid 200 + Payment Initiated 50 (Paid/Write Off settled)
  assert.equal(r.overdueCount, 1);
  near(r.overdueAmount, 200);
});
