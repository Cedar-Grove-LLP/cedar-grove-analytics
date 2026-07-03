// Pure replica of the Cedar Grove "Invoices (2026)" Google Sheet calculation
// logic. This encodes the *mathematical relationships* between cells so the
// dashboard "Invoices (testing)" view can derive the same figures the sheet
// derives — regardless of whether the inputs are dummy or (later) real data.
//
// Source of truth for the formulas: the workbook itself (read-only). See the
// `invoices-workbook-calc-logic` memory note. Verified against real captured
// figures in tests/invoices-calc.test.mjs.

// CGF Donation is 10% of accrual Revenue (monthly tab B11 = B10 * 0.1).
export const CGF_DONATION_RATE = 0.1;

// Monthly accrual waterfall (a monthly tab, column B rows 2–16).
//
// INPUTS (sourced in the sheet from the attorney table totals / detail rows /
// IMPORTRANGE, not computed within the waterfall):
//   attorneyBillables (B4=L18), flatFee83b (B5=M18), filingFees (B6),
//   outsideCounsel (B7), writeOffs (B3), deferred (B9=T18),
//   attorneyPayout (B13 = SUM of imported take-home earnings), opEx (B15)
//
// DERIVED (the relationships this module guarantees):
//   gross (B2), netAccrued (B8), revenueAccrued (B10), cgfDonation (B11),
//   revenueMinusCgf (B12), netRevenueBeforeOpEx (B14), firmProfits (B16)
export function computeMonthlyWaterfall(input = {}) {
  const {
    attorneyBillables = 0,
    flatFee83b = 0,
    filingFees = 0,
    outsideCounsel = 0,
    writeOffs = 0,
    deferred = 0,
    attorneyPayout = 0,
    opEx = 0,
  } = input;

  const gross = attorneyBillables + flatFee83b + filingFees + outsideCounsel; // B2 = SUM(B4:B7)
  const netAccrued = gross - writeOffs - filingFees - outsideCounsel;          // B8 = B2-B3-B6-B7
  const revenueAccrued = netAccrued - deferred;                               // B10 = B8-B9
  const cgfDonation = revenueAccrued * CGF_DONATION_RATE;                      // B11 = B10*0.1
  const revenueMinusCgf = revenueAccrued - cgfDonation;                       // B12 = B10-B11
  const netRevenueBeforeOpEx = revenueMinusCgf - attorneyPayout;              // B14 = B12-B13
  const firmProfits = netRevenueBeforeOpEx - opEx;                            // B16 = B14-B15

  return {
    gross,
    writeOffs,
    attorneyBillables,
    flatFee83b,
    filingFees,
    outsideCounsel,
    netAccrued,
    deferred,
    revenueAccrued,
    cgfDonation,
    revenueMinusCgf,
    attorneyPayout,
    netRevenueBeforeOpEx,
    opEx,
    firmProfits,
  };
}

// The 15 waterfall rows in sheet (top-to-bottom) order, pairing the display
// label with the computed key and its structural formatting tag.
export const WATERFALL_ROWS = [
  ['Gross (Billables, Fees, Reimbursements):', 'gross'],
  ['Write Offs:', 'writeOffs', 'red'],
  ['Attorney Billables:', 'attorneyBillables'],
  ['83(b) Flat Fee (X*$250):', 'flatFee83b'],
  ['Filing Fees:', 'filingFees'],
  ['Outside Counsel Reimbursements:', 'outsideCounsel'],
  ['Net Accrued:', 'netAccrued'],
  ['Deferred:', 'deferred', 'red'],
  ['Revenue (Accrued):', 'revenueAccrued', 'hl'],
  ['CGF Donation (Accrued):', 'cgfDonation', 'red'],
  ['Revenue (Minus CGF Donation) (Accrued):', 'revenueMinusCgf'],
  ['Attorney Payout:', 'attorneyPayout', 'green'],
  ['Net Revenue (Before OpEx) (Accrued):', 'netRevenueBeforeOpEx'],
  ['OpEx:', 'opEx', 'red'],
  ['Firm Profits (Accrued):', 'firmProfits', 'hl'],
];

// Monthly detail grid: per-client "Sum Billables" (col L) = sum of that
// client's per-attorney client-rate billings (cols B–K). The column total of
// Sum Billables feeds the waterfall's Attorney Billables (B4 = L18); likewise
// the 83(b) Elections and Filing Fees column totals feed B5 and B6.
export function sumRowBillables(perAttorney = []) {
  return perAttorney.reduce((sum, v) => sum + (v || 0), 0);
}

// The sheet's actual per-client Sum Billables formula:
//   L = SUM(attorney cols) + IF(Prior Deferral Toggle = "Bill", Prior Deferred, 0)
// i.e. prior-month deferrals being billed this month ride along in the column.
export function computeRowSumBillables(billings = [], priorDeferred = 0, priorToggle = '') {
  return sumRowBillables(billings) + (priorToggle === 'Bill' ? priorDeferred || 0 : 0);
}

// Sum a matrix column (e.g. total of the Sum Billables / 83(b) / Filing cols).
export function sumColumn(values = []) {
  return values.reduce((sum, v) => sum + (v || 0), 0);
}

// Cash Accounting Summary, Profits column (F) — cash basis.
// F = Cash Received − (Expenses + CGF Donation + Attorney Payout).
export function computeCashProfits(input = {}) {
  const { cashReceived = 0, expenses = 0, cgfDonation = 0, attorneyPayout = 0 } = input;
  return cashReceived - (expenses + cgfDonation + attorneyPayout);
}

// Q Revenue = sum of that quarter's accrual Revenue (Accrued) figures.
export function computeQuarterRevenue(monthlyRevenues = []) {
  return monthlyRevenues.reduce((sum, v) => sum + (v || 0), 0);
}

// Payment Status register total (B1 = SUM(amounts)).
export function computePaymentTotal(amounts = []) {
  return amounts.reduce((sum, v) => sum + (v || 0), 0);
}

// ---------------------------------------------------------------------------
// Payment reminder engine — pure replica of the reminder cadence in the bound
// Apps Script "Payment reminders.gs" CONFIG. COMPUTE + DISPLAY ONLY: this never
// sends anything. Cadence (calendar days): 1st = Date Sent + 16 (+31 for Net-30),
// 2nd = 1st + 10, 3rd = 2nd + 7; each rolled to the next business day.
// ---------------------------------------------------------------------------
export const REMINDER_CONFIG = {
  DAYS_1ST: 16,
  DAYS_1ST_N30: 31,
  DAYS_TO_2ND: 10,
  DAYS_TO_3RD: 7,
  LOOKAHEAD_DAYS: 3,
};

const MS_PER_DAY = 86400000;

export function stripTime(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date, n) {
  const d = stripTime(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function daysBetween(from, to) {
  return Math.round((stripTime(to).getTime() - stripTime(from).getTime()) / MS_PER_DAY);
}

// Roll a date forward to the next weekday (skips Sat/Sun). Holidays not modeled.
export function nextBusinessDay(date) {
  const d = stripTime(date);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
  return d;
}

export function isNet30(paymentTerms) {
  return Number(paymentTerms) === 30;
}

// Next reminder for an invoice given its Date Sent, the last reminder already
// sent (Date | null), and whether the client is Net-30. Returns { name, number,
// dueDate } or null when all three reminders have gone out.
export function calculateNextReminder(dateSent, lastReminder, net30) {
  const c = REMINDER_CONFIG;
  const r1 = nextBusinessDay(addDays(dateSent, net30 ? c.DAYS_1ST_N30 : c.DAYS_1ST));
  const r2 = nextBusinessDay(addDays(r1, c.DAYS_TO_2ND));
  const r3 = nextBusinessDay(addDays(r2, c.DAYS_TO_3RD));

  if (!lastReminder) return { name: '1st Reminder', number: 1, dueDate: r1 };

  const last = stripTime(new Date(lastReminder));
  if (last < addDays(r2, -5)) return { name: '2nd Reminder', number: 2, dueDate: nextBusinessDay(addDays(last, c.DAYS_TO_2ND)) };
  if (last < addDays(r3, -5)) return { name: '3rd Reminder (CC partner)', number: 3, dueDate: nextBusinessDay(addDays(last, c.DAYS_TO_3RD)) };
  return null;
}

// Invoice payment due date = Date Sent + payment terms (15 or 30 days).
export function invoiceDueDate(dateSent, paymentTerms) {
  return addDays(dateSent, Number(paymentTerms) || 0);
}

// Days an unpaid invoice is past its terms (0 if paid/written-off or not yet due).
export function daysOverdue(dateSent, paymentTerms, today, status) {
  if (status === 'Paid' || status === 'Write Off') return 0;
  const d = daysBetween(invoiceDueDate(dateSent, paymentTerms), today);
  return d > 0 ? d : 0;
}

// Is the next reminder due as of `today` (within the LOOKAHEAD window)?
export function isReminderDue(nextReminder, today) {
  if (!nextReminder) return false;
  return daysBetween(today, nextReminder.dueDate) <= REMINDER_CONFIG.LOOKAHEAD_DAYS;
}

// Payment Status roll-up (mirrors updatePaymentStatusTab aggregation): register
// total, per-status count/amount, total outstanding, and overdue count/amount.
export function computePaymentRollup(rows = [], today = null) {
  const t = today ? stripTime(today) : null;
  const acc = { total: 0, byStatus: {}, outstanding: 0, overdueCount: 0, overdueAmount: 0 };
  for (const r of rows) {
    const amount = r.amount || 0;
    acc.total += amount;
    const s = r.status || 'Unknown';
    if (!acc.byStatus[s]) acc.byStatus[s] = { count: 0, amount: 0 };
    acc.byStatus[s].count += 1;
    acc.byStatus[s].amount += amount;
    const settled = s === 'Paid' || s === 'Write Off';
    if (!settled) acc.outstanding += amount;
    if (!settled && t && r.dateSent != null && r.paymentTerms != null) {
      if (t > invoiceDueDate(r.dateSent, r.paymentTerms)) {
        acc.overdueCount += 1;
        acc.overdueAmount += amount;
      }
    }
  }
  return acc;
}

// ---------------------------------------------------------------------------
// Month rollover — the "updateMonthReferences" step of the Apps Script's
// createNewMonth / copyFormulasToNextMonth flow: advance one calendar month,
// rolling December → January of the next year.
// ---------------------------------------------------------------------------
export const MONTHS_OF_YEAR = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function nextCalendarMonth(name, year) {
  const i = MONTHS_OF_YEAR.indexOf(name);
  if (i < 0) return null;
  return i === 11 ? { name: 'January', year: year + 1 } : { name: MONTHS_OF_YEAR[i + 1], year };
}

// ---------------------------------------------------------------------------
// Cross-sheet wiring helpers (mirror the workbook's inter-tab references).
// ---------------------------------------------------------------------------

// P&L NET INCOME = Revenue − Total Expenses − CGF Donations (P&L row 47).
export function derivePnlNetIncome(revenue, totalExpenses, cgfDonations) {
  return (revenue || 0) - (totalExpenses || 0) - (cgfDonations || 0);
}

// SUMIFS-style: sum a numeric field across rows whose date field lands in a
// given month/year (e.g. Cash Received B = Σ Payment Status amount by Date
// Received month; also used for expense category SUMIFs).
export function sumWhereMonth(rows, dateKey, amountKey, monthIndex, year) {
  return rows.reduce((sum, r) => {
    const d = r[dateKey];
    if (d instanceof Date && d.getMonth() === monthIndex && (year == null || d.getFullYear() === year)) {
      return sum + (r[amountKey] || 0);
    }
    return sum;
  }, 0);
}
