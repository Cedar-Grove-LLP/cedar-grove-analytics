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
  pctOfBookClients: {
    label: '% of Client Book',
    formula: 'client count ÷ total clients × 100',
    inputs: ['client counts', 'total client book'],
    source: SOURCE.COMPUTED,
  },
  avgHoursPerTransaction: {
    label: 'Avg Hours',
    formula: 'total hours ÷ matters (or entries when a category has no matters)',
    inputs: ['per-category hours', 'matter/entry counts'],
    source: SOURCE.COMPUTED,
  },
  projectedEarnings: {
    label: 'Projected Earnings',
    formula: 'Σ over remaining months: (target hours − actual this month) × projected rate',
    inputs: ['monthly targets (admin-entered)', 'rate card ladder (Q2/Q4 rank bumps, capped at rank 19)', 'YTD actuals'],
    source: SOURCE.COMPUTED,
    notes: ['If the current rate has no exact rate-card match, the current rate is projected flat with no rank bumps.'],
  },
  projectedHours: {
    label: 'Projected Hours',
    formula: 'Σ over remaining months: target hours − actual hours this month (never below 0)',
    inputs: ['monthly billable targets (admin-entered)', 'current-month actual hours'],
    source: SOURCE.COMPUTED,
  },
  predictedTotal: {
    label: 'Predicted Total',
    formula: 'YTD earnings + projected earnings for the remaining months',
    inputs: ['YTD actual earnings', 'projected earnings (rate card model)'],
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
