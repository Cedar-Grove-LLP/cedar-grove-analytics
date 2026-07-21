/**
 * Constraint 1 — the two dollar systems. Every timesheet tab's earnings
 * column is either the attorney's TAKE_HOME pay or the CLIENT_BILLED
 * amount; Firestore's `entries[].earnings` is ALWAYS take-home. Naively
 * diffing a CLIENT_BILLED sheet column against Firestore produces a false
 * positive on every such tab (~$424K all-time) — the ORACLE derivation
 * here is what tells the two apart and catches the one case where they're
 * both wrong for the same reason (the discount-rate defect).
 *
 * Label map verified across all 93 tabs (2026-07-16) — exact match only,
 * anything else is UNKNOWN and must never be guessed.
 *
 * Pure module — no React/Firebase imports; Node-importable and covered by
 * tests/verify-divergence.test.mjs.
 */

export const EARNINGS_LABEL_SYSTEM = Object.freeze({
  // TAKE-HOME (66 of 93 tabs) — already what Firestore stores.
  'Billables Earnings': 'TAKE_HOME', // 55 tabs
  'Earnings': 'TAKE_HOME', //  8 tabs
  'Billable Earnings': 'TAKE_HOME', //  3 tabs
  // CLIENT-BILLED (26 of 93 tabs) — needs the take-home ratio applied.
  'Client Invoice': 'CLIENT_BILLED', // 13 tabs
  'Billable to Client': 'CLIENT_BILLED', //  5 tabs
  'Billables': 'CLIENT_BILLED', //  8 tabs — McClure 2025 matrix
});

/** Exact match only. Anything else -> 'UNKNOWN', never guessed. */
export function classifyEarningsLabel(label) {
  return EARNINGS_LABEL_SYSTEM[label] ?? 'UNKNOWN';
}

/**
 * The client -> take-home ratio for a month, from users/{id}.rates[] via
 * findRateInfo (rateLookup.mjs). `rateInfo` is that shape:
 *   { rate, takeHomeRate, found, sourceMonthKey, ... }
 * where `rate` is the CLIENT rate and `takeHomeRate` the attorney's own
 * pay rate for the same month (some rate entries lack takeHomeRate — Sam
 * McClure 9 of 19, Valery Uscanga 2 of 6 — that's a genuine "not on file",
 * not a zero, so ratio is null with a reason rather than guessed).
 */
export function takeHomeRatio(rateInfo) {
  const rate = rateInfo?.rate;
  const takeHomeRate = rateInfo?.takeHomeRate;

  if (!rate) return { ratio: null, reason: 'rate missing or zero' };
  if (takeHomeRate === undefined || takeHomeRate === null) {
    return { ratio: null, reason: 'takeHomeRate not on file for this month' };
  }

  return { ratio: takeHomeRate / rate, reason: null };
}

/**
 * The ORACLE leg's value for an earnings metric. For a TAKE_HOME tab the
 * sheet's own number IS the oracle (nothing to convert). For a
 * CLIENT_BILLED tab, oracleEarnings = sheetEarnings * ratio — reproducing
 * take-home from the sheet's client dollars and the attorney's own rate
 * ratio, independent of what Firestore stored. Returns null (never a
 * guessed number) when the label is UNKNOWN or the ratio couldn't be
 * resolved.
 */
export function oracleEarnings({ sheetEarnings, labelSystem, ratio }) {
  if (sheetEarnings === undefined || sheetEarnings === null) return null;

  if (labelSystem === 'TAKE_HOME') return round2(sheetEarnings);
  if (labelSystem === 'CLIENT_BILLED') {
    if (ratio === undefined || ratio === null) return null;
    return round2(sheetEarnings * ratio);
  }

  return null; // UNKNOWN label — never guessed.
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
