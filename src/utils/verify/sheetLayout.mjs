/**
 * Timesheet tab layout resolver. 93 tabs across 12 workbooks use 20+
 * distinct header row shapes (different eras, a per-attorney earnings-label
 * choice, and McClure's 2026 Jun/Jul "Adjustment ($)" column shifting
 * everything after it one to the right) — so every column is resolved BY
 * HEADER LABEL, scanned fresh per tab. Nothing here is a fixed index; the
 * McClure shift is exactly the case a fixed index would silently misread.
 *
 * Pure module — no Firebase imports, no network, no filesystem.
 * Node-importable and covered by tests/verify-sheet-layout.test.mjs.
 */

import { WORKBOOKS } from './workbooks.mjs';

// Column-header strings that identify "this is the earnings column" for a
// tab, independent of what dollar system they mean (TAKE_HOME vs
// CLIENT_BILLED classification is currency.mjs's job, not this module's —
// this list exists only to find the column). Keep in sync with
// currency.mjs's EARNINGS_LABEL_SYSTEM keys.
const EARNINGS_LABELS = [
  'Billables Earnings', 'Earnings', 'Billable Earnings',
  'Client Invoice', 'Billable to Client', 'Billables',
];

// Billable-side reimbursement column, distinct exact strings from the
// personal-reimbursement "Reimbursement Amount"/"Reimbursement Description"
// pair some 2026 tabs also carry on the ops side.
const BILLABLE_REIMBURSEMENT_LABELS = ['Reimbursements', 'Reimbursement'];

/**
 * Catalogued header shapes, encoded verbatim from the live books. Not
 * exhaustive of all 20+ real signatures — the ones this build's tests cover.
 * `header` lists only the non-empty cells, in order; real rows carry blank
 * spacer cells between the billable and ops blocks that don't affect
 * matching (see `meaningfulCells`).
 */
export const LAYOUT_SIGNATURES = Object.freeze([
  {
    id: 'std-2026-r11',
    layout: 'per-entry',
    earningsLabel: 'Billables Earnings',
    header: ['Client', 'Date', 'Hours', 'Billables Earnings', 'Billing Category', 'Matter',
      'Client Filing Fees', 'Notes', 'Ops', 'Category', 'Date', 'Hours', 'Company', 'Name',
      'Flat Fee', 'Reimbursement Description', 'Reimbursement Amount'],
  },
  {
    id: 'mcclure-adjustment-2026-r11',
    layout: 'per-entry',
    earningsLabel: 'Billables Earnings',
    header: ['Client', 'Date', 'Hours', 'Adjustment ($)', 'Billables Earnings', 'Billing Category',
      'Matter', 'Client Filing Fees', 'Notes', 'Ops', 'Category', 'Date', 'Hours', 'Company',
      'Name', 'Flat Fee', 'Reimbursement Description', 'Reimbursement Amount'],
  },
  {
    id: 'legacy-client-invoice-r9',
    layout: 'per-entry',
    earningsLabel: 'Client Invoice',
    header: ['Client', 'Date', 'Hours', 'Client Invoice', 'Billing Category', 'Notes',
      'Reimbursement', 'Ops', 'Category', 'Date', 'Hours', 'Company', 'Name', 'Flat Fee'],
  },
  {
    id: 'legacy-earnings-r9',
    layout: 'per-entry',
    earningsLabel: 'Earnings',
    header: ['Client', 'Date', 'Hours', 'Earnings', 'Billing Category', 'Reimbursements', 'Notes',
      'Ops', 'Category', 'Date', 'Hours', 'Company', 'Name', 'Flat Fee'],
  },
  {
    id: 'vanloon-billable-earnings-2025-r9',
    layout: 'per-entry',
    earningsLabel: 'Billable Earnings',
    header: ['Client', 'Date', 'Hours', 'Billable Earnings', 'Billing Category', 'Reimbursements',
      'Notes', 'Ops', 'Category', 'Date', 'Hours', 'Company', 'Name', 'Flat Fee'],
  },
  {
    id: 'uscanga-billable-to-client-2026-r9',
    layout: 'per-entry',
    earningsLabel: 'Billable to Client',
    header: ['Client', 'Date', 'Hours', 'Billable to Client', 'Billing Category', 'Matter',
      'Reimbursements', 'Notes', 'Ops', 'Category', 'Date', 'Hours', 'Company', 'Name', 'Flat Fee'],
  },
  {
    id: 'mcclure-client-matrix-2025',
    layout: 'client-matrix',
    earningsLabel: 'Billables',
    header: ['Client', 'Hrs Estimate (Val)', 'Hourly', 'Sam', 'Billables', 'Fees', 'Fees Notes',
      'General Notes', 'Ops', 'Category', 'Date', 'Hours'],
  },
]);

function meaningfulCells(row) {
  return (row || []).map((c) => String(c ?? '').trim()).filter((c) => c !== '');
}

function hasHeaderMarkers(row) {
  const cells = meaningfulCells(row);
  return cells.includes('Client') && (cells.includes('Hours') || cells.includes('Hrs Estimate (Val)'));
}

/** First index of `label` in `header`, or null — never -1, so callers never mistake "absent" for "last element". */
function firstIndex(header, label) {
  const i = header.indexOf(label);
  return i >= 0 ? i : null;
}

/** Index of the (n+1)th occurrence of `label` — the ops block repeats "Date"/"Hours". */
function nthIndex(header, label, n) {
  let seen = -1;
  for (let i = 0; i < header.length; i += 1) {
    if (header[i] === label) {
      seen += 1;
      if (seen === n) return i;
    }
  }
  return null;
}

function firstMatch(header, labels) {
  for (let i = 0; i < header.length; i += 1) {
    if (labels.includes(header[i])) return i;
  }
  return null;
}

/**
 * Matrix tabs (McClure 2025 Jan–Jun) use "Hrs Estimate (Val)" as the
 * billable-hours-equivalent column and carry only ONE "Hours" cell total
 * (the ops one); per-entry tabs carry two ("Hours" appears in both the
 * billable and ops blocks) — resolving billable hours this way means the
 * ops-hours resolution below (nthIndex(header, 'Hours', ...)) doesn't need
 * to branch on layout: matrix tabs want the 1st (only) occurrence, per-entry
 * tabs want the 2nd.
 */
function resolveHoursColumn(header) {
  const estimateIdx = header.indexOf('Hrs Estimate (Val)');
  return estimateIdx >= 0 ? estimateIdx : nthIndex(header, 'Hours', 0);
}

function resolveColumns(header) {
  const isMatrix = header.includes('Hrs Estimate (Val)');
  return {
    client: firstIndex(header, 'Client'),
    date: nthIndex(header, 'Date', 0),
    hours: resolveHoursColumn(header),
    adjustment: firstIndex(header, 'Adjustment ($)'),
    earnings: firstMatch(header, EARNINGS_LABELS),
    billingCategory: firstIndex(header, 'Billing Category'),
    matter: firstIndex(header, 'Matter'),
    clientFilingFees: firstIndex(header, 'Client Filing Fees'),
    fees: firstIndex(header, 'Fees'),
    feesNotes: firstIndex(header, 'Fees Notes'),
    hourly: firstIndex(header, 'Hourly'),
    notes: firstIndex(header, 'Notes'),
    generalNotes: firstIndex(header, 'General Notes'),
    reimbursement: firstMatch(header, BILLABLE_REIMBURSEMENT_LABELS),
    ops: firstIndex(header, 'Ops'),
    opsCategory: firstIndex(header, 'Category'),
    opsDate: nthIndex(header, 'Date', 1),
    opsHours: nthIndex(header, 'Hours', isMatrix ? 0 : 1),
    company: firstIndex(header, 'Company'),
    name: firstIndex(header, 'Name'),
    flatFee: firstIndex(header, 'Flat Fee'),
    reimbursementDescription: firstIndex(header, 'Reimbursement Description'),
    reimbursementAmount: firstIndex(header, 'Reimbursement Amount'),
  };
}

function matchCataloguedSignature(cells) {
  const key = cells.join('|');
  const hit = LAYOUT_SIGNATURES.find((sig) => sig.header.join('|') === key);
  return hit ? hit.id : null;
}

/**
 * Resolve a raw `values` grid (as returned by Sheets `batchGet`,
 * UNFORMATTED_VALUE) into a header row index + column map + earnings label.
 * Never guesses: if no row contains both "Client" and an hours-ish column
 * ("Hours" or "Hrs Estimate (Val)"), returns `{signatureId: null}` and
 * nothing else — callers must not read `.columns` in that case.
 *
 * A recognized header row that doesn't exactly match one of the catalogued
 * `LAYOUT_SIGNATURES` still resolves (columns are label-driven, not
 * dependent on the catalogue) — it gets a synthetic `custom:` id so the
 * coverage report can show it as resolved-but-uncatalogued rather than
 * conflating it with a genuinely unrecognized layout.
 */
export function resolveLayout(grid) {
  const rows = grid || [];
  const headerRowIndex = rows.findIndex(hasHeaderMarkers);
  if (headerRowIndex < 0) return { signatureId: null };

  const header = (rows[headerRowIndex] || []).map((c) => String(c ?? '').trim());
  const cells = meaningfulCells(header);
  const isMatrix = header.includes('Hrs Estimate (Val)');

  const cataloguedId = matchCataloguedSignature(cells);
  const signatureId = cataloguedId ?? `custom:${cells.join('|')}`;
  const columns = resolveColumns(header);

  return {
    signatureId,
    headerRowIndex,
    columns,
    earningsLabel: columns.earnings === null ? null : header[columns.earnings],
    layout: isMatrix ? 'client-matrix' : 'per-entry',
  };
}

// ---------------------------------------------------------------------------
// Tab name -> month key. NOT trivially by name: McClure's 2025 book has both
// "July" and "July25" (the sync used "July" — Firestore 2025_July hours
// 67.05 matches "July", not "July25"'s 6.8), a "Copy of June25" duplicate
// backup, and an unparseable "Dec 2024" tab. Explicit per-workbook overrides
// beat the generic parser; anything not overridden falls through to it.
// ---------------------------------------------------------------------------

export const TAB_MONTH_OVERRIDES = Object.freeze({
  'mcclure-2025': Object.freeze({
    July25: Object.freeze({
      monthKey: null,
      status: 'ignored',
      reason: 'duplicate of "July"; the sync used "July" (Firestore 2025_July hours 67.05 matches "July", not "July25"\'s 6.8)',
    }),
    'Copy of June25': Object.freeze({
      monthKey: null,
      status: 'ignored',
      reason: 'duplicate backup of "June25"',
    }),
    'Dec 2024': Object.freeze({
      monthKey: null,
      status: 'unparseable',
      reason: '"Dec 2024" does not match the tab-name month pattern used elsewhere in this book (header row also unrecognized — see resolveLayout)',
    }),
  }),
});

const MONTH_NUM = Object.freeze({
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10, november: 11, nov: 11,
  december: 12, dec: 12,
});

// Bare month name ("October") or month name + 2-digit year ("Jan25", "June25").
const TAB_NAME_PATTERN = /^([A-Za-z]+)(\d{2})?$/;

function parseGenericTabName(tabName, defaultYear) {
  const m = TAB_NAME_PATTERN.exec(String(tabName).trim());
  if (!m) return null;
  const monthNum = MONTH_NUM[m[1].toLowerCase()];
  if (!monthNum) return null;
  const year = m[2] ? 2000 + Number(m[2]) : defaultYear;
  if (!year) return null;
  return `${year}-${String(monthNum).padStart(2, '0')}`;
}

/**
 * Resolve a workbook tab name to a `{monthKey, status, reason}` record.
 * Checked in order: an explicit `TAB_MONTH_OVERRIDES` entry for this
 * workbook wins outright; otherwise a generic month-name parser runs
 * against the workbook's registered year (from `WORKBOOKS`).
 */
export function resolveTabToMonth(workbookKey, tabName) {
  const overrides = TAB_MONTH_OVERRIDES[workbookKey];
  if (overrides && Object.prototype.hasOwnProperty.call(overrides, tabName)) {
    return overrides[tabName];
  }

  const book = WORKBOOKS.find((w) => w.key === workbookKey);
  const monthKey = parseGenericTabName(tabName, book?.year ?? null);
  if (!monthKey) {
    return {
      monthKey: null,
      status: 'unparseable',
      reason: `"${tabName}" does not match any known month-name pattern`,
    };
  }
  return { monthKey, status: 'matched', reason: null };
}
