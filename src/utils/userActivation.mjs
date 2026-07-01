/**
 * Pure helpers for gating attorney/user visibility by their activation
 * (join) date. Consumed by hooks/components that need to know whether a
 * user should count as "on the roster yet" for a given as-of date. Must
 * stay free of React/Firebase imports.
 *
 * users/{id}.activationDate is stored as a "YYYY-MM" string, produced by an
 * HTML <input type="month"> in the admin UI — day-of-month precision isn't
 * tracked since nothing in the app pro-rates a partial month of tenure.
 * "YYYY-MM-DD" is also accepted defensively (e.g. a direct Firestore edit).
 */

/**
 * Parse a "YYYY-MM" (or "YYYY-MM-DD") activationDate string into a
 * local-midnight Date at the 1st of that month (or the given day). Returns
 * null for falsy input or an unparseable/calendar-invalid string.
 */
export function parseActivationDate(value) {
  if (!value) return null;

  const parts = value.split('-').map(Number);
  if (parts.length === 2) parts.push(1);
  if (parts.length !== 3) return null;
  const [y, m, dd] = parts;

  // Numeric Date(y, m-1, d) form is always local time, so no day drifts in
  // from a UTC-vs-local mismatch (see customDateStart/customDateEnd parsing
  // in useAnalyticsData.js, which uses the same y/m/d construction).
  const d = new Date(y, m - 1, dd);

  // Guard against calendar-invalid input (e.g. "2026-13" or "2026-02-30"),
  // which `new Date()` silently rolls into an adjacent month instead of
  // rejecting.
  if (d.getFullYear() !== y || d.getMonth() !== m - 1 || d.getDate() !== dd) return null;

  return d;
}

const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december'];

/**
 * Strictly resolve a long month name ("January") to a 1-indexed number, or
 * null if unrecognized. Unlike dateHelpers.getMonthNumber, does NOT fall back
 * to January for bad input — a garbage month must not poison the min below.
 */
function monthNameToNumber(month) {
  const idx = MONTH_NAMES.indexOf(String(month || '').trim().toLowerCase());
  return idx === -1 ? null : idx + 1;
}

/**
 * Derive an attorney's first-activity month from their time entries, as a
 * "YYYY-MM" string suitable for `activationDate`. Returns null when no entry
 * carries a recognizable month/year (so callers can leave the field blank
 * rather than write a bogus date).
 *
 * Each entry is floored by its parent-document `month`/`year` (the authoritative
 * period the sheet was synced for), NOT its per-entry `date` — per-entry dates
 * can drift outside their month (FirestoreDataContext warns on this), so the
 * doc's month/year is the reliable signal. Pass billables and ops entries
 * together to capture whichever came first.
 */
export function deriveActivationMonth(entries) {
  let best = null; // { year, monthNum }
  for (const entry of entries || []) {
    const year = Number(entry?.year);
    const monthNum = monthNameToNumber(entry?.month);
    if (!Number.isInteger(year) || monthNum === null) continue;
    if (!best || year < best.year || (year === best.year && monthNum < best.monthNum)) {
      best = { year, monthNum };
    }
  }
  if (!best) return null;
  return `${best.year}-${String(best.monthNum).padStart(2, '0')}`;
}

/**
 * Whether `user` had already joined as of `asOfDate`.
 */
export function hasJoinedBy(user, asOfDate) {
  const activationDate = parseActivationDate(user?.activationDate);

  // No recorded activation date means "always applicable" — preserves
  // backward compatibility with existing users that predate this field.
  if (!activationDate) return true;

  // No asOfDate means an unbounded/all-time range, which no join date can fail.
  if (!asOfDate) return true;

  return activationDate.getTime() <= asOfDate.getTime();
}
