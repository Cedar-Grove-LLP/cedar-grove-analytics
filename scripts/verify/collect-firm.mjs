/**
 * LIVE collector — firm-wide financials. Both tracks read the SAME
 * spreadsheet (workbooks.mjs's 'firm-2026' / 'firm-2025' entries — the
 * "Invoices (2026)" workbook the P&L waterfall AND the Payment Status
 * register both live in):
 *
 *   TRACK A — monthlyMetrics/all vs each month tab's P&L waterfall
 *     ('Revenue (Accrued):', 'Attorney Billables:', 'Firm Profits
 *     (Accrued):'). Cells are found by scanning column A for the exact
 *     label text, never a fixed row — the same policy sheetLayout.mjs uses
 *     for timesheet tabs, because this waterfall's row order has already
 *     shifted once (src/utils/invoicesSheetRanges.mjs's WF_KEYS fixed-row
 *     table is a *different*, pre-existing reader of this same sheet and is
 *     left untouched; this collector does its own independent label-scan
 *     read so a future row-order shift can't silently break both readers
 *     the same way).
 *   TRACK B — invoices/all vs the 'Payment Status' tab, joined by
 *     sheetRowNumber, field by field.
 *
 * Thin IO shell, same contract as collect-timesheets.mjs /
 * collect-formulas.mjs: builds UNCLASSIFIED Divergence[] and returns them;
 * the entry point runs classify() on every record. This module makes zero
 * decisions about what a divergence means — including which drift is
 * "expected" (status/dateReceived writeback, the firmProfit gap): that
 * judgment belongs entirely to classifiers.mjs.
 *
 * Read-only: spreadsheets.readonly (via scripts/lib/sheetsAuth.mjs) +
 * Firestore Admin read (via scripts/lib/firestore.mjs, passed in as `db`).
 */

import { makeDivergence } from '../../src/utils/verify/divergence.mjs';
import { WORKBOOKS } from '../../src/utils/verify/workbooks.mjs';
import { listTabs, batchGet, capGuard } from '../lib/sheetsAuth.mjs';
import { subjectFor, presentLeg, notCheckedLeg, round2 } from './subject.mjs';

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** Firestore Timestamp | {_seconds} | Date | string -> ISO string, or null. */
function tsToISO(ts) {
  if (!ts) return null;
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString();
  if (typeof ts._seconds === 'number') return new Date(ts._seconds * 1000).toISOString();
  if (ts instanceof Date) return ts.toISOString();
  return String(ts);
}

// =============================================================== TRACK A

// Exact column-A label text the P&L waterfall uses (verified live,
// 2026-07-16) -> the monthlyMetrics/all field it corresponds to. Scanned
// fresh per tab, never a fixed row.
const PNL_LABELS = {
  revenueAccrued: 'Revenue (Accrued):',
  attorneyBillables: 'Attorney Billables:',
  firmProfit: 'Firm Profits (Accrued):',
};

/** Scan column A of `grid` for `label`; return the numeric column-B value on that row, or null. */
function findLabelValue(grid, label) {
  for (let r = 0; r < grid.length; r += 1) {
    const cell = grid[r]?.[0];
    if (cell !== undefined && cell !== null && String(cell).trim() === label) {
      const v = grid[r]?.[1];
      return typeof v === 'number' ? v : null;
    }
  }
  return null;
}

/**
 * One firm-wide P&L book (firm-2026 or firm-2025). A book-level 403 (the
 * expected firm-2025 case) emits exactly ONE coverage divergence and
 * returns — never a per-month loop over an unreachable book.
 */
async function collectFirmMetrics({ token, db, firmBook, divergences, checks }) {
  const summary = { workbookKey: firmBook.key, monthsCompared: 0, bookBlindSpot: false, tabBlindSpots: 0, rangeCapHits: 0 };

  const metricsSnap = await db.doc('monthlyMetrics/all').get();
  const entries = metricsSnap.exists ? (metricsSnap.data().entries ?? []) : [];

  const tabsRes = await listTabs(token, firmBook.spreadsheetId);
  if (tabsRes.blindSpot) {
    summary.bookBlindSpot = true;
    divergences.push(makeDivergence({
      id: `coverage:${firmBook.key}:book`,
      domain: 'monthlyMetrics',
      subject: subjectFor(firmBook, null),
      metric: 'coverage',
      legs: { SHEET: notCheckedLeg(tabsRes.blindSpot.reason, tabsRes.blindSpot.httpStatus) },
    }));
    return summary;
  }

  let allTimeStoredFirmProfit = 0;
  let allTimeLiveFirmProfit = 0;

  for (const entry of entries) {
    if (entry.year !== firmBook.year) continue; // this book only covers its own year
    const monthNum = MONTH_NAMES.indexOf(entry.month) + 1;
    if (!monthNum) continue; // unrecognized month label — don't guess
    const monthKey = `${entry.year}-${String(monthNum).padStart(2, '0')}`;
    const tabName = entry.month;
    if (!tabsRes.tabs.has(tabName)) continue; // present in Firestore, not (yet) in the sheet — e.g. July

    const range = firmBook.tabRange.replace('{tab}', tabName);
    const { grids, blindSpot } = await batchGet(token, firmBook.spreadsheetId, [range]);
    if (blindSpot) {
      summary.tabBlindSpots += 1;
      divergences.push(makeDivergence({
        id: `coverage:${firmBook.key}:${monthKey}`,
        domain: 'monthlyMetrics',
        subject: { ...subjectFor(firmBook, monthKey), tab: tabName },
        metric: 'coverage',
        legs: { SHEET: notCheckedLeg(blindSpot.reason, blindSpot.httpStatus) },
      }));
      continue;
    }

    const grid = grids[range];
    const cap = capGuard(range, grid.length);
    if (cap.hit) {
      summary.rangeCapHits += 1;
      divergences.push(makeDivergence({
        id: `coverage:${firmBook.key}:${monthKey}:rangeCap`,
        domain: 'monthlyMetrics',
        subject: { ...subjectFor(firmBook, monthKey), tab: tabName },
        metric: 'rangeCap',
        legs: { SHEET: notCheckedLeg(`range cap hit — ${grid.length} rows >= bound ${cap.bound}; widen tabRange`, null) },
      }));
      continue;
    }

    summary.monthsCompared += 1;
    const syncedAt = tsToISO(entry.syncedAt);
    const subject = { ...subjectFor(firmBook, monthKey), tab: tabName };

    for (const [metric, label] of Object.entries(PNL_LABELS)) {
      const storedValue = entry[metric];
      if (storedValue === undefined) continue; // e.g. firmProfit not yet shipped to older docs — not a gap, just absent

      const liveValue = findLabelValue(grid, label);
      divergences.push(makeDivergence({
        id: `monthlyMetrics:${monthKey}:${metric}`,
        domain: 'monthlyMetrics',
        subject,
        metric,
        legs: {
          SHEET: presentLeg(liveValue, { columnLabel: label, rowsRead: grid.length }),
          FS_TOTALS: presentLeg(storedValue, { syncedAt }),
        },
      }));

      if (metric === 'firmProfit' && liveValue !== null) {
        allTimeStoredFirmProfit += storedValue;
        allTimeLiveFirmProfit += liveValue;
      }
    }
  }

  // The ledger's 'firmprofit-overstated-pre-opex' entry (knownDivergences.mjs)
  // bands on BOTH evidence.delta (monthly) and evidence.allTimeDelta. Neither
  // ruleKnownDefect nor ruleUnknown (classifiers.mjs) accepts a ctx that lets a
  // collector inject an all-time figure into a single month's evidence, and
  // this build's mandate is to import the pure core, not modify it — so
  // allTimeDelta can never reach any one divergence's evidence, and
  // matchBaseline() treats a band field absent from evidence as satisfied
  // (vacuously in-band), exactly like the elections-83b-times65-typo
  // 'bookCount' band collect-formulas.mjs documents. Each MONTH still lands
  // KNOWN+inBand on its own monthly delta (all six sit well under the 40000
  // band) so the run is not blocked by this gap. This `checks[]` entry is the
  // substitute surface for the all-time figure: computed directly from what
  // this collector read, independent of classification.
  if (summary.monthsCompared > 0) {
    const allTimeDelta = round2(allTimeStoredFirmProfit - allTimeLiveFirmProfit);
    checks.push({
      id: `firmprofit-alltime-delta:${firmBook.key}`,
      description: 'monthlyMetrics.firmProfit all-time stored-minus-live delta across every month compared this run',
      monthsCompared: summary.monthsCompared,
      allTimeStored: round2(allTimeStoredFirmProfit),
      allTimeLive: round2(allTimeLiveFirmProfit),
      allTimeDelta,
      band: { min: -Infinity, max: 65000 },
      inBand: allTimeDelta <= 65000,
    });
  }

  return summary;
}

// =============================================================== TRACK B

const PAYMENT_STATUS_RANGE = "'Payment Status'!A1:H2000";
const ENUM_STATUSES = new Set(['Paid', 'Not Paid', 'Payment Initiated']);

/** Sheets serial date (days since 1899-12-30) -> ISO "YYYY-MM-DD", or null. */
function serialToISO(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
}

/** Live sheet date serial -> 'M/D' (no leading zeros, year dropped). */
function sheetMonthDay(serial) {
  const iso = serialToISO(serial);
  if (!iso) return null;
  const [, mo, d] = iso.split('-').map(Number);
  return `${mo}/${d}`;
}

/**
 * Firestore date string -> 'M/D'. Accepts both the sync's own "M/D/YYYY"
 * format and a Mercury-writeback ISO timestamp ("YYYY-MM-DDTHH:mm:ss.sssZ")
 * — dateReceived can be either depending on whether the row was ever
 * touched by the writeback. The ground-truth rule: sheet '2/5' vs Firestore
 * '2/5/2025' compare EQUAL on month/day, year ignored.
 */
function fsMonthDay(value) {
  if (value === undefined || value === null || value === '') return null;
  const s = String(value);
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\//); // M/D/YYYY
  if (m) return `${Number(m[1])}/${Number(m[2])}`;
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); // ISO timestamp
  if (m) return `${Number(m[2])}/${Number(m[3])}`;
  return null;
}

/**
 * invoices/all vs 'Payment Status', joined by sheetRowNumber. A divergence
 * is emitted ONLY for rows that actually differ on a field — a matching
 * row needs no record (there's nothing for the classifier chain to say
 * about it). This is why the live EXPECTED_WRITEBACK count comes out to
 * ~75 (34 status + 41 dateReceived), not 556×2: every non-drifting row is
 * silently fine, exactly as it should read.
 */
async function collectInvoicesAll({ token, db, firmBook, divergences }) {
  const summary = {
    rowsCompared: 0, rowsMissingFromFirestore: 0,
    fieldMismatch: { client: 0, amount: 0, year: 0, dateSent: 0, lastReminder: 0, notes: 0 },
    statusDrift: 0, statusVocabulary: 0, statusVocabularyValues: [], dateReceivedDrift: 0,
  };

  const { grids, blindSpot } = await batchGet(token, firmBook.spreadsheetId, [PAYMENT_STATUS_RANGE]);
  if (blindSpot) {
    divergences.push(makeDivergence({
      id: `coverage:${firmBook.key}:paymentStatus`,
      domain: 'invoicesAll',
      subject: subjectFor(firmBook, null),
      metric: 'coverage',
      legs: { SHEET: notCheckedLeg(blindSpot.reason, blindSpot.httpStatus) },
    }));
    return summary;
  }

  const grid = grids[PAYMENT_STATUS_RANGE];
  const cap = capGuard(PAYMENT_STATUS_RANGE, grid.length);
  if (cap.hit) {
    divergences.push(makeDivergence({
      id: `coverage:${firmBook.key}:paymentStatus:rangeCap`,
      domain: 'invoicesAll',
      subject: subjectFor(firmBook, null),
      metric: 'rangeCap',
      legs: { SHEET: notCheckedLeg(`range cap hit — ${grid.length} rows >= bound ${cap.bound}; widen the range`, null) },
    }));
    return summary;
  }

  const invSnap = await db.doc('invoices/all').get();
  const fsEntries = invSnap.exists ? (invSnap.data().entries ?? []) : [];
  const byRow = new Map(fsEntries.map((e) => [e.sheetRowNumber, e]));

  const emit = (rowNum, subject, metric, sheetVal, fsVal, extraMeta = {}) => {
    divergences.push(makeDivergence({
      id: `invoicesAll:row-${rowNum}:${metric}`,
      domain: 'invoicesAll',
      subject,
      metric,
      legs: {
        SHEET: presentLeg(sheetVal, extraMeta),
        FS_TOTALS: presentLeg(fsVal, { entryCount: 1 }),
      },
    }));
  };

  for (let r = 1; r < grid.length; r += 1) { // row 0 is the header ('All 2026 Billing' total row)
    const row = grid[r];
    const rowNum = r + 1; // 1-based sheet row number — the join key
    const sheet = {
      client: row[0] ?? '',
      amount: typeof row[1] === 'number' ? row[1] : 0,
      year: typeof row[2] === 'number' ? row[2] : null,
      dateSent: row[3],
      status: row[4] ?? '',
      lastReminder: row[5],
      dateReceived: row[6],
      notes: row[7] ?? '',
    };

    const fs = byRow.get(rowNum);
    if (!fs) { summary.rowsMissingFromFirestore += 1; continue; }
    summary.rowsCompared += 1;

    const subject = { client: String(sheet.client || fs.client || ''), sheetRowNumber: rowNum };

    if (String(sheet.client || '').trim() !== String(fs.client || '').trim()) {
      emit(rowNum, subject, 'client', sheet.client, fs.client);
      summary.fieldMismatch.client += 1;
    }
    if (Math.abs(sheet.amount - (fs.amount || 0)) > 0.005) {
      emit(rowNum, subject, 'amount', sheet.amount, fs.amount);
      summary.fieldMismatch.amount += 1;
    }
    if (sheet.year !== fs.year) {
      emit(rowNum, subject, 'year', sheet.year, fs.year);
      summary.fieldMismatch.year += 1;
    }
    if (sheetMonthDay(sheet.dateSent) !== fsMonthDay(fs.dateSent)) {
      emit(rowNum, subject, 'dateSent', serialToISO(sheet.dateSent) ?? sheet.dateSent, fs.dateSent);
      summary.fieldMismatch.dateSent += 1;
    }
    if (sheetMonthDay(sheet.lastReminder) !== fsMonthDay(fs.lastReminder)) {
      emit(rowNum, subject, 'lastReminder', serialToISO(sheet.lastReminder) ?? sheet.lastReminder, fs.lastReminder);
      summary.fieldMismatch.lastReminder += 1;
    }
    if (String(sheet.notes || '').trim() !== String(fs.notes || '').trim()) {
      emit(rowNum, subject, 'notes', sheet.notes, fs.notes);
      summary.fieldMismatch.notes += 1;
    }

    if (String(sheet.status || '') !== String(fs.status || '')) {
      if (ENUM_STATUSES.has(String(sheet.status || ''))) {
        // Documented vocabulary — the intended one-way Mercury writeback target.
        emit(rowNum, subject, 'status', sheet.status, fs.status);
        summary.statusDrift += 1;
      } else {
        // Undocumented sheet status (e.g. "Write Off") — a vocabulary gap, not a
        // writeback drift, so it gets its own metric rather than ruleWriteback's
        // blanket EXPECTED_WRITEBACK. NOTE: the ledger's
        // 'invoices-status-vocabulary-writeoff' entry matches on
        // classification.evidence.value === 'Write Off', but neither
        // ruleUnknown (evidence: {signature, legs, rulesAttempted}) nor
        // ruleKnownDefect's collector-tag branch (evidence: {defectId,
        // expected, actual, delta, affectedRows, why}) ever populates an
        // evidence.value key — so today this divergence correctly, loudly
        // lands as UNKNOWN regardless of the ledger entry, per this build's
        // own test plan ("UNKNOWN unless baselined"). Fixing the ledger match
        // to key off evidence.actual (which DOES carry the sheet's raw
        // status via ruleUnknown's embedded `legs`) is a classifiers.mjs /
        // knownDivergences.mjs change — out of scope for a collector that
        // must only import the pure core.
        emit(rowNum, subject, 'statusVocabulary', sheet.status, fs.status);
        summary.statusVocabulary += 1;
        if (!summary.statusVocabularyValues.includes(sheet.status)) summary.statusVocabularyValues.push(sheet.status);
      }
    }
    if (sheetMonthDay(sheet.dateReceived) !== fsMonthDay(fs.dateReceived)) {
      emit(rowNum, subject, 'dateReceived', serialToISO(sheet.dateReceived) ?? sheet.dateReceived, fs.dateReceived);
      summary.dateReceivedDrift += 1;
    }
  }

  return summary;
}

// =============================================================== entry point

export async function collectFirmDivergences({ token, db }) {
  const divergences = [];
  const checks = [];

  const book2026 = WORKBOOKS.find((w) => w.key === 'firm-2026');
  const book2025 = WORKBOOKS.find((w) => w.key === 'firm-2025');
  if (!book2026 || !book2025) {
    throw new Error('collect-firm.mjs: workbooks.mjs is missing the firm-2026/firm-2025 entries');
  }

  const metrics2026 = await collectFirmMetrics({ token, db, firmBook: book2026, divergences, checks });
  const metrics2025 = await collectFirmMetrics({ token, db, firmBook: book2025, divergences, checks });
  const invoicesAll = await collectInvoicesAll({ token, db, firmBook: book2026, divergences });

  const coverage = { monthlyMetrics: { 'firm-2026': metrics2026, 'firm-2025': metrics2025 }, invoicesAll };
  return { divergences, coverage, checks };
}
