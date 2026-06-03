// Out-of-office (OOO) and firm-holiday helpers, sourced from the `timeOff/all`
// Firestore document (synced from the firm's shared Google Calendar — see
// FirestoreSchema.md). Pure helpers, in the style of hiddenAttorneys.js / roles.js.
//
// These feed the utilization target pro-rating (getMonthProRateFraction in
// dateHelpers.js): firm holidays are baked into the monthly target, while an
// attorney's OOO proportionally reduces their expected target for any period.
//
// All consumers are read-only; the app never writes `timeOff/all`. Everything
// here tolerates a null/missing doc so behavior is unchanged before the sync ships.

import { getUSFederalHolidays, toDateKey, getMonthProRateFraction } from './dateHelpers';

// Normalize a person name for matching: trim, lowercase, collapse inner whitespace.
const normalizeName = (name) => (name || '').trim().toLowerCase().replace(/\s+/g, ' ');

// Normalize an email for matching: trim, lowercase.
const normalizeEmail = (email) => (email || '').trim().toLowerCase();

// Parse a 'YYYY-MM-DD' string as a LOCAL calendar day (avoids the UTC shift that
// `new Date('YYYY-MM-DD')` introduces, which can roll the day across timezones).
const parseDateKey = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

// Canonicalize a date string to zero-padded 'YYYY-MM-DD' so it matches the keys
// produced by toDateKey (which every membership test uses). Tolerates a
// non-zero-padded sync (e.g. '2026-7-3'); returns null for unparseable input.
const normalizeDateKey = (s) => {
  const d = parseDateKey(s);
  return d ? toDateKey(d) : null;
};

// Expand an inclusive [start, end] date-string range to 'YYYY-MM-DD' keys.
const expandRange = (start, end) => {
  const keys = [];
  const s = parseDateKey(start);
  if (!s) return keys;
  const e = end ? parseDateKey(end) : s;
  if (!e) return keys;
  const cur = new Date(s);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(e);
  last.setHours(0, 0, 0, 0);
  let guard = 0; // defensive cap against malformed ranges
  while (cur <= last && guard < 1000) {
    keys.push(toDateKey(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return keys;
};

/**
 * Parse the raw `timeOff/all` Firestore doc into fast lookup structures.
 * Tolerant of a null/missing doc and missing fields (pre-rollout safe).
 *
 * @param {object|null} timeOffDoc - { holidays: [{date, name}],
 *                                      outOfOffice: [{name, email, start, end, title}] }
 * @returns {{
 *   holidaySet: Set<string>,
 *   oooByEmail: Map<string, Set<string>>,
 *   oooByName: Map<string, Set<string>>,
 *   hasHolidays: boolean,
 * }}
 */
export const parseTimeOff = (timeOffDoc) => {
  const holidaySet = new Set();
  const oooByEmail = new Map();
  const oooByName = new Map();

  if (timeOffDoc && Array.isArray(timeOffDoc.holidays)) {
    timeOffDoc.holidays.forEach((h) => {
      if (!h || !h.date) return;
      const key = normalizeDateKey(h.date); // zero-pad so it matches toDateKey
      if (key) holidaySet.add(key);
    });
  }

  if (timeOffDoc && Array.isArray(timeOffDoc.outOfOffice)) {
    timeOffDoc.outOfOffice.forEach((o) => {
      if (!o) return;
      const keys = expandRange(o.start, o.end);
      if (keys.length === 0) return;

      const addTo = (map, lookupKey) => {
        if (!lookupKey) return;
        let set = map.get(lookupKey);
        if (!set) {
          set = new Set();
          map.set(lookupKey, set);
        }
        keys.forEach((k) => set.add(k));
      };

      addTo(oooByEmail, normalizeEmail(o.email));
      addTo(oooByName, normalizeName(o.name));
    });
  }

  return { holidaySet, oooByEmail, oooByName, hasHolidays: holidaySet.size > 0 };
};

/**
 * Resolve the firm-holiday date-key set for the spanned years.
 *
 * When the synced doc carries holidays, they are the source of truth (the user's
 * "replace holidays" choice). Otherwise fall back to the hardcoded US federal
 * holidays for each spanned year, so behavior is unchanged before the sync ships.
 *
 * (isBusinessDay also excludes federal holidays independently, so a federal
 * holiday the firm works can't be "un-excluded" while it remains in isBusinessDay
 * — an accepted limitation; see FirestoreSchema.md.)
 */
export const getHolidaySet = (parsed, startDate, endDate) => {
  if (parsed && parsed.hasHolidays) return parsed.holidaySet;

  const set = new Set();
  if (!startDate || !endDate) return set;
  const startYear = startDate.getFullYear();
  const endYear = endDate.getFullYear();
  for (let y = startYear; y <= endYear; y++) {
    getUSFederalHolidays(y).forEach((d) => set.add(toDateKey(d)));
  }
  return set;
};

/**
 * The OOO date-key set for a person, joined by email first (exact, normalized),
 * then by name (exact, normalized). Returns an empty Set when nothing matches.
 *
 * There is no nickname resolution here — canonicalize the display name/email in
 * the sync (Apps Script) so the dashboard only does exact normalized matching.
 */
export const getOooSetFor = (parsed, { name, email } = {}) => {
  if (!parsed) return new Set();
  const byEmail = email ? parsed.oooByEmail.get(normalizeEmail(email)) : null;
  if (byEmail) return byEmail;
  const byName = name ? parsed.oooByName.get(normalizeName(name)) : null;
  return byName || new Set();
};

/**
 * Count business-day OOO and holidays within [startDate, endDate] for a person,
 * for UI context messaging. Counts weekdays (Mon–Fri) only; holidays take
 * precedence over OOO so the two never double-count.
 *
 * Optional precomputed sets avoid redundant work when called in a per-month loop:
 * pass the range-level holidaySet (so federal fallback isn't rebuilt each call)
 * and the person's oooSet.
 *
 * @returns {{ oooBusinessDays: number, holidayBusinessDays: number }}
 */
export const countTimeOffInRange = (
  parsed,
  person,
  startDate,
  endDate,
  holidaySetOverride = null,
  oooSetOverride = null,
) => {
  let oooBusinessDays = 0;
  let holidayBusinessDays = 0;
  if (!startDate || !endDate) return { oooBusinessDays, holidayBusinessDays };

  const holidaySet = holidaySetOverride || getHolidaySet(parsed, startDate, endDate);
  const oooSet = oooSetOverride || getOooSetFor(parsed, person || {});

  const cur = new Date(startDate);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(endDate);
  last.setHours(0, 0, 0, 0);

  while (cur <= last) {
    // Plain weekday check (NOT isBusinessDay): we WANT weekday holidays — including
    // federal ones — counted here so the UI can surface them; isBusinessDay would
    // skip federal holidays and under-report. Holidays take precedence over OOO.
    const day = cur.getDay();
    if (day !== 0 && day !== 6) {
      const key = toDateKey(cur);
      if (holidaySet && holidaySet.has(key)) holidayBusinessDays++;
      else if (oooSet && oooSet.has(key)) oooBusinessDays++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  return { oooBusinessDays, holidayBusinessDays };
};

/**
 * Resolve one month's capacity-model pro-rate fraction plus its OOO/holiday
 * business-day counts for the effective window (month ∩ range, with the
 * in-progress current month clamped to `now`). Shared by both utilization
 * pro-rating sites (useAnalyticsData `attorneyData` and AttorneyDetailView
 * `calculatedTargets`) so the effective-window + fraction + counting glue lives
 * in one place; the caller multiplies its own per-month target by `fraction`.
 *
 * Note: each call site still owns its month SET (the aggregate view pro-rates
 * every calendar month in range; the detail view only months with entries) — a
 * deliberate, pre-existing difference tied to how each handles "all-time".
 *
 * @param {number} year
 * @param {number} month - 1-indexed
 * @param {{startDate: Date|null, endDate: Date|null, currentMonthKey: string, now: Date}} range
 * @param {Set<string>} holidaySet
 * @param {Set<string>} oooSet
 * @returns {{ fraction:number, oooDays:number, holidayDays:number, effectiveStart:Date, effectiveEnd:Date }}
 */
export const proRateMonth = (year, month, range, holidaySet, oooSet) => {
  const { startDate, endDate, currentMonthKey, now } = range || {};
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0, 23, 59, 59, 999);
  const monthKey = `${year}-${String(month).padStart(2, '0')}`;

  // Effective window = month ∩ range, with the current month pro-rated to today.
  const effectiveStart = (startDate && startDate > monthStart) ? startDate : monthStart;
  let effectiveEnd;
  if (endDate && endDate < monthEnd) {
    effectiveEnd = endDate;                  // explicit end before month end (last-week, custom)
  } else if (monthKey === currentMonthKey) {
    effectiveEnd = now;                      // in-progress current month → pro-rate to today
  } else {
    effectiveEnd = monthEnd;
  }

  const { fraction } = getMonthProRateFraction(year, month, effectiveStart, effectiveEnd, holidaySet, oooSet);
  const { oooBusinessDays, holidayBusinessDays } =
    countTimeOffInRange(null, null, effectiveStart, effectiveEnd, holidaySet, oooSet);

  return { fraction, oooDays: oooBusinessDays, holidayDays: holidayBusinessDays, effectiveStart, effectiveEnd };
};
