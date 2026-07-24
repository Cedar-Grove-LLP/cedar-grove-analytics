/**
 * Pure resolver for timesheet summary cells stored as column-A labels with
 * adjacent column-B values above the tab's data header. Labels are matched
 * case-insensitively against a deliberately small, proven alias registry;
 * missing, malformed, and Sheets-error values remain unavailable rather
 * than being converted to a fabricated zero.
 *
 * Pure module — no Firebase imports, no network, no filesystem.
 */

import { parseMoney } from '../entryNormalize.mjs';

export const SUMMARY_CELL_ALIASES = Object.freeze({
  totalBillableHours: Object.freeze(['Total Billable Hours']),
  billableEarnings: Object.freeze(['Billable Earnings', 'Billables Earnings']),
  totalPayment: Object.freeze(['Total Payment']),
  adjustment: Object.freeze(['Adjustment ($)', 'Adjustment']),
  opsHours: Object.freeze(['Total Ops Hours', 'Ops Hours']),
  clientFilingFees: Object.freeze(['Client Filing Fees', 'Total Client Filing Fees']),
});

const NORMALIZED_ALIASES = Object.freeze(Object.fromEntries(
  Object.entries(SUMMARY_CELL_ALIASES).map(([field, aliases]) => [
    field,
    Object.freeze(aliases.map((label) => label.trim().toLowerCase())),
  ])
));

const NUMERIC_OR_CURRENCY = /^-?\$?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;

function parseSummaryValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();
  if (!trimmed || !NUMERIC_OR_CURRENCY.test(trimmed)) return undefined;

  const parsed = parseMoney(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/**
 * Resolve known summary labels in rows 0..headerRowIndex-1.
 *
 * @returns {Object<string, {value:number, label:string, row:number}>}
 */
export function resolveSummaryCells(grid, headerRowIndex) {
  const resolved = {};
  const rows = grid || [];
  const end = Math.max(0, Math.min(headerRowIndex ?? 0, rows.length));

  for (let row = 0; row < end; row += 1) {
    const rawLabel = rows[row]?.[0];
    if (typeof rawLabel !== 'string') continue;
    const normalizedLabel = rawLabel.trim().toLowerCase();
    if (!normalizedLabel) continue;

    const match = Object.entries(NORMALIZED_ALIASES)
      .find(([, aliases]) => aliases.includes(normalizedLabel));
    if (!match || resolved[match[0]]) continue;

    const value = parseSummaryValue(rows[row]?.[1]);
    if (value === undefined) continue;
    resolved[match[0]] = { value, label: rawLabel.trim(), row };
  }

  return resolved;
}
