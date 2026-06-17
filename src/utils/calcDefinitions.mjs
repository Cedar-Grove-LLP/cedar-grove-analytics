/**
 * Central registry of every calculated value displayed in the dashboard:
 * its human-readable formula, the inputs used, and — for values synced from
 * the org's Google Sheets — the source workbook/tab and cell or range in
 * BOTH sheet layout families (the row-11 "current" layout and the row-9
 * "legacy" layout still used by older tabs).
 *
 * This registry is the single source of truth for "what is this number?"
 * tooltips (see components/shared/CalcTooltip.jsx and the `sourceNote` prop
 * on chart tooltips). Every new user-visible calculated value must reference
 * a key here. Pure module — no React/Firebase imports; validated by
 * tests/calc-definitions.test.mjs.
 */

export const SOURCE = Object.freeze({
  COMPUTED: 'computed',           // dashboard computes from synced sheet rows
  SHEET_LITERAL: 'sheet-literal', // value copied as-is from a sheet cell/column
  ADMIN_ENTERED: 'admin-entered', // entered in the dashboard admin UI, NOT from sheets
  CALENDAR: 'calendar',           // firm Google Calendar sync
  MERCURY: 'mercury',             // Mercury bank API sync
  DRIVE: 'drive',                 // Google Drive activity sync
});

const WORKBOOK_LABELS = {
  invoices: "'{year} - Invoices ({lastName})' workbook → month tab",
  rates: 'rates workbook → monthly tab',
  paymentStatusTab: "Invoices workbook → 'Payment Status' tab",
};

/**
 * Render a sheetRef ({ workbook, label, scope, currentCell?, legacyCell? })
 * as the dual-layout reference string, e.g.:
 *   "'{year} - Invoices ({lastName})' workbook → month tab →
 *    'Billable Earnings' summary cell (B3 in current layout / B2 in legacy layout)"
 * Equal cells collapse to "(B1 in both layouts)"; scope 'line' has no cell.
 */
export function formatSheetRef(ref) {
  if (!ref) return '';
  const base = `${WORKBOOK_LABELS[ref.workbook] || ref.workbook} → '${ref.label}' ${ref.scope}`;
  if (!ref.currentCell && !ref.legacyCell) return base;
  const cells = ref.currentCell === ref.legacyCell
    ? `${ref.currentCell} in both layouts`
    : `${ref.currentCell} in current layout / ${ref.legacyCell} in legacy layout`;
  return `${base} (${cells})`;
}

// Pre-rendered refs reused inside notes — coordinates must flow through
// formatSheetRef so each cell reference has exactly one validated source.
const BILLABLE_EARNINGS_SUMMARY_REF = formatSheetRef({
  workbook: 'invoices', label: 'Billable Earnings', scope: 'summary cell', currentCell: 'B3', legacyCell: 'B2',
});
const SHEET_RATE_CELL_REF = formatSheetRef({
  workbook: 'invoices', label: 'Rate', scope: 'summary cell', currentCell: 'B2', legacyCell: 'B4',
});

const SHORT_SOURCE = {
  [SOURCE.COMPUTED]: 'computed by the dashboard',
  [SOURCE.SHEET_LITERAL]: 'synced as-is from Google Sheets',
  [SOURCE.ADMIN_ENTERED]: 'admin-entered in the dashboard, not from sheets',
  [SOURCE.CALENDAR]: 'synced from the firm Google Calendar',
  [SOURCE.MERCURY]: 'synced from the Mercury API',
  [SOURCE.DRIVE]: 'synced from Google Drive activity',
};

export const CALC_DEFINITIONS = Object.freeze({
  billableHours: {
    label: 'Billable Hours',
    formula: 'Σ billable entry hours within the selected date range and filters',
    inputs: ['per-row entry hours', 'date range + attorney/client filters'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'invoices', label: 'Hours', scope: 'column', currentCell: 'C12 down', legacyCell: 'C10 down' },
    notes: ["The sheet's own 'Total Billable Hours' summary cell (B1 in both layouts) sums the whole tab; the dashboard re-sums rows after date filtering, so the two can differ."],
  },
  opsHours: {
    label: 'Ops Hours',
    formula: 'Σ ops entry hours within the selected date range and filters',
    inputs: ['per-row ops hours', 'date range + attorney filters'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'invoices', label: 'Hours (Ops section)', scope: 'column', currentCell: 'M12 down', legacyCell: 'M10 down' },
    notes: ["The sheet's 'Ops Hours' summary cell (F1 in both layouts) sums the whole tab; the dashboard re-sums rows after date filtering."],
  },
  totalHours: {
    label: 'Total Hours',
    formula: 'Billable Hours + Ops Hours',
    inputs: ['billable hours', 'ops hours'],
    source: SOURCE.COMPUTED,
  },
  earnings: {
    label: 'Earnings (take-home)',
    formula: 'Σ per-entry earnings, exactly as synced from the sheet',
    inputs: ['per-row earnings values'],
    source: SOURCE.SHEET_LITERAL,
    sheetRef: { workbook: 'invoices', label: 'Billables Earnings', scope: 'column', currentCell: 'D12 down', legacyCell: 'D10 down' },
    notes: [
      'Not recomputed as rate × hours — differences vs Gross Billables are expected.',
      `Sheet summary: ${BILLABLE_EARNINGS_SUMMARY_REF}.`,
    ],
  },
  entryEarnings: {
    label: 'Entry Earnings',
    formula: 'The earnings value of this single sheet row, as synced',
    inputs: ['one sheet row'],
    source: SOURCE.SHEET_LITERAL,
    sheetRef: { workbook: 'invoices', label: 'Billables Earnings', scope: 'column', currentCell: 'D (entry row)', legacyCell: 'D (entry row)' },
  },
  utilizationPct: {
    label: 'Utilization %',
    formula: '(Billable Hours + Ops Hours) ÷ pro-rated target × 100',
    inputs: ['billable + ops hours', 'pro-rated monthly targets'],
    source: SOURCE.COMPUTED,
    notes: ['Shows N/A when there is no target in the period (e.g. fully out of office).'],
  },
  proRatedTarget: {
    label: 'Pro-rated Target',
    formula: 'monthly target × (fractional working days in window ÷ in full month)',
    inputs: ['monthly targets (admin-entered)', 'out-of-office + firm holidays (firm Google Calendar)'],
    source: SOURCE.COMPUTED,
    notes: ['OOO compresses rather than reduces: the same monthly total is paced over fewer working days.'],
  },
  pacePct: {
    label: 'Pace %',
    formula: 'hours ÷ pro-rated target × 100',
    inputs: ['billable or ops hours', 'pro-rated monthly targets'],
    source: SOURCE.COMPUTED,
  },
  annualTarget: {
    label: 'Annual Target',
    formula: 'Σ monthly target (Jan–Dec) for the selected year',
    inputs: ['12 monthly hour targets (admin-entered)'],
    source: SOURCE.COMPUTED,
    notes: ['Attorneys meter Client (billable) hours; Ops staff meter Ops hours. Shows N/A when no target is set for the year.'],
  },
  annualActualYtd: {
    label: 'Actual YTD',
    formula: 'Σ logged hours from Jan 1 through today (PST)',
    inputs: ['billable or ops entry hours', "today's date in PST"],
    source: SOURCE.COMPUTED,
    notes: ['For a past year this is the full-year total; for a future year it is 0.'],
  },
  annualRemaining: {
    label: 'Remaining',
    formula: 'max(Annual Target − Actual YTD, 0)',
    inputs: ['annual target', 'actual YTD hours'],
    source: SOURCE.COMPUTED,
    notes: ['Floored at 0 once the annual target is met.'],
  },
  annualPctComplete: {
    label: '% Complete',
    formula: 'Actual YTD ÷ Annual Target × 100',
    inputs: ['actual YTD hours', 'annual target'],
    source: SOURCE.COMPUTED,
    notes: ['The progress bar fill is clamped to 100%; the text keeps the real value.'],
  },
  annualPaceMarker: {
    label: 'Pace marker',
    formula: 'Σ (month target × month capacity fraction) ÷ Annual Target × 100',
    inputs: ['monthly targets (admin-entered)', 'per-month capacity (completed = 1, current month = working capacity elapsed through today, future = 0)', 'out-of-office + firm holidays (firm Google Calendar)'],
    source: SOURCE.COMPUTED,
    notes: ['Where you "should" be by today. OOO/holidays compress the current month’s capacity, lowering the marker — they never reduce the annual target.'],
  },
  annualPaceDelta: {
    label: 'Pace (Ahead / Behind)',
    formula: 'Actual YTD − pace-expected hours',
    inputs: ['actual YTD hours', 'capacity-weighted pace-expected hours'],
    source: SOURCE.COMPUTED,
    notes: ['Within ±1h of pace shows On track; above shows Ahead; below shows Behind. A future year shows Not started rather than Behind.'],
  },
  timeSplitPct: {
    label: 'Time Split %',
    formula: 'Billable ÷ (Billable + Ops) × 100, and the ops complement',
    inputs: ['billable hours', 'ops hours'],
    source: SOURCE.COMPUTED,
  },
  grossBillables: {
    label: 'Gross Billables',
    formula: 'Σ (billing rate × hours) per entry',
    inputs: ['billing rate (admin-entered, matched to the entry month with backward fallback)', 'per-row entry hours'],
    source: SOURCE.COMPUTED,
    notes: ["The billing rate is NOT the sheet's 'Rate' cell (that is take-home pay). Entries with no stored rate bill at $0 and raise the Overview warning."],
  },
  totalBillablesAttorney: {
    label: 'Total Billables (firm-wide)',
    formula: 'Σ synced monthly Attorney Billables across the in-range months',
    inputs: ['monthly Attorney Billables figures'],
    source: SOURCE.SHEET_LITERAL,
    sheetRef: { workbook: 'rates', label: 'Attorney Billables', scope: 'line' },
    notes: ['Used only when the selected range aligns to whole calendar months (or the current month-to-date).'],
  },
  totalBillablesRevenueAccrued: {
    label: 'Revenue Accrued (firm-wide)',
    formula: 'Σ synced monthly Revenue Accrued across the in-range months',
    inputs: ['monthly Revenue Accrued figures'],
    source: SOURCE.SHEET_LITERAL,
    sheetRef: { workbook: 'rates', label: 'Revenue Accrued', scope: 'summary cell', currentCell: 'B10', legacyCell: 'B10' },
    notes: ['Shown when Attorney Billables is not synced for every in-range month.'],
  },
  totalBillablesRateTimesHours: {
    label: 'Total Billables (rate × hours)',
    formula: 'Σ (billing rate × hours) across the cohort',
    inputs: ['billing rates (admin-entered)', 'per-row entry hours'],
    source: SOURCE.COMPUTED,
    notes: ['Fallback used for partial/custom ranges and sub-cohorts, where the firm-wide sheet figures do not apply.'],
  },
  pctOfTotalOps: {
    label: '% of Ops Total',
    formula: 'category ops hours ÷ total ops hours × 100',
    inputs: ['per-category ops hours', 'total ops hours in range'],
    source: SOURCE.COMPUTED,
  },
  pctOfTotalTransactions: {
    label: '% of Total',
    formula: 'category hours ÷ total billable hours × 100',
    inputs: ['per-category billable hours', 'total billable hours in range'],
    source: SOURCE.COMPUTED,
  },
  paymentStatusTag: {
    label: 'Payment Status',
    formula: 'auto-tagged from avg payment time + outstanding invoices; never set manually',
    inputs: ['synced invoice rows (sent/received dates, status)', 'client payment terms'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
    notes: [
      'On Target: avg ≤ 15d, ≥90% paid within 15d, 0 outstanding. Hold: 2+ overdue at once, 1 invoice 30+ days overdue, or avg > 30d. Warning: everything in between.',
      'Hold is sticky: exiting requires zero balance + 2 clean billing cycles, stepping down to Warning first.',
      'Refreshes whenever the Payment Status sheet re-syncs.',
    ],
  },
  onTargetClients: {
    label: 'On Target Clients',
    formula: 'count of clients with avg payment ≤ 15d, ≥90% of invoices paid within 15d, and 0 outstanding invoices',
    inputs: ['synced invoice rows per client', 'total client book'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
    notes: ['Clients with no invoice history count as On Target (no payment issues on record).'],
  },
  warningClients: {
    label: 'Warning Clients',
    formula: 'count of clients with avg payment 22–30d, or 1 invoice 21+ days overdue, or 2 unpaid invoices accumulated',
    inputs: ['synced invoice rows per client', 'client payment terms', 'total client book'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
    notes: ['Warning is the middle bucket: it also absorbs any client who misses the On Target bar without triggering Hold, so the three tags cover the whole book.'],
  },
  holdClients: {
    label: 'Hold Clients',
    formula: 'count of clients with 2+ invoices overdue at once, or 1 invoice 30+ days overdue, or avg payment > 30d',
    inputs: ['synced invoice rows per client', 'client payment terms', 'total client book'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
    notes: [
      'Hold clients take no new matters without partner approval.',
      'Exiting Hold requires zero balance + 2 clean billing cycles, stepping down to Warning first — never straight to On Target.',
    ],
  },
  avgPaymentDays: {
    label: 'Avg Days',
    formula: 'mean of (date received − date sent) across the client’s paid invoices',
    inputs: ['synced invoice sent/received dates'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
  },
  outstandingInvoices: {
    label: 'Outstanding',
    formula: 'count of invoices sent but not yet paid',
    inputs: ['synced invoice rows (status, sent/received dates)'],
    source: SOURCE.COMPUTED,
    sheetRef: { workbook: 'paymentStatusTab', label: 'invoice rows', scope: 'rows (row 2 down)' },
  },
  avgHoursPerTransaction: {
    label: 'Avg Hours',
    formula: 'total hours ÷ matters (or entries when a category has no matters)',
    inputs: ['per-category hours', 'matter/entry counts'],
    source: SOURCE.COMPUTED,
  },
  projectedEarnings: {
    label: 'Projected Earnings (take-home)',
    formula: 'Σ over remaining months: (target hours − actual this month) × projected take-home rate',
    inputs: ['monthly targets (admin-entered)', 'rate card ladder (Q2/Q4 rank bumps, capped at rank 19)', 'YTD actuals'],
    source: SOURCE.COMPUTED,
    notes: [
      'Rank is matched on the client rate; the payout uses the attorney (take-home) column — Colin rate for Colin.',
      'If the current client rate has no exact rate-card match, take-home is unknown and the projection is $0.',
    ],
  },
  projectedHours: {
    label: 'Projected Hours',
    formula: 'Σ over remaining months: target hours − actual hours this month (never below 0)',
    inputs: ['monthly billable targets (admin-entered)', 'current-month actual hours'],
    source: SOURCE.COMPUTED,
  },
  activeClients: {
    label: 'Active Clients',
    formula: 'count of clients with billable hours in the selected range',
    inputs: ['billable entries per client', 'date range'],
    source: SOURCE.COMPUTED,
  },
  quietClients: {
    label: 'Quiet Clients',
    formula: 'count of clients with no billable hours in the selected range',
    inputs: ['billable entries per client', 'date range', 'total client book'],
    source: SOURCE.COMPUTED,
  },
  shareOfTotalHours: {
    label: '% of Total',
    formula: "this row's billable hours ÷ total billable hours in view × 100",
    inputs: ['per-row summed hours', 'view-wide total hours'],
    source: SOURCE.COMPUTED,
  },
  targetVariance: {
    label: 'Variance',
    formula: 'actual hours − target hours',
    inputs: ['summed entry hours', 'monthly targets (admin-entered)'],
    source: SOURCE.COMPUTED,
  },
  targetHours: {
    label: 'Target Hours',
    formula: 'monthly billable/ops hour targets as entered',
    inputs: ['admin Targets page'],
    source: SOURCE.ADMIN_ENTERED,
  },
  billingRate: {
    label: 'Billing Rate',
    formula: "the attorney's stored rate for the entry month, falling back to the most recent prior month",
    inputs: ['admin User Management rates'],
    source: SOURCE.ADMIN_ENTERED,
    notes: [`The sheet's take-home Rate cell — ${SHEET_RATE_CELL_REF} — is NOT this billing rate.`],
  },
  serviceBreadth: {
    label: 'Service Breadth',
    formula: 'count of distinct billing categories per client in the selected range',
    inputs: ['per-client billable entries', 'billing categories'],
    source: SOURCE.COMPUTED,
  },
  uniqueFiles: {
    label: 'Unique Files',
    formula: 'count of distinct files downloaded in the selected range',
    inputs: ['Drive activity events'],
    source: SOURCE.DRIVE,
  },
  uniqueUsers: {
    label: 'Unique Users',
    formula: 'count of distinct users who downloaded in the selected range',
    inputs: ['Drive activity events'],
    source: SOURCE.DRIVE,
  },
  downloads: {
    label: 'Downloads',
    formula: 'count of Drive download events in the selected range',
    inputs: ['Drive activity events across the 5 tracked folders'],
    source: SOURCE.DRIVE,
  },
});

export const REQUIRED_KEYS = Object.freeze(Object.keys(CALC_DEFINITIONS));

const sourceLine = (def) => {
  const ref = def.sheetRef ? formatSheetRef(def.sheetRef) : '';
  switch (def.source) {
    case SOURCE.SHEET_LITERAL:
      return `Synced literal from ${ref} — not recomputed by the dashboard`;
    case SOURCE.ADMIN_ENTERED:
      return 'Entered by admins in this dashboard — not synced from Google Sheets';
    case SOURCE.COMPUTED:
      return ref ? `Computed in dashboard from ${ref}` : 'Computed in dashboard from synced data';
    default:
      return SHORT_SOURCE[def.source] ? `Source: ${SHORT_SOURCE[def.source]}` : '';
  }
};

/**
 * Tooltip body lines for a registry key: formula, inputs, source, notes,
 * then any dynamic context (e.g. the OOO pace-adjustment sentence).
 */
export function getCalcTooltipLines(key, dynamic = {}) {
  const def = CALC_DEFINITIONS[key];
  if (!def) return [`Unknown metric: ${key}`];
  return [
    def.label,
    `= ${def.formula}`,
    `Inputs: ${def.inputs.join('; ')}`,
    sourceLine(def),
    ...(def.notes || []),
    ...(dynamic.context ? [dynamic.context] : []),
  ].filter(Boolean);
}

/** One compact line for chart hover tooltips. */
export function getSourceNote(key) {
  const def = CALC_DEFINITIONS[key];
  if (!def) return '';
  return `${def.formula} — ${SHORT_SOURCE[def.source] || def.source}`;
}
