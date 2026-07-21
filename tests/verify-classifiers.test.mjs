import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LEG, LEG_STATE, CLASS, SEVERITY, makeDivergence } from '../src/utils/verify/divergence.mjs';
import { oracleEarnings } from '../src/utils/verify/currency.mjs';
import { checkFormulaText, FORMULA_LANDMINES } from '../src/utils/verify/formulaLandmines.mjs';
import {
  CHAIN,
  classify,
  ruleInternalConsistency,
  ruleStaleness,
} from '../src/utils/verify/classifiers.mjs';
import { buildReport, exitCodeFor } from '../src/utils/verify/report.mjs';

// ---------------------------------------------------------------- fixture helpers

function present(value, meta = {}) {
  return { state: LEG_STATE.PRESENT, value, meta };
}
function absent(meta = {}) {
  return { state: LEG_STATE.ABSENT, value: null, meta };
}
function notChecked(meta = {}) {
  return { state: LEG_STATE.NOT_CHECKED, value: null, meta };
}
function round2(n) {
  return Math.round(n * 100) / 100;
}

/** A month-level van Loon earnings divergence — the record shape §5's ORACLE derivation reads. */
function vanLoonMonthDivergence({ monthKey, sheetTotal, fsTotal, ratio, hours, clientRate, takeHomeRate }) {
  const oracle = oracleEarnings({ sheetEarnings: sheetTotal, labelSystem: 'CLIENT_BILLED', ratio });
  return makeDivergence({
    id: `billables:colin-van-loon:${monthKey}:earnings`,
    domain: 'billables',
    subject: { attorney: 'Colin van Loon', userId: 'colin-van-loon', monthKey },
    metric: 'earnings',
    legs: {
      [LEG.SHEET]: present(sheetTotal, { columnLabel: 'Client Invoice', hours, rowsRead: 167 }),
      [LEG.FS_TOTALS]: present(fsTotal, { syncedAt: `${monthKey}-28` }),
      [LEG.FS_ENTRIES]: present(fsTotal, { entryCount: 167, hours }),
      [LEG.ORACLE]: present(oracle, { clientRate, takeHomeRate, ratio }),
    },
  });
}

// =====================================================================================
// 1. Ohta 2025-09 — cross-system false positive must NOT be flagged
// =====================================================================================

test('1. Ohta 2025-09 cross-system false positive is NOT flagged', () => {
  const ratio = 330 / 550; // 0.6
  const oracle = oracleEarnings({ sheetEarnings: 50655, labelSystem: 'CLIENT_BILLED', ratio });
  const d = makeDivergence({
    id: 'billables:michael-ohta:2025-09:earnings',
    domain: 'billables',
    subject: { attorney: 'Michael Ohta', userId: 'michael-ohta', monthKey: '2025-09' },
    metric: 'earnings',
    legs: {
      [LEG.SHEET]: present(50655, { columnLabel: 'Client Invoice', hours: 92.1, rowsRead: 41 }),
      [LEG.FS_TOTALS]: present(30393, { syncedAt: '2025-10-02' }),
      [LEG.FS_ENTRIES]: present(30393, { entryCount: 41, hours: 92.1 }),
      [LEG.ORACLE]: present(oracle, { clientRate: 550, takeHomeRate: 330, ratio }),
    },
  });

  classify(d);
  assert.equal(d.classification.class, CLASS.CROSS_SYSTEM_OK);
  assert.equal(d.classification.severity, SEVERITY.info);
  assert.equal(d.classification.ruleId, 'crossSystem');

  // A naive SHEET-vs-Firestore diff would flag $50,655 - $30,393 = $20,262 here alone, and
  // ~$424K all-time across every CLIENT_BILLED tab. classify() correctly suppresses it.
  assert.equal(round2(50655 - 30393), 20262);
});

// =====================================================================================
// 2 & 3. van Loon 2025-02 / 2025-03 — the discount-rate defect, verified to the penny
// =====================================================================================

test('2. van Loon 2025-02 discount-rate defect: expected 20007, delta 798, ORACLE-only catch', () => {
  const d = vanLoonMonthDivergence({
    monthKey: '2025-02',
    sheetTotal: 30780,
    fsTotal: 20805,
    ratio: 0.65,
    hours: 62.7,
    clientRate: 500,
    takeHomeRate: 325,
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.DEFECT);
  assert.equal(d.classification.evidence.defectId, 'discount-rate-conversion-skipped');
  assert.equal(d.classification.evidence.expected, 20007);
  assert.equal(d.classification.evidence.delta, 798);

  // Strip the record to what a naive 2-way diff sees: FS_TOTALS vs FS_ENTRIES only, no
  // SHEET, no ORACLE. Both read $20,805 — internally consistent — and classify() agrees
  // it's OK. This is the whole reason the bug hid for a year: any check that never derives
  // the ORACLE leg passes it.
  const stripped = makeDivergence({
    id: 'billables:colin-van-loon:2025-02:earnings:month-totals-only',
    domain: 'billables',
    subject: { attorney: 'Colin van Loon', userId: 'colin-van-loon', monthKey: '2025-02' },
    metric: 'earnings',
    legs: {
      [LEG.FS_TOTALS]: present(20805),
      [LEG.FS_ENTRIES]: present(20805),
    },
  });
  classify(stripped);
  assert.equal(stripped.legs[LEG.FS_TOTALS].value, 20805);
  assert.equal(stripped.legs[LEG.FS_ENTRIES].value, 20805);
  assert.equal(stripped.classification.class, CLASS.OK);
});

test('3. van Loon 2025-03 discount-rate defect: delta 784', () => {
  const d = vanLoonMonthDivergence({
    monthKey: '2025-03',
    sheetTotal: 54270,
    fsTotal: 36059.5,
    ratio: 0.65,
    hours: 100.2,
    clientRate: 550,
    takeHomeRate: 357.5,
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.DEFECT);
  assert.equal(d.classification.evidence.defectId, 'discount-rate-conversion-skipped');
  assert.equal(d.classification.evidence.expected, 35275.5);
  assert.equal(d.classification.evidence.delta, 784);
});

// =====================================================================================
// 4 & 5. Staleness — forward and reverse
// =====================================================================================

test('4. staleness forward — doc internally consistent, live sheet grew since sync', () => {
  const d = makeDivergence({
    id: 'billables:nora-levin:2026-03:hours',
    domain: 'billables',
    subject: { attorney: 'Nora Levin', userId: 'nora-levin', monthKey: '2026-03' },
    metric: 'hours',
    legs: {
      [LEG.SHEET]: present(133.0, { rowsRead: 15 }),
      [LEG.FS_TOTALS]: present(120.5, { syncedAt: '2026-03-15' }),
      [LEG.FS_ENTRIES]: present(120.5, { entryCount: 12 }),
    },
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.STALE_SYNC);
  assert.equal(d.classification.severity, SEVERITY.info);
  assert.equal(d.classification.evidence.direction, 'sheet-grew');
});

test('5. staleness reverse — Skrodzka 2026-05, live sheet rows deleted post-sync', () => {
  const d = makeDivergence({
    id: 'billables:martyna-skrodzka:2026-05:hours',
    domain: 'billables',
    subject: { attorney: 'Martyna Skrodzka', userId: 'martyna-skrodzka', monthKey: '2026-05' },
    metric: 'hours',
    legs: {
      [LEG.SHEET]: present(2.0, { rowsRead: 1 }),
      [LEG.FS_TOTALS]: present(8.3, { syncedAt: '2026-05-20' }),
      [LEG.FS_ENTRIES]: present(8.3, { entryCount: 5 }),
    },
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.STALE_SYNC);
  assert.equal(d.classification.evidence.direction, 'sheet-shrank');
  assert.equal(d.classification.evidence.fsEntryCount, 5);
  assert.equal(d.classification.evidence.sheetRowCount, 1);
});

// =====================================================================================
// 6. Misparse — internally inconsistent doc, chain order proof
// =====================================================================================

test('6. misparse (FS_TOTALS != FS_ENTRIES) is a defect, not staleness — chain order matters', () => {
  const legs = {
    [LEG.SHEET]: present(1860),
    [LEG.FS_TOTALS]: present(1860, { syncedAt: '2026-02-10' }),
    [LEG.FS_ENTRIES]: present(1240, { entryCount: 8 }),
  };
  const d = makeDivergence({
    id: 'billables:test-attorney:2026-02:hours',
    domain: 'billables',
    subject: { attorney: 'Test Attorney', userId: 'test-id', monthKey: '2026-02' },
    metric: 'hours',
    legs,
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.DEFECT);
  assert.equal(d.classification.evidence.defectId, 'misparse');
  assert.notEqual(d.classification.class, CLASS.STALE_SYNC);

  // In isolation, ruleStaleness's own precondition (SHEET present, differs from FS_ENTRIES)
  // would ALSO match this exact record (SHEET==FS_TOTALS!=FS_ENTRIES looks stale on its own) —
  // but ruleInternalConsistency precedes ruleStaleness in CHAIN and claims first. Assert the
  // order directly, not just the outcome.
  assert.ok(CHAIN.indexOf(ruleInternalConsistency) < CHAIN.indexOf(ruleStaleness));
  assert.equal(ruleInternalConsistency(d).class, CLASS.DEFECT);
});

// =====================================================================================
// 7. Filing-fees rollup zero — the >0-guard regression
// =====================================================================================

test('7. filing-fees rollup zero — FS_TOTALS wrote 0 while entries parsed correctly at 340/440', () => {
  const d = makeDivergence({
    id: 'billables:michael-levin:2026-06:clientFilingFees',
    domain: 'billables',
    subject: { attorney: 'Michael Levin', userId: 'michael-levin', monthKey: '2026-06' },
    metric: 'clientFilingFees',
    legs: {
      [LEG.SHEET]: present(440),
      [LEG.FS_TOTALS]: present(0, { syncedAt: '2026-06-30' }), // the rollup wrote 0
      [LEG.FS_ENTRIES]: present(440, { entryCount: 1 }), // per-row parse was correct
    },
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.DEFECT);
  assert.equal(d.classification.severity, SEVERITY.defect);
});

// =====================================================================================
// 8 & 9. Schema gap — pre- and post-cutover
// =====================================================================================

function schemaGapDivergence(syncedAt) {
  return makeDivergence({
    id: `billables:michael-levin:2026-01:clientFilingFees:${syncedAt}`,
    domain: 'billables',
    subject: { attorney: 'Michael Levin', userId: 'michael-levin', monthKey: '2026-01' },
    metric: 'clientFilingFees',
    legs: {
      [LEG.FS_TOTALS]: absent({ syncedAt }),
    },
  });
}

test('8. schema gap pre-cutover — key genuinely ABSENT, no false warning', () => {
  const d = schemaGapDivergence('2026-05-20');
  classify(d);
  assert.equal(d.classification.class, CLASS.SCHEMA_GAP);
  assert.equal(d.classification.severity, SEVERITY.info);
});

test('9. schema gap post-cutover — same ABSENT key is unexplained, falls through to UNKNOWN (loud)', () => {
  const d = schemaGapDivergence('2026-07-01');
  classify(d);
  assert.equal(d.classification.class, CLASS.UNKNOWN);
});

// =====================================================================================
// 10 & 11. Modelled data
// =====================================================================================

test('10. modelled 2024 lumped import — MODELLED, not BLIND_SPOT, not OK', () => {
  const d = makeDivergence({
    id: 'billables:sam-mcclure:2024-06:hours',
    domain: 'billables',
    subject: { attorney: 'Sam McClure', userId: 'sam-mcclure', monthKey: '2024-06' },
    metric: 'hours',
    legs: {
      [LEG.FS_TOTALS]: present(180),
      [LEG.FS_ENTRIES]: present(180, { entryCount: 1 }),
    },
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.MODELLED);
  assert.notEqual(d.classification.class, CLASS.BLIND_SPOT);
  assert.equal(d.classification.evidence.kind, 'LUMPED_IMPORT');
});

test('11. modelled McClure 2025-03 estimate-column — legs agree exactly, still MODELLED, not OK', () => {
  const d = makeDivergence({
    id: 'billables:sam-mcclure:2025-03:hours',
    domain: 'billables',
    subject: { attorney: 'Sam McClure', userId: 'sam-mcclure', monthKey: '2025-03' },
    metric: 'hours',
    legs: {
      [LEG.SHEET]: present(210, { columnLabel: 'Billables', hours: 210 }),
      [LEG.FS_TOTALS]: present(210),
      [LEG.FS_ENTRIES]: present(210, { entryCount: 1 }),
    },
  });
  classify(d);

  // A naive check sees SHEET === FS_TOTALS === FS_ENTRIES and would call this OK — passing
  // right by the fact the source hours are an ESTIMATE column, not logged time. This is
  // exactly the case the 27.2%/38.2% modelled-data KPI needs to count.
  assert.equal(d.classification.class, CLASS.MODELLED);
  assert.notEqual(d.classification.class, CLASS.OK);
  assert.equal(d.classification.evidence.kind, 'MATRIX_ESTIMATE');
});

// =====================================================================================
// 12 & 13. firmProfit — in band vs out of band
// =====================================================================================

test('12. firmProfit in band — known defect, baselined, exit 0', () => {
  const d = makeDivergence({
    id: 'monthlyMetrics:2026-06:firmProfit',
    domain: 'monthlyMetrics',
    subject: { monthKey: '2026-06' },
    metric: 'firmProfit',
    legs: {
      [LEG.SHEET]: present(150000),
      [LEG.FS_TOTALS]: present(186175.12), // +36175.12
    },
  });
  classify(d);

  assert.equal(d.classification.class, CLASS.DEFECT);
  assert.equal(d.classification.evidence.delta, 36175.12);
  assert.equal(d.classification.baselineId, 'firmprofit-overstated-pre-opex');
  assert.equal(d.classification.inBand, true);
  assert.equal(d.classification.isNew, false);

  assert.equal(exitCodeFor(buildReport([d])), 0);
});

test('13. firmProfit out of band — worse than the proven band, isNew, exit 1', () => {
  const d = makeDivergence({
    id: 'monthlyMetrics:2026-07:firmProfit',
    domain: 'monthlyMetrics',
    subject: { monthKey: '2026-07' },
    metric: 'firmProfit',
    legs: {
      [LEG.SHEET]: present(150000),
      [LEG.FS_TOTALS]: present(202000), // +52000, exceeds the 40000 monthly band
    },
  });
  classify(d);

  assert.equal(d.classification.evidence.delta, 52000);
  assert.equal(d.classification.baselineId, 'firmprofit-overstated-pre-opex'); // still matches the ledger entry...
  assert.equal(d.classification.inBand, false); // ...but is worse than its band
  assert.equal(d.classification.isNew, true);

  assert.equal(exitCodeFor(buildReport([d])), 1);
});

// =====================================================================================
// 14. 83(b) *0.65 typo — dormant to value comparison
// =====================================================================================

test('14. 83(b) *65 typo: formula inspection fails while the value leg for the same tab is OK', () => {
  const landmine = FORMULA_LANDMINES.find((l) => l.id === 'elections-83b-times-0.65');
  const formulaCheck = checkFormulaText('=SUM(Q:Q)*65', landmine);
  assert.equal(formulaCheck.pass, false);

  // No July elections exist yet, so the (buggy) formula evaluates to $0 — identical to what
  // the correct formula would produce. Every value leg agrees at 0 and classify() correctly
  // calls it OK; formula-text inspection is the ONLY path that catches the typo.
  const valueDivergence = makeDivergence({
    id: 'eightThreeB:van-loon-2026:July:flatFee',
    domain: 'eightThreeB',
    subject: { attorney: 'Colin van Loon', userId: 'colin-van-loon', monthKey: '2026-07' },
    metric: 'flatFee',
    legs: {
      [LEG.SHEET]: present(0),
      [LEG.FS_TOTALS]: present(0),
      [LEG.FS_ENTRIES]: present(0, { entryCount: 0 }),
    },
  });
  classify(valueDivergence);
  assert.equal(valueDivergence.classification.class, CLASS.OK);
});

// =====================================================================================
// 15. Mercury writeback
// =====================================================================================

test('15. Mercury writeback (status/dateReceived) — expected, not a defect', () => {
  const statusDivergence = makeDivergence({
    id: 'invoicesAll:row-42:status',
    domain: 'invoicesAll',
    subject: { client: 'Acme LLP', sheetRowNumber: 42 },
    metric: 'status',
    legs: {
      [LEG.SHEET]: present('Not Paid'),
      [LEG.FS_TOTALS]: present('Paid', { rowCount: 1 }),
    },
  });
  classify(statusDivergence);
  assert.equal(statusDivergence.classification.class, CLASS.EXPECTED_WRITEBACK);
  assert.equal(statusDivergence.classification.severity, SEVERITY.info);

  const dateDivergence = makeDivergence({
    id: 'invoicesAll:row-42:dateReceived',
    domain: 'invoicesAll',
    subject: { client: 'Acme LLP', sheetRowNumber: 42 },
    metric: 'dateReceived',
    legs: {
      [LEG.SHEET]: present(null),
      [LEG.FS_TOTALS]: present('2026-07-01'),
    },
  });
  classify(dateDivergence);
  assert.equal(dateDivergence.classification.class, CLASS.EXPECTED_WRITEBACK);
});

// =====================================================================================
// 16. Unknown earnings label
// =====================================================================================

test('16. unknown earnings label — classified UNKNOWN, never guessed', () => {
  const d = makeDivergence({
    id: 'billables:test-attorney:2026-01:earnings',
    domain: 'billables',
    subject: { attorney: 'Test Attorney', userId: 'test-id', monthKey: '2026-01' },
    metric: 'earnings',
    legs: {
      [LEG.SHEET]: present(1000, { columnLabel: 'Fee Income' }),
      [LEG.FS_TOTALS]: present(750, { syncedAt: '2026-01-31' }),
      [LEG.FS_ENTRIES]: present(750, { entryCount: 5 }),
    },
  });
  classify(d);
  assert.equal(d.classification.class, CLASS.UNKNOWN);
});

// =====================================================================================
// 17. Chain always terminates
// =====================================================================================

test('17. a divergence matching no rule still terminates at ruleUnknown; classify never throws', () => {
  const d = makeDivergence({
    id: 'billables:nobody:2099-01:mystery',
    domain: 'billables',
    subject: {},
    metric: 'mystery',
    legs: {},
  });
  assert.doesNotThrow(() => classify(d));
  assert.equal(d.classification.class, CLASS.UNKNOWN);
  assert.equal(d.classification.ruleId, 'unknown');
});

// =====================================================================================
// 18. exitCodeFor contract
// =====================================================================================

test('18. exitCodeFor contract', () => {
  const okDivergence = makeDivergence({
    id: 'x:ok',
    domain: 'billables',
    subject: {},
    metric: 'hours',
    legs: { [LEG.SHEET]: present(10), [LEG.FS_ENTRIES]: present(10) },
  });
  classify(okDivergence);

  const allowlistedBlindSpot = makeDivergence({
    id: 'x:blind-allowlisted',
    domain: 'billables',
    subject: { workbookKey: 'weekes-2025' },
    metric: 'hours',
    legs: { [LEG.SHEET]: notChecked({ reason: '403 PERMISSION_DENIED' }) },
  });
  classify(allowlistedBlindSpot);
  assert.equal(allowlistedBlindSpot.classification.evidence.allowlisted, true);

  const cleanReport = buildReport([okDivergence, allowlistedBlindSpot]);
  assert.equal(exitCodeFor(cleanReport), 0);
  assert.equal(exitCodeFor(cleanReport, { strict: true }), 1); // --strict fails on ANY blind spot

  const newBlindSpot = makeDivergence({
    id: 'x:blind-new',
    domain: 'billables',
    subject: { workbookKey: 'unshared-book-2099' },
    metric: 'hours',
    legs: { [LEG.SHEET]: notChecked({ reason: '403 PERMISSION_DENIED' }) },
  });
  classify(newBlindSpot);
  assert.equal(newBlindSpot.classification.evidence.allowlisted, false);
  assert.equal(exitCodeFor(buildReport([newBlindSpot])), 1);

  const unknownDivergence = makeDivergence({
    id: 'x:unknown',
    domain: 'billables',
    subject: {},
    metric: 'mystery',
    legs: {},
  });
  classify(unknownDivergence);
  assert.equal(exitCodeFor(buildReport([unknownDivergence])), 1);

  const vanLoonFeb = vanLoonMonthDivergence({
    monthKey: '2025-02',
    sheetTotal: 30780,
    fsTotal: 20805,
    ratio: 0.65,
    hours: 62.7,
    clientRate: 500,
    takeHomeRate: 325,
  });
  classify(vanLoonFeb);
  assert.equal(exitCodeFor(buildReport([vanLoonFeb])), 0); // known, in band

  const outOfBandFirmProfit = makeDivergence({
    id: 'x:firmprofit-oob',
    domain: 'monthlyMetrics',
    subject: { monthKey: '2026-08' },
    metric: 'firmProfit',
    legs: { [LEG.SHEET]: present(100000), [LEG.FS_TOTALS]: present(160000) },
  });
  classify(outOfBandFirmProfit);
  assert.equal(exitCodeFor(buildReport([outOfBandFirmProfit])), 1); // ledger hit but worse than band
});
