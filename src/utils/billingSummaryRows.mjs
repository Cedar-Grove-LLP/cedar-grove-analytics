// Pure invoice-prep computation for the Billing Summaries page (tested by
// tests/billing-summary-rows.test.mjs). Extracted from
// components/views/BillingSummariesView.jsx so the row building, amount
// math, totals, and CSV assembly are Node-importable — the component imports
// these back and rendering is unchanged.
//
// Contract (see CLAUDE.md "Manual bill adjustments"): Amount = rate × hours
// + adjustment (calc key `billingSummaryAmount`, mirroring the sheet's
// Billables Earnings construction); pure adjustment rows (0 hours) belong on
// the bill; the Adjustment column/total appears only when the selection
// actually has one.

import { getEntryDate } from './dateHelpers.js';
import { buildCsv } from './buildCsv.mjs';

// A row belongs on a bill if it carries hours OR a manual month-end
// Adjustment ($) — pure adjustment rows have client + date, 0 hours
// (Sam McClure only; `adjustment` is 0 everywhere else).
export const isBillableRow = (entry) =>
  entry.billableHours > 0 || (entry.adjustment || 0) !== 0;

// "YYYY-MM" key of the PST calendar month an entry belongs to.
export const entryMonthKey = (entry) => {
  const entryDate = getEntryDate(entry);
  return `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
};

// Build the invoice-prep rows for one month + client selection, sorted by
// date. `userMap` maps userId -> display name; `getRateInfo(attorneyName,
// date)` returns { rate, found } — found:false means these hours bill at $0
// (no usable rate) and must be flagged (rateMissing), not hidden.
export function buildBillingRows(allEntries, { month, client, userMap = {}, getRateInfo }) {
  if (!allEntries || !month || !client) return [];

  return allEntries
    .filter((entry) => {
      if (!isBillableRow(entry)) return false;
      if (entryMonthKey(entry) !== month) return false;
      const clientName = entry.client || 'Unknown';
      return clientName === client;
    })
    .map((entry) => {
      const entryDate = getEntryDate(entry);
      const attorneyName = userMap[entry.userId] || entry.userId;
      const billableHours = entry.billableHours || 0;
      const adjustment = entry.adjustment || 0;

      const { rate, found: rateFound } = getRateInfo(attorneyName, entryDate);

      return {
        ...entry,
        attorneyName,
        rate,
        rateMissing: !rateFound && billableHours > 0,
        billableHours,
        adjustment,
        // Mirrors the sheet's Billables Earnings construction: the manual
        // month-end adjustment is part of the client's final bill.
        amount: rate * billableHours + adjustment,
        date: entryDate,
        category: entry.billingCategory || entry.category || 'Other',
        notes: entry.notes || '',
      };
    })
    .sort((a, b) => a.date - b.date);
}

// Only show the Adjustment column when the selection actually has one
// (McClure months) — every other bill keeps the familiar layout.
export const selectionHasAdjustments = (rows) =>
  rows.some((entry) => entry.adjustment !== 0);

export function computeBillingTotals(rows) {
  return rows.reduce(
    (acc, entry) => ({
      hours: acc.hours + entry.billableHours,
      adjustment: acc.adjustment + entry.adjustment,
      amount: acc.amount + entry.amount,
    }),
    { hours: 0, adjustment: 0, amount: 0 }
  );
}

// CSV row assembly for the export button: { headers, rows } including the
// trailing totals row, with the Adjustment column present only when the
// selection has one.
export function buildBillingCsvRows(billingRows) {
  const hasAdjustments = selectionHasAdjustments(billingRows);
  const totals = computeBillingTotals(billingRows);

  const headers = hasAdjustments
    ? ['Date', 'Attorney', 'Rate', 'Hours', 'Adjustment', 'Amount', 'Category', 'Notes']
    : ['Date', 'Attorney', 'Rate', 'Hours', 'Amount', 'Category', 'Notes'];
  const rows = billingRows.map((entry) => [
    entry.date.toLocaleDateString(),
    entry.attorneyName,
    entry.rate,
    entry.billableHours,
    ...(hasAdjustments ? [entry.adjustment.toFixed(2)] : []),
    entry.amount.toFixed(2),
    entry.category,
    entry.notes || '',
  ]);

  // Totals row
  rows.push([
    '', '', '',
    totals.hours.toFixed(1),
    ...(hasAdjustments ? [totals.adjustment.toFixed(2)] : []),
    totals.amount.toFixed(2),
    '', '',
  ]);

  return { headers, rows };
}

// Full CSV string for a selection (headers + rows + totals row).
export function buildBillingSummaryCsv(billingRows) {
  const { headers, rows } = buildBillingCsvRows(billingRows);
  return buildCsv(headers, rows);
}

export const billingSummaryFilename = (client, month) =>
  `billing-summary-${client.replace(/\s+/g, '-')}-${month}.csv`;
