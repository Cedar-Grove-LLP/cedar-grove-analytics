// Pure sheetTotals validation — computed-vs-sheet totals comparison for the
// per-user per-month timesheet docs synced from Google Sheets. Extracted from
// FirestoreDataContext so the warning logic is unit-testable; the context
// keeps orchestration (fetching, normalization) and calls these helpers.
//
// Zero semantics (see "sheetTotals zero semantics" memory): the guarded
// fields — totalBillableHours, billableEarnings, opsHours, totalHours — treat
// 0 as ABSENT, not as a value. A sheet rollup of 0 usually means the totals
// row wasn't synced/parsed, so every check is gated on `> 0` and a zero sheet
// total never produces a mismatch warning even when entries sum to non-zero.
import { parseMoney } from './parseMoney.mjs';

/** Round to 2 decimal places for comparison against sheet rollups. */
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Validate a billables doc's computed entry sums against its sheetTotals.
 * Returns an array of warning objects (empty when sheetTotals is absent or
 * everything matches).
 */
export function validateBillablesSheetTotals({ sheetTotals, computedHours, computedEarnings, month, year }) {
  const warnings = [];
  if (!sheetTotals) return warnings;

  const computedHoursRounded = round2(computedHours);
  const computedEarningsRounded = round2(computedEarnings);

  if (sheetTotals.totalBillableHours > 0 && computedHoursRounded !== sheetTotals.totalBillableHours) {
    warnings.push({
      type: 'hours-mismatch',
      collection: 'billables',
      month,
      year,
      message: `Billable hours mismatch in ${month} ${year}: entries sum to ${computedHoursRounded}h but sheet total is ${sheetTotals.totalBillableHours}h`,
    });
  }

  if (sheetTotals.billableEarnings > 0 && computedEarningsRounded !== sheetTotals.billableEarnings) {
    warnings.push({
      type: 'earnings-mismatch',
      collection: 'billables',
      month,
      year,
      message: `Billable earnings mismatch in ${month} ${year}: entries sum to $${computedEarningsRounded.toLocaleString()} but sheet total is $${sheetTotals.billableEarnings.toLocaleString()}`,
    });
  }

  return warnings;
}

/**
 * Validate an ops doc's computed hours sum against its sheetTotals.
 * Returns an array of warning objects.
 */
export function validateOpsSheetTotals({ sheetTotals, computedOpsHours, month, year }) {
  const warnings = [];
  if (!sheetTotals) return warnings;

  const computedOpsRounded = round2(computedOpsHours);

  if (sheetTotals.opsHours > 0 && computedOpsRounded !== sheetTotals.opsHours) {
    warnings.push({
      type: 'hours-mismatch',
      collection: 'ops',
      month,
      year,
      message: `Ops hours mismatch in ${month} ${year}: entries sum to ${computedOpsRounded}h but sheet total is ${sheetTotals.opsHours}h`,
    });
  }

  return warnings;
}

/**
 * Build the per-user per-month sheet-total and computed-total maps used by the
 * cross-collection total-hours check.
 *
 * @param {Array<{ userName: string, type: 'billables'|'ops'|'eightThreeB',
 *                 month: string, year: number, entries: Array<object>,
 *                 sheetTotals: object|null }>} docRecords
 * @returns {{ userMonthSheetTotals: object, userMonthComputedTotals: object }}
 *   userMonthSheetTotals:    { userName: { "2026_January": { billables: {...}, ops: {...}, eightThreeB: {...} } } }
 *   userMonthComputedTotals: { userName: { "2026_January": { billableHours, billableEarnings, opsHours, reimbursements, eightThreeBFees } } }
 */
export function buildUserMonthTotals(docRecords) {
  const userMonthSheetTotals = {};
  const userMonthComputedTotals = {};

  docRecords.forEach(({ userName, type, month, year, entries, sheetTotals }) => {
    const docKey = `${year}_${month}`;

    if (!userMonthSheetTotals[userName]) userMonthSheetTotals[userName] = {};
    if (!userMonthSheetTotals[userName][docKey]) userMonthSheetTotals[userName][docKey] = {};
    if (sheetTotals) {
      userMonthSheetTotals[userName][docKey][type] = sheetTotals;
    }

    if (!userMonthComputedTotals[userName]) userMonthComputedTotals[userName] = {};
    if (!userMonthComputedTotals[userName][docKey]) {
      userMonthComputedTotals[userName][docKey] = {
        billableHours: 0, billableEarnings: 0, opsHours: 0, reimbursements: 0, eightThreeBFees: 0,
      };
    }

    if (type === 'billables') {
      entries.forEach(entry => {
        userMonthComputedTotals[userName][docKey].billableHours += parseFloat(entry.hours) || 0;
        userMonthComputedTotals[userName][docKey].billableEarnings += parseMoney(entry.earnings);
        userMonthComputedTotals[userName][docKey].reimbursements += parseMoney(entry.reimbursements);
      });
    } else if (type === 'ops') {
      entries.forEach(entry => {
        userMonthComputedTotals[userName][docKey].opsHours += parseFloat(entry.hours) || 0;
      });
    } else if (type === 'eightThreeB') {
      entries.forEach(entry => {
        userMonthComputedTotals[userName][docKey].eightThreeBFees += parseMoney(entry.flatFee);
      });
    }
  });

  return { userMonthSheetTotals, userMonthComputedTotals };
}

/**
 * Cross-collection total-hours check: the ops sheetTotals carries the
 * combined (billable + ops) monthly total, compared against the sum computed
 * from both collections' entries.
 *
 * @returns {Array<{ userName: string, warning: object }>}
 */
export function validateTotalHours(userMonthSheetTotals, userMonthComputedTotals) {
  const results = [];

  Object.entries(userMonthSheetTotals).forEach(([userName, months]) => {
    Object.entries(months).forEach(([docKey, sheetTotalsByType]) => {
      const computed = userMonthComputedTotals[userName]?.[docKey];
      if (!computed) return;

      const [yearStr, month] = docKey.split('_');
      const year = parseInt(yearStr, 10);

      // Total hours check (from ops sheetTotals which has the combined total)
      const opsSheetTotals = sheetTotalsByType.ops;
      if (opsSheetTotals?.totalHours > 0) {
        const computedTotalHours = round2(computed.billableHours + computed.opsHours);
        if (computedTotalHours !== opsSheetTotals.totalHours) {
          results.push({
            userName,
            warning: {
              type: 'total-hours-mismatch',
              month,
              year,
              message: `Total hours mismatch in ${month} ${year}: entries sum to ${computedTotalHours}h but sheet total is ${opsSheetTotals.totalHours}h`,
            },
          });
        }
      }
    });
  });

  return results;
}
