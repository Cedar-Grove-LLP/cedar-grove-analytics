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
 * precedes the attorney's ENTIRE rate history — no prior month exists at
 * all — falls back retrospectively to their earliest stored nonzero rate,
 * flagged `retrospective: true`, so pre-history entries (e.g. 2024 hours
 * under a rates[] array that starts in 2025) bill at the first known rate
 * instead of a silent $0.
 *
 * `found` means "a usable (nonzero) rate was resolved": a fallback entry
 * that exists but holds rate 0/undefined still bills these hours at $0, so
 * it reports found: false — otherwise the missing-rate warning would stay
 * silent for exactly the silent-$0 case it exists to expose. The
 * retrospective fallback applies only when NO prior month key exists; a
 * mid-history gap landing on a rate-0 entry still reports found: false.
 *
 * Returns { rate, found, sourceMonthKey, requestedMonthKey } plus
 * retrospective: true on the earliest-rate path.
 */
export function findRateInfo(ratesMap, monthKey) {
  const miss = { rate: 0, found: false, sourceMonthKey: null, requestedMonthKey: monthKey };
  if (!ratesMap || !monthKey) return miss;

  const exactRate = ratesMap[monthKey]?.rate;
  if (exactRate) {
    return { rate: exactRate, found: true, sourceMonthKey: monthKey, requestedMonthKey: monthKey };
  }

  // Find the most recent month key before the requested one
  const sortedKeys = Object.keys(ratesMap).sort();
  let fallbackKey = null;
  for (const key of sortedKeys) {
    if (key < monthKey) {
      fallbackKey = key;
    } else {
      break;
    }
  }

  if (!fallbackKey) {
    // Requested month precedes the whole rate history — bill retrospectively
    // at the earliest stored nonzero rate.
    const earliestKey = sortedKeys.find((key) => ratesMap[key]?.rate);
    if (!earliestKey) return miss;
    return {
      rate: ratesMap[earliestKey].rate,
      found: true,
      retrospective: true,
      sourceMonthKey: earliestKey,
      requestedMonthKey: monthKey,
    };
  }

  const fallbackRate = ratesMap[fallbackKey]?.rate || 0;
  if (!fallbackRate) return miss;
  return {
    rate: fallbackRate,
    found: true,
    sourceMonthKey: fallbackKey,
    requestedMonthKey: monthKey,
  };
}

/**
 * Given a rates map ({ monthKey -> { rate } }) and a target monthKey,
 * returns the rate for that month. If no exact match, falls back to
 * the most recent prior month's rate.
 */
export function findRate(ratesMap, monthKey) {
  return findRateInfo(ratesMap, monthKey).rate;
}
