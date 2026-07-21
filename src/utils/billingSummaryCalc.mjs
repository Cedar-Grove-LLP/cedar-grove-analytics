/**
 * Pure calculations for the Billing Summaries invoice-prep page. Sam
 * McClure's manual month-end Adjustment ($) is included in Amount, which
 * always uses the admin CLIENT rate and never the synced `entry.earnings`.
 */

export function isBillableRow(entry) {
  return entry.billableHours > 0 || (entry.adjustment || 0) !== 0;
}

export function buildBillingRow(entry, { attorneyName, date, rate, found }) {
  const billableHours = entry.billableHours || 0;
  const adjustment = entry.adjustment || 0;

  return {
    ...entry,
    attorneyName,
    rate,
    rateMissing: !found && billableHours > 0,
    billableHours,
    adjustment,
    amount: rate * billableHours + adjustment,
    date,
    category: entry.billingCategory || entry.category || 'Other',
    notes: entry.notes || '',
  };
}

export function hasAdjustments(rows) {
  return rows.some(entry => entry.adjustment !== 0);
}

export function computeTotals(rows) {
  return rows.reduce(
    (acc, entry) => ({
      hours: acc.hours + entry.billableHours,
      adjustment: acc.adjustment + entry.adjustment,
      amount: acc.amount + entry.amount,
    }),
    { hours: 0, adjustment: 0, amount: 0 }
  );
}
