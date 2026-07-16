import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LEG,
  LEG_STATE,
  CLASS,
  SEVERITY,
  makeDivergence,
  zeroAwareCompare,
  agreementSignature,
} from '../src/utils/verify/divergence.mjs';
import {
  EARNINGS_LABEL_SYSTEM,
  classifyEarningsLabel,
  takeHomeRatio,
  oracleEarnings,
} from '../src/utils/verify/currency.mjs';

// ---------------------------------------------------------- zeroAwareCompare

test('zeroAwareCompare(0, 0) -> BOTH_ZERO, equal true (silent)', () => {
  assert.deepEqual(zeroAwareCompare(0, 0), { equal: true, state: 'BOTH_ZERO' });
});

test('zeroAwareCompare(0, 340) -> BOTH_PRESENT_DIFFER — the >0 guard regression', () => {
  // src/context/FirestoreDataContext.js:219,229,280,355 and
  // scripts/lib/audit-helpers.mjs:123,126,130 all guard with `sheetTotals.X > 0`,
  // which SKIPS this exact case (FS_TOTALS === 0, real value 340). This is
  // the whole reason zeroAwareCompare exists: 0 is a value, not "no check".
  assert.deepEqual(zeroAwareCompare(0, 340), { equal: false, state: 'BOTH_PRESENT_DIFFER' });
});

test('zeroAwareCompare(undefined, 0) -> ONE_ABSENT, never "equal"', () => {
  const result = zeroAwareCompare(undefined, 0);
  assert.equal(result.state, 'ONE_ABSENT');
  assert.notEqual(result.equal, true);
});

test('zeroAwareCompare(null, undefined) -> BOTH_ABSENT, never "equal"', () => {
  const result = zeroAwareCompare(null, undefined);
  assert.equal(result.state, 'BOTH_ABSENT');
  assert.notEqual(result.equal, true);
});

test('zeroAwareCompare(10.001, 10) -> equal within default eps', () => {
  assert.deepEqual(zeroAwareCompare(10.001, 10), { equal: true, state: 'BOTH_PRESENT_EQUAL' });
});

test('zeroAwareCompare respects a custom eps', () => {
  assert.equal(zeroAwareCompare(10.03, 10, 0.02).equal, false);
  assert.equal(zeroAwareCompare(10.03, 10, 0.05).equal, true);
});

// ------------------------------------------------------------------ makeDivergence

test('makeDivergence fills omitted legs as NOT_APPLICABLE and sets classification null', () => {
  const d = makeDivergence({
    id: 'billables:test:2026-01:hours',
    domain: 'billables',
    subject: { attorney: 'Test', userId: 'test-id', monthKey: '2026-01' },
    metric: 'hours',
    legs: {
      [LEG.SHEET]: { state: LEG_STATE.PRESENT, value: 10, meta: {} },
      [LEG.FS_ENTRIES]: { state: LEG_STATE.PRESENT, value: 10, meta: {} },
    },
  });

  assert.equal(d.legs[LEG.SHEET].value, 10);
  assert.equal(d.legs[LEG.FS_ENTRIES].value, 10);
  assert.equal(d.legs[LEG.FS_TOTALS].state, LEG_STATE.NOT_APPLICABLE);
  assert.equal(d.legs[LEG.SITE].state, LEG_STATE.NOT_APPLICABLE);
  assert.equal(d.legs[LEG.ORACLE].state, LEG_STATE.NOT_APPLICABLE);
  assert.equal(d.classification, null);
  assert.equal(d.signature, 'SHEET=FS_ENTRIES');
});

test('CLASS and SEVERITY carry the full taxonomy', () => {
  for (const key of ['OK', 'CROSS_SYSTEM_OK', 'MODELLED', 'STALE_SYNC', 'SCHEMA_GAP',
    'EXPECTED_WRITEBACK', 'BLIND_SPOT', 'DEFECT', 'UNKNOWN']) {
    assert.equal(CLASS[key], key);
  }
  for (const key of ['ok', 'info', 'blind_spot', 'defect']) {
    assert.equal(SEVERITY[key], key);
  }
});

// ------------------------------------------------------------- agreementSignature

// The Ohta 2025-09 leg set from BUILD-SPEC-verify.md §4/§5: sheet is the
// client-billed number, FS_TOTALS/FS_ENTRIES/ORACLE all agree at take-home.
const ohtaLegs = {
  [LEG.SHEET]: { state: LEG_STATE.PRESENT, value: 50655, meta: {} },
  [LEG.FS_TOTALS]: { state: LEG_STATE.PRESENT, value: 30393, meta: {} },
  [LEG.FS_ENTRIES]: { state: LEG_STATE.PRESENT, value: 30393, meta: {} },
  [LEG.SITE]: { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} },
  [LEG.ORACLE]: { state: LEG_STATE.PRESENT, value: 30393, meta: {} },
};

test('agreementSignature on the Ohta leg set -> FS_TOTALS=FS_ENTRIES=ORACLE≠SHEET', () => {
  assert.equal(agreementSignature(ohtaLegs), 'FS_TOTALS=FS_ENTRIES=ORACLE≠SHEET');
});

test('agreementSignature excludes non-PRESENT legs entirely', () => {
  const legs = {
    [LEG.SHEET]: { state: LEG_STATE.PRESENT, value: 100, meta: {} },
    [LEG.FS_TOTALS]: { state: LEG_STATE.NOT_CHECKED, value: null, meta: {} },
    [LEG.FS_ENTRIES]: { state: LEG_STATE.PRESENT, value: 100, meta: {} },
    [LEG.SITE]: { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} },
    [LEG.ORACLE]: { state: LEG_STATE.ABSENT, value: null, meta: {} },
  };
  assert.equal(agreementSignature(legs), 'SHEET=FS_ENTRIES');
});

test('agreementSignature ties break by canonical-order group formation', () => {
  // Two groups of equal size (2 and 2): {SHEET, ORACLE} vs {FS_TOTALS, FS_ENTRIES}.
  // SHEET forms its group first in canonical order (SHEET, FS_TOTALS, FS_ENTRIES, SITE, ORACLE).
  const legs = {
    [LEG.SHEET]: { state: LEG_STATE.PRESENT, value: 9840, meta: {} },
    [LEG.FS_TOTALS]: { state: LEG_STATE.PRESENT, value: 9622, meta: {} },
    [LEG.FS_ENTRIES]: { state: LEG_STATE.PRESENT, value: 9622, meta: {} },
    [LEG.ORACLE]: { state: LEG_STATE.PRESENT, value: 9840, meta: {} },
  };
  assert.equal(agreementSignature(legs), 'SHEET=ORACLE≠FS_TOTALS=FS_ENTRIES');
});

test('agreementSignature returns empty string when nothing is PRESENT', () => {
  const legs = {
    [LEG.SHEET]: { state: LEG_STATE.NOT_CHECKED, value: null, meta: {} },
    [LEG.FS_TOTALS]: { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} },
    [LEG.FS_ENTRIES]: { state: LEG_STATE.ABSENT, value: null, meta: {} },
    [LEG.SITE]: { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} },
    [LEG.ORACLE]: { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} },
  };
  assert.equal(agreementSignature(legs), '');
});

// ---------------------------------------------------------------- currency.mjs

test('classifyEarningsLabel covers all 6 known labels', () => {
  assert.equal(classifyEarningsLabel('Billables Earnings'), 'TAKE_HOME');
  assert.equal(classifyEarningsLabel('Earnings'), 'TAKE_HOME');
  assert.equal(classifyEarningsLabel('Billable Earnings'), 'TAKE_HOME');
  assert.equal(classifyEarningsLabel('Client Invoice'), 'CLIENT_BILLED');
  assert.equal(classifyEarningsLabel('Billable to Client'), 'CLIENT_BILLED');
  assert.equal(classifyEarningsLabel('Billables'), 'CLIENT_BILLED');
});

test('classifyEarningsLabel returns UNKNOWN for anything else — never guessed', () => {
  assert.equal(classifyEarningsLabel('Fee Income'), 'UNKNOWN');
  assert.equal(classifyEarningsLabel(''), 'UNKNOWN');
  assert.equal(classifyEarningsLabel(undefined), 'UNKNOWN');
});

test('EARNINGS_LABEL_SYSTEM matches the verified label map exactly', () => {
  assert.deepEqual(Object.keys(EARNINGS_LABEL_SYSTEM).sort(), [
    'Billable Earnings', 'Billable to Client', 'Billables',
    'Billables Earnings', 'Client Invoice', 'Earnings',
  ]);
});

test('takeHomeRatio: van Loon Feb/Mar case -> 0.65', () => {
  assert.equal(takeHomeRatio({ rate: 500, takeHomeRate: 325 }).ratio, 0.65);
  assert.equal(takeHomeRatio({ rate: 550, takeHomeRate: 357.5 }).ratio, 0.65);
});

test('takeHomeRatio: missing takeHomeRate -> ratio null, never guessed', () => {
  const result = takeHomeRatio({ rate: 500 });
  assert.equal(result.ratio, null);
  assert.ok(result.reason);
});

test('takeHomeRatio: missing/zero rate -> ratio null', () => {
  assert.equal(takeHomeRatio({ takeHomeRate: 325 }).ratio, null);
  assert.equal(takeHomeRatio({ rate: 0, takeHomeRate: 325 }).ratio, null);
  assert.equal(takeHomeRatio(null).ratio, null);
});

test('oracleEarnings: van Loon 2025-02 discount-rate case -> 20007, NOT the stored 20805', () => {
  const oracle = oracleEarnings({ sheetEarnings: 30780, labelSystem: 'CLIENT_BILLED', ratio: 0.65 });
  assert.equal(oracle, 20007);
  assert.notEqual(oracle, 20805); // the bug: Firestore stored 20805
});

test('oracleEarnings: Ohta 2025-09 cross-system case -> 30393', () => {
  assert.equal(oracleEarnings({ sheetEarnings: 50655, labelSystem: 'CLIENT_BILLED', ratio: 0.6 }), 30393);
});

test('oracleEarnings: TAKE_HOME label passes sheetEarnings through unchanged', () => {
  assert.equal(oracleEarnings({ sheetEarnings: 9840, labelSystem: 'TAKE_HOME', ratio: null }), 9840);
});

test('oracleEarnings: UNKNOWN label or null ratio -> null, never guessed', () => {
  assert.equal(oracleEarnings({ sheetEarnings: 1000, labelSystem: 'UNKNOWN', ratio: null }), null);
  assert.equal(oracleEarnings({ sheetEarnings: 1000, labelSystem: 'CLIENT_BILLED', ratio: null }), null);
});
