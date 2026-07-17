/**
 * Pure billing-rate lookup helpers shared by the React hooks
 * (src/hooks/useAttorneyRates.js), the Node audit/migration scripts
 * (scripts/), and tests. Must stay free of React/Firebase imports.
 *
 * A rates map is { 'YYYY-MM': { rate, ... } } for a single attorney,
 * as built from the users/{userId}.rates[] array in FirestoreDataContext.
 */

/**
 * Normalize a date-ish value (Firestore Timestamp, {seconds}, Date, string)
 * to a 'YYYY-MM' month key. Returns null when the value can't be parsed.
 * The acceptance order mirrors the original hook logic exactly.
 */
export function monthKeyFromDate(date) {
  let dateObj;

  if (date && typeof date === 'object' && date.seconds) {
    dateObj = new Date(date.seconds * 1000);
  } else if (date instanceof Date) {
    dateObj = date;
  } else if (typeof date === 'string') {
    dateObj = new Date(date);
  } else if (date && typeof date === 'object' && date.toDate) {
    dateObj = date.toDate();
  } else {
    return null;
  }

  if (isNaN(dateObj.getTime())) {
    return null;
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1;
  return `${year}-${String(month).padStart(2, '0')}`;
}

/**
 * Look up the rate for a month key: an exact match wins, otherwise the most
 * recent prior month's rate is used (backward fallback). A lookup that
 * precedes the attorney's ENTIRE rate history — strictly before their
 * earliest stored key — falls back retrospectively to their earliest stored
 * nonzero rate, flagged `retrospective: true`, so pre-history entries (e.g.
 * 2024 hours under a rates[] array that starts in 2025) bill at the first
 * known rate instead of a silent $0.
 *
 * `found` means "a usable (nonzero) rate was resolved": a fallback entry
 * that exists but holds rate 0/undefined still bills these hours at $0, so
 * it reports found: false — otherwise the missing-rate warning would stay
 * silent for exactly the silent-$0 case it exists to expose. The
 * retrospective fallback applies ONLY when monthKey is strictly before the
 * earliest key in the map — a falsy-rate entry AT the earliest key itself
 * (or any other mid-history gap) still reports found: false, never a
 * forward look at a later month's rate.
 *
 * Returns { rate, found, sourceMonthKey, requestedMonthKey, takeHomeRate } plus
 * retrospective: true on the earliest-rate path. takeHomeRate is the source
 * rate entry's own takeHomeRate (null if absent) — needed by the ORACLE leg
 * (src/utils/verify/currency.mjs takeHomeRatio) to derive the client→take-home
 * ratio without a second lookup.
 */
export function findRateInfo(ratesMap, monthKey) {
  const miss = {
    rate: 0, found: false, sourceMonthKey: null, requestedMonthKey: monthKey, takeHomeRate: null,
  };
  if (!ratesMap || !monthKey) return miss;

  const found = (rate, sourceMonthKey, extra) => ({
    rate,
    found: true,
    sourceMonthKey,
    requestedMonthKey: monthKey,
    takeHomeRate: ratesMap[sourceMonthKey]?.takeHomeRate ?? null,
    ...extra,
  });

  const exactRate = ratesMap[monthKey]?.rate;
  if (exactRate) {
    return found(exactRate, monthKey);
  }

  const sortedKeys = Object.keys(ratesMap).sort();
  const earliestKeyOverall = sortedKeys[0];

  // Strictly before the whole history — genuine pre-history, not merely "no
  // backward-fallback key exists" (that also happens when monthKey EQUALS
  // the earliest key and that key's own rate is falsy, which is a
  // mid-history gap and must fall through to the miss path below).
  if (earliestKeyOverall && monthKey < earliestKeyOverall) {
    const earliestUsableKey = sortedKeys.find((key) => ratesMap[key]?.rate);
    if (!earliestUsableKey) return miss;
    return found(ratesMap[earliestUsableKey].rate, earliestUsableKey, { retrospective: true });
  }

  // Backward fallback: most recent month strictly before the requested one.
  let fallbackKey = null;
  for (const key of sortedKeys) {
    if (key < monthKey) {
      fallbackKey = key;
    } else {
      break;
    }
  }

  const fallbackRate = fallbackKey ? ratesMap[fallbackKey]?.rate || 0 : 0;
  if (!fallbackRate) return miss;
  return found(fallbackRate, fallbackKey);
}

/**
 * Given a rates map ({ monthKey -> { rate } }) and a target monthKey,
 * returns the rate for that month. If no exact match, falls back to
 * the most recent prior month's rate.
 */
export function findRate(ratesMap, monthKey) {
  return findRateInfo(ratesMap, monthKey).rate;
}
