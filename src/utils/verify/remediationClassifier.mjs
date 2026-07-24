/**
 * Pure field- and doc-level classification for timesheet parity remediation.
 * Every numeric decision delegates to zeroAwareCompare so zero stays a real
 * value and absence remains distinct. Earnings preparation also centralizes
 * the client-billed to take-home oracle conversion before comparison.
 *
 * Pure module — no Firebase imports, no network, no filesystem.
 */

import { zeroAwareCompare } from './divergence.mjs';
import { classifyEarningsLabel, takeHomeRatio, oracleEarnings } from './currency.mjs';
import { findRateInfo } from '../rateLookup.mjs';
import { isDeepStrictEqual } from 'node:util';

export const CLASSIFICATION = Object.freeze({
  PHANTOM_83B: 'PHANTOM_83B',
  STALE_ENTRIES_CONVERTED: 'STALE_ENTRIES_CONVERTED',
  STALE_ENTRIES: 'STALE_ENTRIES',
  FIXABLE_ROLLUP: 'FIXABLE_ROLLUP',
  MISSING_IN_SHEET: 'MISSING_IN_SHEET',
  BLIND_SPOT: 'BLIND_SPOT',
  EMPTY_MIRROR_SKIPPED: 'EMPTY_MIRROR_SKIPPED',
  ALREADY_CLEAN: 'ALREADY_CLEAN',
});

export const DOC_PRECEDENCE = Object.freeze([
  CLASSIFICATION.PHANTOM_83B,
  CLASSIFICATION.STALE_ENTRIES_CONVERTED,
  CLASSIFICATION.STALE_ENTRIES,
  CLASSIFICATION.FIXABLE_ROLLUP,
  CLASSIFICATION.MISSING_IN_SHEET,
  CLASSIFICATION.BLIND_SPOT,
  CLASSIFICATION.EMPTY_MIRROR_SKIPPED,
  CLASSIFICATION.ALREADY_CLEAN,
]);

const absent = (value) => value === undefined || value === null;
const zeroOrAbsent = (value) => absent(value) || value === 0;

function result(classification, proposedValue, reason, agreement) {
  return { classification, proposedValue, reason, agreement };
}

function classifyAgreedReference({ reference, fsTotals, fsEntries, agreement, eps }) {
  const totalsVsEntries = zeroAwareCompare(fsTotals, fsEntries, eps);
  agreement.fsTotalsVsEntries = totalsVsEntries;
  if (absent(fsTotals) || totalsVsEntries.equal === false) {
    return result(
      CLASSIFICATION.FIXABLE_ROLLUP,
      fsEntries ?? reference,
      absent(fsTotals) ? 'sheetTotals field is absent' : 'sheetTotals disagrees with corroborated entries',
      agreement
    );
  }
  if (totalsVsEntries.equal === true) {
    return result(CLASSIFICATION.ALREADY_CLEAN, null, 'all available legs agree', agreement);
  }
  return result(CLASSIFICATION.BLIND_SPOT, null, 'sheetTotals could not be compared safely', agreement);
}

/** Classify one field after any earnings values have been oracle-converted. */
export function classifyField({
  field,
  sheetSummary,
  sheetRows,
  fsTotals,
  fsEntries,
  isEarningsUnresolvable = false,
  modelledHit = null,
  sheetReadable = true,
  eps = 0.02,
}) {
  const agreement = {
    sheetRowsVsEntries: zeroAwareCompare(sheetRows, fsEntries, eps),
    sheetSummaryVsEntries: zeroAwareCompare(sheetSummary, fsEntries, eps),
    fsTotalsVsEntries: zeroAwareCompare(fsTotals, fsEntries, eps),
  };

  if (modelledHit) {
    return result(CLASSIFICATION.MISSING_IN_SHEET, null, `modelled source: ${modelledHit.id}`, agreement);
  }
  if (field === 'earnings' && isEarningsUnresolvable) {
    return result(CLASSIFICATION.BLIND_SPOT, null, 'earnings dollar system could not be resolved', agreement);
  }
  if (field === 'totalHours' && (sheetSummary === undefined || sheetSummary === 0)) {
    if (zeroOrAbsent(fsTotals) && zeroOrAbsent(fsEntries)) {
      return result(CLASSIFICATION.ALREADY_CLEAN, null, 'blank combined-hours summary is absent by design', agreement);
    }
    return result(CLASSIFICATION.MISSING_IN_SHEET, null, 'combined-hours summary is blank; changes are forbidden', agreement);
  }
  if (!sheetReadable) {
    return result(CLASSIFICATION.BLIND_SPOT, null, 'sheet could not be read for this field', agreement);
  }
  if (sheetRows === undefined && sheetSummary === undefined) {
    if (zeroOrAbsent(fsTotals) && zeroOrAbsent(fsEntries)) {
      return result(CLASSIFICATION.ALREADY_CLEAN, null, 'readable sheet and Firestore contain no value', agreement);
    }
    return result(CLASSIFICATION.MISSING_IN_SHEET, null, 'readable sheet contains no value for existing Firestore data', agreement);
  }

  if (sheetRows !== undefined) {
    const rowsVsEntries = zeroAwareCompare(sheetRows, fsEntries, eps);
    agreement.sheetRowsVsEntries = rowsVsEntries;
    if (rowsVsEntries.equal === false || (rowsVsEntries.equal === null && absent(fsEntries))) {
      return result(CLASSIFICATION.STALE_ENTRIES, sheetRows, 'sheet rows disagree with or are missing from entries', agreement);
    }
    if (rowsVsEntries.equal !== true) {
      return result(CLASSIFICATION.BLIND_SPOT, null, 'sheet rows and entries could not be compared safely', agreement);
    }

    if (sheetSummary !== undefined) {
      const summaryVsEntries = zeroAwareCompare(sheetSummary, fsEntries, eps);
      agreement.sheetSummaryVsEntries = summaryVsEntries;
      if (summaryVsEntries.equal !== true) {
        return result(CLASSIFICATION.BLIND_SPOT, null, 'sheet summary conflicts with otherwise-agreed rows and entries', agreement);
      }
    }
    return classifyAgreedReference({ reference: sheetRows, fsTotals, fsEntries, agreement, eps });
  }

  const summaryVsEntries = zeroAwareCompare(sheetSummary, fsEntries, eps);
  agreement.sheetSummaryVsEntries = summaryVsEntries;
  if (summaryVsEntries.equal === false || (summaryVsEntries.equal === null && absent(fsEntries))) {
    return result(CLASSIFICATION.STALE_ENTRIES, sheetSummary, 'sheet summary disagrees with or is missing from entries', agreement);
  }
  if (summaryVsEntries.equal !== true) {
    return result(CLASSIFICATION.BLIND_SPOT, null, 'sheet summary and entries could not be compared safely', agreement);
  }
  return classifyAgreedReference({ reference: sheetSummary, fsTotals, fsEntries, agreement, eps });
}

/**
 * Convert both sheet earnings legs into Firestore's take-home dollar system.
 *
 * The row-level earnings COLUMN and the pre-header summary CELL are two
 * independently-labelled sheet locations that are not guaranteed to share a
 * dollar system — e.g. Colin van Loon's 2025 tabs sum a `Client Invoice`
 * column (CLIENT_BILLED) but separately carry a `Billable Earnings` summary
 * cell that is already TAKE_HOME (per currency.mjs's EARNINGS_LABEL_SYSTEM
 * and the codebase's own documented invariant: the summary cell is always
 * take-home). Applying the row column's client->take-home ratio to an
 * already-take-home summary value double-converts it and manufactures a
 * false disagreement. Each leg is therefore classified and converted from
 * its OWN label — `summaryLabel` defaults to `earningsLabel` only when the
 * caller has no independent summary label to offer (preserves prior
 * behavior for callers/tests that only track one label).
 */
export function prepareEarningsLegs({
  sheetSummary, sheetRows, earningsLabel, summaryLabel, ratesMap, monthKey,
}) {
  const rowsLabelSystem = classifyEarningsLabel(earningsLabel);
  const summaryLabelSystem = summaryLabel === undefined
    ? rowsLabelSystem
    : classifyEarningsLabel(summaryLabel);

  if (rowsLabelSystem === 'UNKNOWN') {
    return {
      sheetSummary: undefined,
      sheetRows: undefined,
      labelSystem: rowsLabelSystem,
      ratio: null,
      rateInfo: null,
      reason: 'unknown earnings label',
      isEarningsUnresolvable: true,
    };
  }

  let ratio = null;
  let rateInfo = null;
  let reason = null;
  if (rowsLabelSystem === 'CLIENT_BILLED' || summaryLabelSystem === 'CLIENT_BILLED') {
    rateInfo = findRateInfo(ratesMap, monthKey);
    ({ ratio, reason } = takeHomeRatio(rateInfo));
  }

  // The replacement entries[] built from sheet rows depend on the ROWS leg
  // resolving — an unresolvable summary leg alone degrades that leg to
  // "not corroborating" (below), never blocks the whole field.
  if (rowsLabelSystem === 'CLIENT_BILLED' && ratio === null) {
    return {
      sheetSummary: undefined,
      sheetRows: undefined,
      labelSystem: rowsLabelSystem,
      ratio: null,
      rateInfo,
      reason,
      isEarningsUnresolvable: true,
    };
  }

  const summaryUnresolvable = summaryLabelSystem === 'UNKNOWN'
    || (summaryLabelSystem === 'CLIENT_BILLED' && ratio === null);

  return {
    sheetSummary: (sheetSummary === undefined || summaryUnresolvable)
      ? undefined
      : oracleEarnings({ sheetEarnings: sheetSummary, labelSystem: summaryLabelSystem, ratio }),
    sheetRows: sheetRows === undefined
      ? undefined
      : oracleEarnings({ sheetEarnings: sheetRows, labelSystem: rowsLabelSystem, ratio }),
    labelSystem: rowsLabelSystem,
    ratio,
    rateInfo,
    reason: null,
    isEarningsUnresolvable: false,
  };
}

/**
 * A CLIENT_BILLED rows column is safe to freeze only when the sheet's own,
 * independently-labelled take-home summary corroborates the converted row
 * sum. This relabels only stale-entry signals because their shared write is
 * the doc-wide entries[] replacement; unrelated rollup/coverage signals are
 * deliberately left alone.
 */
export function convertOrSuppressClientBilledStaleness({
  results, changes, summaryCellValue, convertedEntriesSum, ratio, rateInfo, eps = 0.02,
}) {
  const summaryPresent = summaryCellValue !== undefined && summaryCellValue !== null;
  const agreement = summaryPresent
    ? zeroAwareCompare(summaryCellValue, convertedEntriesSum, eps)
    : { equal: null, state: 'ONE_ABSENT' };

  if (!summaryPresent || agreement.equal !== true) {
    const reason = 'CLIENT_BILLED conversion requires an agreeing Billable Earnings summary cell';
    return {
      results: results.map((fieldResult) => fieldResult.classification === CLASSIFICATION.STALE_ENTRIES
        ? { ...fieldResult, classification: CLASSIFICATION.BLIND_SPOT, proposedValue: null, reason }
        : fieldResult),
      changes: changes.filter((change) => change.classification !== CLASSIFICATION.STALE_ENTRIES),
    };
  }

  return {
    results: results.map((fieldResult) => fieldResult.classification === CLASSIFICATION.STALE_ENTRIES
      ? { ...fieldResult, classification: CLASSIFICATION.STALE_ENTRIES_CONVERTED }
      : fieldResult),
    changes: changes.map((change) => change.classification === CLASSIFICATION.STALE_ENTRIES
      ? {
          ...change,
          classification: CLASSIFICATION.STALE_ENTRIES_CONVERTED,
          summaryCellValue,
          ratio,
          rateProvenance: rateInfo,
        }
      : change),
  };
}

/** A phantom signature is delete-eligible only when the freshly-read sheet is empty. */
export function isPhantomDeleteEligible({ isPhantom, liveSheetEntryCount }) {
  return isPhantom === true && liveSheetEntryCount === 0;
}

/** Keep empty sheet mirrors reviewable without turning them into writes by default. */
export function demoteEmptyMirrorCreation(resultValue, {
  docExists, sheetEmpty, includeEmptyMirrors,
}) {
  if (!includeEmptyMirrors
      && !docExists
      && sheetEmpty
      && resultValue.classification === CLASSIFICATION.STALE_ENTRIES) {
    return { ...resultValue, classification: CLASSIFICATION.EMPTY_MIRROR_SKIPPED };
  }
  return resultValue;
}

/**
 * Compare only the portions a frozen payload can overwrite. Deletes are the
 * exception: removing a doc requires the entire current doc to still equal
 * the dry-run backup.
 */
// A live snapshot holds Firestore Timestamp instances while the frozen
// artifact holds their JSON round-trip ({_seconds,_nanoseconds} or
// {seconds,nanoseconds} plain objects). isDeepStrictEqual sees those as
// different (prototype + key names), so both sides must be canonicalized
// before comparing or every entries-bearing doc reports phantom drift.
const timestampParts = (value) => {
  if (value === null || typeof value !== 'object') return null;
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number'
      && typeof value.toMillis === 'function') {
    return [value.seconds, value.nanoseconds];
  }
  const keys = Object.keys(value);
  if (keys.length !== 2) return null;
  if (typeof value.seconds === 'number' && typeof value.nanoseconds === 'number') {
    return [value.seconds, value.nanoseconds];
  }
  if (typeof value._seconds === 'number' && typeof value._nanoseconds === 'number') {
    return [value._seconds, value._nanoseconds];
  }
  return null;
};

/** Deep-map timestamps (instance or serialized) to one comparable shape. */
export function canonicalizeForDrift(value) {
  const ts = timestampParts(value);
  if (ts) return { __driftTimestamp: `${ts[0]}.${String(ts[1]).padStart(9, '0')}` };
  if (Array.isArray(value)) return value.map(canonicalizeForDrift);
  if (value !== null && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = canonicalizeForDrift(v);
    return out;
  }
  return value;
}

const driftEqual = (a, b) => isDeepStrictEqual(canonicalizeForDrift(a), canonicalizeForDrift(b));

/**
 * Flatten an update payload's sheetTotals into dotted field paths.
 *
 * Firestore update({sheetTotals: {...}}) REPLACES the whole map, silently
 * deleting sibling rollup keys the payload didn't mention (how the first
 * tranche-B apply dropped billableEarnings etc.). Dotted paths merge per key
 * instead. Only sheetTotals needs this: entries/entryCount are deliberate
 * whole-value replacements.
 */
export function expandUpdatePayload(payload) {
  const out = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === 'sheetTotals' && value && typeof value === 'object') {
      for (const [totalKey, totalValue] of Object.entries(value)) {
        out[`sheetTotals.${totalKey}`] = totalValue;
      }
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function computeDrift({ liveExists, liveData, priorState, op, payload }) {
  if (liveExists !== priorState.exists) {
    return { drifted: true, reason: 'doc existence changed since the dry run' };
  }
  if (op === 'delete' && !driftEqual(liveData, priorState.data)) {
    return { drifted: true, reason: 'live doc state no longer matches the dry-run backup' };
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'entries')
      && !driftEqual(liveData?.entries, priorState.data?.entries)) {
    return { drifted: true, reason: 'live entries no longer match the dry-run backup' };
  }
  if (payload && Object.prototype.hasOwnProperty.call(payload, 'sheetTotals')) {
    for (const key of Object.keys(payload.sheetTotals)) {
      if (!driftEqual(liveData?.sheetTotals?.[key], priorState.data?.sheetTotals?.[key])) {
        return { drifted: true, reason: 'live sheetTotals no longer match the dry-run backup' };
      }
    }
  }
  return { drifted: false, reason: null };
}

/** Roll field/doc signals into exactly one doc bucket using fixed precedence. */
export function rollupDocClassification(signals = []) {
  const classes = new Set(signals.map((signal) =>
    typeof signal === 'string'
      ? signal
      : signal?.isPhantom
        ? CLASSIFICATION.PHANTOM_83B
        : signal?.classification
  ));
  return DOC_PRECEDENCE.find((classification) => classes.has(classification))
    ?? CLASSIFICATION.ALREADY_CLEAN;
}
