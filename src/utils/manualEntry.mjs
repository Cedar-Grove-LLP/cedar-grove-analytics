/**
 * Pure helpers behind the Timesheets (testing) manual-entry flow
 * (src/components/views/TimesheetsTestingView.jsx). Earnings are FROZEN into
 * the entry doc at save time (hours × take-home rate resolved for the entry's
 * month), so that math lives here — free of React/Firebase imports — where the
 * Node test runner can reach it (tests/manual-entry.test.mjs).
 *
 * The entry builders return plain JS values only: `date` is a plain Date
 * (noon local, so timezone display can't drift the day) that the component
 * wraps in a Firestore Timestamp, and createdAt/createdBy are appended by the
 * component at write time (serverTimestamp / auth user).
 */

import { findRateInfo } from './rateLookup.mjs';

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const monthIndex = (name) => MONTHS.indexOf(name);

// Month doc/key format used by sheetTotals maps and the month picker:
// "YYYY_MonthName" (e.g. "2026_July").
export const buildMonthKey = (year, month) => `${year}_${month}`;

export const parseMonthKey = (key) => {
  const idx = key.indexOf('_');
  if (idx < 0) return { year: 0, month: '' };
  return { year: Number(key.slice(0, idx)), month: key.slice(idx + 1) };
};

export const sortMonthKeysDesc = (keys) => [...keys].sort((a, b) => {
  const pa = parseMonthKey(a);
  const pb = parseMonthKey(b);
  if (pb.year !== pa.year) return pb.year - pa.year;
  return monthIndex(pb.month) - monthIndex(pa.month);
});

export const collectMonthKeys = (billables, ops, eightThreeB, sheetTotals) => {
  const keys = new Set(Object.keys(sheetTotals || {}));
  for (const entry of [...billables, ...ops, ...eightThreeB]) {
    if (entry?.year != null && entry?.month) keys.add(buildMonthKey(entry.year, entry.month));
  }
  return sortMonthKeysDesc([...keys]);
};

// Synced mirror rows sort by their sheet row; manual entries have no
// sheetRowNumber, so they fall to the end (Infinity).
export const sortBySheetRow = (rows) => [...rows].sort((a, b) => (a.sheetRowNumber ?? Infinity) - (b.sheetRowNumber ?? Infinity));

/**
 * Take-home rate for an entry date ("YYYY-MM-DD" ISO string), resolved with
 * the same backward fallback as every other rate lookup (findRateInfo in
 * rateLookup.mjs — exact month, else most recent prior month, else the
 * retrospective earliest-rate fallback for pre-history dates).
 *
 * NOTE (current behavior, pinned by tests): resolution keys off the CLIENT
 * `rate` field — findRateInfo finds the source month by `rate`, and the
 * take-home is then read from that same month's `takeHomeRate`. So a month
 * whose entry has takeHomeRate but a falsy `rate` never resolves, and a
 * resolved month with no `takeHomeRate` yields 0 (the UI blocks entry until
 * one is configured in User Management).
 */
export function resolveTakeHomeRate(ratesMap, dateIso) {
  if (!ratesMap || !dateIso) return 0;
  const info = findRateInfo(ratesMap, dateIso.slice(0, 7));
  return info.sourceMonthKey ? (Number(ratesMap[info.sourceMonthKey]?.takeHomeRate) || 0) : 0;
}

/**
 * Save-time earnings: hours × take-home rate (+ adjustment when present),
 * rounded to cents — mirroring the sheet's Billables Earnings construction.
 * Non-positive/invalid hours contribute $0 (manual entry requires hours > 0;
 * the adjustment param exists for sheet-shaped callers and defaults to 0).
 */
export function computeManualEarnings(hours, takeHomeRate, adjustment = 0) {
  const h = Number(hours);
  const adj = Number(adjustment) || 0;
  const base = h > 0 ? h * takeHomeRate : 0;
  return Math.round((base + adj) * 100) / 100;
}

const parseDateIso = (dateIso) => dateIso.split('-').map(Number);

/**
 * Doc payload for users/{id}/opsManual (minus Firestore-only fields — see
 * module header). `date` is noon local of the entry day.
 */
export function buildManualOpsEntry({ dateIso, description, category, hours }) {
  const [y, m, d] = parseDateIso(dateIso);
  return {
    date: new Date(y, m - 1, d, 12, 0, 0),
    description: description.trim(),
    category,
    hours: Number(hours),
    month: MONTHS[m - 1],
    year: y,
  };
}

/**
 * Doc payload for users/{id}/billablesManual (minus Firestore-only fields).
 * `earnings` is passed in already-frozen (the component shows the same number
 * it saves); manual entries always carry adjustment/reimbursements of 0.
 */
export function buildManualBillableEntry({ dateIso, client, matter, hours, earnings, billingCategory, notes }) {
  const [y, m, d] = parseDateIso(dateIso);
  return {
    date: new Date(y, m - 1, d, 12, 0, 0),
    client,
    matter: matter.trim(),
    hours: Number(hours),
    earnings,
    billingCategory,
    notes: notes.trim(),
    adjustment: 0,
    reimbursements: 0,
    month: MONTHS[m - 1],
    year: y,
  };
}
