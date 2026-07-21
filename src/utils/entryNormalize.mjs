/**
 * Pure entry-normalization helpers shared by the React data hooks and Node
 * tests. Must stay free of React/Firebase imports.
 */

/**
 * Parse a numeric value from Firestore or a currency-formatted sheet string.
 * Strings follow the same `$` / `,` stripping rule as the Firestore parity
 * check; unsupported and non-finite values become 0.
 */
export function parseMoney(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (typeof value !== 'string') return 0;

  const parsed = parseFloat(value.replace(/[$,]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalize a billable entry from the new schema.
 * New schema fields: client, date, hours, earnings, adjustment, billingCategory, matter, reimbursements, notes, sheetRowNumber
 * Normalized output adds: userId, billableHours, month, year
 */
export const normalizeBillableEntry = (entryData, userId, month, year) => {
  const billableHours = parseMoney(entryData.hours);
  const earnings = parseMoney(entryData.earnings);

  return {
    ...entryData,
    userId,
    billableHours,
    earnings,
    billingCategory: entryData.billingCategory || 'Other',
    client: entryData.client || 'Unknown',
    matter: entryData.matter || '',
    reimbursements: parseMoney(entryData.reimbursements),
    // Manual month-end dollar adjustment (Sam McClure timesheet only): already
    // folded into `earnings` via the sheet's Billables Earnings column; passed
    // through here for transparency/display. Defaults to 0 when absent.
    adjustment: parseMoney(entryData.adjustment),
    notes: entryData.notes || '',
    month: month || '',
    year: year || new Date().getFullYear(),
  };
};

/**
 * Normalize an ops entry from the new schema.
 * New schema fields: description, date, hours, category, sheetRowNumber
 * Normalized output adds: userId, opsHours, month, year
 */
export const normalizeOpsEntry = (entryData, userId, month, year) => {
  const opsHours = parseMoney(entryData.hours);
  const category = (entryData.category || '').trim() ? entryData.category : 'Other';

  return {
    ...entryData,
    userId,
    opsHours,
    description: entryData.description || '',
    category,
    notes: entryData.description || '',
    month: month || '',
    year: year || new Date().getFullYear(),
  };
};

/**
 * Normalize an 83(b) election entry from the new schema.
 * Normalized output adds: userId, parsed flatFee, month, year.
 */
export const normalizeEightThreeBEntry = (entryData, userId, month, year) => ({
  ...entryData,
  userId,
  flatFee: parseMoney(entryData.flatFee),
  description: entryData.description || '',
  client: entryData.client || 'Unknown',
  month: month || '',
  year: year || new Date().getFullYear(),
});
