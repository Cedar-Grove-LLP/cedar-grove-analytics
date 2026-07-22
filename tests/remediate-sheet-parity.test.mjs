import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPhantomTemplateEntries } from '../src/utils/verify/phantoms.mjs';
import {
  CLASSIFICATION,
  classifyField,
  computeDrift,
  convertOrSuppressClientBilledStaleness,
  demoteEmptyMirrorCreation,
  expandUpdatePayload,
  isPhantomDeleteEligible,
  prepareEarningsLegs,
  rollupDocClassification,
} from '../src/utils/verify/remediationClassifier.mjs';
import {
  parseArgs,
  serializeChanges,
  serializeDocsForApply,
  storedTotal,
} from '../scripts/remediate-sheet-parity.mjs';

test('1. rollup-zero with corroborated sheet rows and entries is FIXABLE_ROLLUP', () => {
  const result = classifyField({
    field: 'opsHours', sheetSummary: 12, sheetRows: 12, fsTotals: 0, fsEntries: 12,
  });
  assert.equal(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
  assert.equal(result.proposedValue, 12);
});

test('2. sheet rows moved after freeze is STALE_ENTRIES', () => {
  const result = classifyField({
    field: 'hours', sheetSummary: 25, sheetRows: 25, fsTotals: 20, fsEntries: 20,
  });
  assert.equal(result.classification, CLASSIFICATION.STALE_ENTRIES);
  assert.equal(result.proposedValue, 25);
});

test('3. three-way disagreement is STALE_ENTRIES and never FIXABLE_ROLLUP', () => {
  const result = classifyField({
    field: 'hours', sheetRows: 30, fsEntries: 20, fsTotals: 10,
  });
  assert.equal(result.classification, CLASSIFICATION.STALE_ENTRIES);
  assert.notEqual(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
});

test('4. modelled window is MISSING_IN_SHEET before agreement checks', () => {
  const result = classifyField({
    field: 'hours', sheetSummary: 10, sheetRows: 10, fsTotals: 10, fsEntries: 10,
    modelledHit: { id: 'fixture-model', kind: 'MATRIX_ESTIMATE', reason: 'fixture' },
  });
  assert.equal(result.classification, CLASSIFICATION.MISSING_IN_SHEET);
  assert.equal(result.proposedValue, null);
});

test('5. blank totalHours summary forbids a change despite Firestore disagreement', () => {
  const result = classifyField({
    field: 'totalHours', sheetSummary: undefined, sheetRows: 40, fsTotals: 0, fsEntries: 40,
  });
  assert.equal(result.proposedValue, null);
  assert.notEqual(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
  assert.notEqual(result.classification, CLASSIFICATION.STALE_ENTRIES);
});

test('6. strict 1..N eightThreeB entries roll up to PHANTOM_83B', () => {
  const phantom = detectPhantomTemplateEntries([
    { flatFee: 1 }, { flatFee: '2' }, { flatFee: 3 },
  ]);
  assert.equal(phantom.isPhantom, true);
  assert.equal(rollupDocClassification([phantom]), CLASSIFICATION.PHANTOM_83B);
});

test('7. all four legs agree is ALREADY_CLEAN', () => {
  const result = classifyField({
    field: 'earnings', sheetSummary: 100, sheetRows: 100, fsTotals: 100, fsEntries: 100,
  });
  assert.equal(result.classification, CLASSIFICATION.ALREADY_CLEAN);
  assert.equal(result.proposedValue, null);
});

test('8. CLIENT_BILLED earnings compares only oracle-converted sheet dollars', () => {
  const prepared = prepareEarningsLegs({
    sheetSummary: 1000,
    sheetRows: 1000,
    earningsLabel: 'Client Invoice',
    ratesMap: { '2025-01': { rate: 500, takeHomeRate: 300 } },
    monthKey: '2025-01',
  });
  assert.equal(prepared.sheetSummary, 600);
  assert.equal(prepared.sheetRows, 600);
  assert.notEqual(prepared.sheetRows, 1000);

  const result = classifyField({
    field: 'earnings', fsTotals: 0, fsEntries: 600, ...prepared,
  });
  assert.equal(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
  assert.equal(result.proposedValue, 600);
});

test('9. CLIENT_BILLED earnings without a ratio is BLIND_SPOT and never guessed', () => {
  const prepared = prepareEarningsLegs({
    sheetSummary: 1000,
    sheetRows: 1000,
    earningsLabel: 'Client Invoice',
    ratesMap: { '2025-01': { rate: 500 } },
    monthKey: '2025-01',
  });
  const result = classifyField({
    field: 'earnings', fsTotals: 600, fsEntries: 600, ...prepared,
  });
  assert.equal(result.classification, CLASSIFICATION.BLIND_SPOT);
  assert.equal(result.proposedValue, null);
});

test('8b. summary cell converts from its OWN label, not the row column\'s — regression for the Colin van Loon 2025 double-conversion bug', () => {
  // Row column is "Client Invoice" (CLIENT_BILLED); summary cell is
  // "Billable Earnings" (always TAKE_HOME per currency.mjs) and is already
  // in take-home dollars. Applying the row's client->take-home ratio to the
  // summary a second time previously manufactured a false conflict.
  const prepared = prepareEarningsLegs({
    sheetSummary: 30852.25, // already take-home, verbatim from the sheet's "Billable Earnings" cell
    sheetRows: 47465, // client-billed, verbatim from the "Client Invoice" column sum
    earningsLabel: 'Client Invoice',
    summaryLabel: 'Billable Earnings',
    ratesMap: { '2025-04': { rate: 550, takeHomeRate: 357.5 } }, // ratio 0.65
    monthKey: '2025-04',
  });
  assert.equal(prepared.sheetRows, 30852.25, 'client-billed rows convert through the ratio');
  assert.equal(prepared.sheetSummary, 30852.25, 'take-home summary passes through unconverted');
  assert.equal(prepared.isEarningsUnresolvable, false);

  const result = classifyField({
    field: 'earnings', fsTotals: 30852.25, fsEntries: 30852.25, ...prepared,
  });
  assert.equal(result.classification, CLASSIFICATION.ALREADY_CLEAN);
  assert.notEqual(result.classification, CLASSIFICATION.BLIND_SPOT);
});

test('10a. doc precedence chooses PHANTOM_83B over every field signal', () => {
  const phantom = detectPhantomTemplateEntries([{ flatFee: 1 }, { flatFee: 2 }]);
  const result = rollupDocClassification([
    { classification: CLASSIFICATION.STALE_ENTRIES },
    { classification: CLASSIFICATION.FIXABLE_ROLLUP },
    phantom,
  ]);
  assert.equal(result, CLASSIFICATION.PHANTOM_83B);
});

test('10b. doc precedence chooses STALE_ENTRIES over ALREADY_CLEAN', () => {
  const result = rollupDocClassification([
    { classification: CLASSIFICATION.ALREADY_CLEAN },
    { classification: CLASSIFICATION.STALE_ENTRIES },
  ]);
  assert.equal(result, CLASSIFICATION.STALE_ENTRIES);
});

test('safety invariant: Firestore disagreement without a sheet leg is never FIXABLE_ROLLUP', () => {
  const result = classifyField({
    field: 'opsHours', sheetReadable: false, fsTotals: 0, fsEntries: 12,
  });
  assert.equal(result.classification, CLASSIFICATION.BLIND_SPOT);
  assert.notEqual(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
});

test('present summary can corroborate entries when row sum is unavailable', () => {
  const result = classifyField({
    field: 'hours', sheetSummary: 12, sheetRows: undefined, fsTotals: 0, fsEntries: 12,
  });
  assert.equal(result.classification, CLASSIFICATION.FIXABLE_ROLLUP);
  assert.equal(result.proposedValue, 12);
});

test('summary conflict with agreed rows and entries is conservative BLIND_SPOT', () => {
  const result = classifyField({
    field: 'hours', sheetSummary: 11, sheetRows: 12, fsTotals: 0, fsEntries: 12,
  });
  assert.equal(result.classification, CLASSIFICATION.BLIND_SPOT);
  assert.equal(result.proposedValue, null);
});

test('flatFee stored total equal to entries is clean; a real non-null mismatch is fixable', () => {
  assert.equal(storedTotal({ totalFlatFees: 300 }, 'totalFlatFees'), 300);
  assert.equal(storedTotal({
    totalFlatFees: 250,
    sheetTotals: { totalFlatFees: 300, eightThreeBFeeEarnings: 195 },
  }, 'totalFlatFees'), 300, 'the normalized nested key wins when both shapes are present');

  const clean = classifyField({
    field: 'flatFee', sheetRows: 300, fsTotals: 300, fsEntries: 300,
  });
  assert.equal(clean.classification, CLASSIFICATION.ALREADY_CLEAN);

  const fixable = classifyField({
    field: 'flatFee', sheetRows: 300, fsTotals: 250, fsEntries: 300,
  });
  assert.equal(fixable.classification, CLASSIFICATION.FIXABLE_ROLLUP);
  assert.equal(fixable.proposedValue, 300);
  const [field] = serializeChanges(new Map([['flat-fee-doc', {
    results: [fixable],
    changes: [{
      docPath: 'users/Test/eightThreeB/2025_January',
      field: 'flatFee',
      currentValue: 250,
      classification: fixable.classification,
      proposedValue: fixable.proposedValue,
    }],
  }]]));
  assert.equal(field.currentValue, 250, 'the proposal carries the real stored total, not null');
  assert.equal(field.bucket, CLASSIFICATION.FIXABLE_ROLLUP);
});

test('agreeing CLIENT_BILLED summary relabels every stale write and records conversion provenance', () => {
  const rateInfo = {
    rate: 500,
    takeHomeRate: 300,
    found: true,
    sourceMonthKey: '2025-02',
    requestedMonthKey: '2025-02',
  };
  const unchanged = { field: 'earnings', classification: CLASSIFICATION.FIXABLE_ROLLUP };
  const relabelled = convertOrSuppressClientBilledStaleness({
    results: [
      { field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 8 },
      unchanged,
    ],
    changes: [
      { field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 8 },
      unchanged,
    ],
    summaryCellValue: 600,
    convertedEntriesSum: 600.01,
    ratio: 0.6,
    rateInfo,
    eps: 0.02,
  });

  assert.equal(relabelled.results[0].classification, CLASSIFICATION.STALE_ENTRIES_CONVERTED);
  assert.equal(relabelled.changes[0].classification, CLASSIFICATION.STALE_ENTRIES_CONVERTED);
  assert.equal(relabelled.changes[0].summaryCellValue, 600);
  assert.equal(relabelled.changes[0].ratio, 0.6);
  assert.deepEqual(relabelled.changes[0].rateProvenance, rateInfo);
  assert.equal(relabelled.results[1], unchanged, 'unrelated field results remain untouched');
});

test('missing or disagreeing CLIENT_BILLED summary becomes BLIND_SPOT and removes stale writes', () => {
  for (const summaryCellValue of [undefined, 599]) {
    const relabelled = convertOrSuppressClientBilledStaleness({
      results: [{ field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 8 }],
      changes: [{ field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 8 }],
      summaryCellValue,
      convertedEntriesSum: 600,
      ratio: 0.6,
      rateInfo: { rate: 500, takeHomeRate: 300 },
    });
    assert.equal(relabelled.results[0].classification, CLASSIFICATION.BLIND_SPOT);
    assert.equal(relabelled.results[0].proposedValue, null);
    assert.equal(
      relabelled.results[0].reason,
      'CLIENT_BILLED conversion requires an agreeing Billable Earnings summary cell'
    );
    assert.deepEqual(relabelled.changes, []);
  }
});

test('prepareEarningsLegs exposes full rate provenance for CLIENT_BILLED conversion', () => {
  const prepared = prepareEarningsLegs({
    sheetSummary: 600,
    sheetRows: 1000,
    earningsLabel: 'Client Invoice',
    summaryLabel: 'Billable Earnings',
    ratesMap: { '2025-02': { rate: 500, takeHomeRate: 300 } },
    monthKey: '2025-02',
  });
  assert.deepEqual(prepared.rateInfo, {
    rate: 500,
    found: true,
    sourceMonthKey: '2025-02',
    requestedMonthKey: '2025-02',
    takeHomeRate: 300,
  });
});

test('phantom signature is delete-eligible only when the live sheet is empty', () => {
  assert.equal(isPhantomDeleteEligible({ isPhantom: true, liveSheetEntryCount: 0 }), true);
  assert.equal(isPhantomDeleteEligible({ isPhantom: true, liveSheetEntryCount: 1 }), false);
  assert.equal(isPhantomDeleteEligible({ isPhantom: false, liveSheetEntryCount: 0 }), false);
});

test('update payloads flatten sheetTotals to dotted paths so sibling keys survive', () => {
  assert.deepEqual(
    expandUpdatePayload({ sheetTotals: { opsHours: 93.4, clientFilingFees: 0 } }),
    { 'sheetTotals.opsHours': 93.4, 'sheetTotals.clientFilingFees': 0 },
  );
  // entries / entryCount stay whole-value replacements.
  assert.deepEqual(
    expandUpdatePayload({ entries: [{ hours: 1 }], entryCount: 1, sheetTotals: { billableEarnings: 550 } }),
    { entries: [{ hours: 1 }], entryCount: 1, 'sheetTotals.billableEarnings': 550 },
  );
  assert.deepEqual(expandUpdatePayload({ entryCount: 0 }), { entryCount: 0 });
});

test('drift guard treats live Timestamp instances and their JSON round-trip as equal', () => {
  // Live snapshot shape: Firestore Timestamp instance (seconds/nanoseconds
  // getters + toMillis). Artifact shape: the JSON round-trip {_seconds,_nanoseconds}.
  const liveTs = { seconds: 1750000000, nanoseconds: 0, toMillis: () => 1750000000000 };
  const frozenTs = { _seconds: 1750000000, _nanoseconds: 0 };

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { entries: [{ hours: 2, date: liveTs }], syncedAt: liveTs },
    priorState: { exists: true, data: { entries: [{ hours: 2, date: frozenTs }], syncedAt: frozenTs } },
    op: 'update',
    payload: { entries: [{ hours: 3 }] },
  }), { drifted: false, reason: null }, 'timestamp encoding alone must not read as drift');

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { entries: [{ hours: 2, date: liveTs }], syncedAt: liveTs },
    priorState: { exists: true, data: { entries: [{ hours: 2, date: frozenTs }], syncedAt: frozenTs } },
    op: 'delete',
    payload: null,
  }), { drifted: false, reason: null }, 'whole-doc delete compare must also canonicalize');

  const laterTs = { _seconds: 1750009999, _nanoseconds: 0 };
  assert.equal(computeDrift({
    liveExists: true,
    liveData: { entries: [{ hours: 2, date: liveTs }] },
    priorState: { exists: true, data: { entries: [{ hours: 2, date: laterTs }] } },
    op: 'update',
    payload: { entries: [] },
  }).drifted, true, 'a genuinely different timestamp still drifts');
});

test('drift guard catches existence, entries, sheetTotals, and whole-delete changes', () => {
  assert.deepEqual(computeDrift({
    liveExists: false,
    liveData: null,
    priorState: { exists: true, data: { entries: [] } },
    op: 'update',
    payload: { entries: [] },
  }), { drifted: true, reason: 'doc existence changed since the dry run' });

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { entries: [{ hours: 2 }] },
    priorState: { exists: true, data: { entries: [{ hours: 1 }] } },
    op: 'update',
    payload: { entries: [{ hours: 3 }] },
  }), { drifted: true, reason: 'live entries no longer match the dry-run backup' });

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { sheetTotals: { billableEarnings: 90, preserved: 4 } },
    priorState: { exists: true, data: { sheetTotals: { billableEarnings: 100, preserved: 4 } } },
    op: 'update',
    payload: { sheetTotals: { billableEarnings: 120 } },
  }), { drifted: true, reason: 'live sheetTotals no longer match the dry-run backup' });

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { entries: [], unexpected: true },
    priorState: { exists: true, data: { entries: [] } },
    op: 'delete',
    payload: null,
  }), { drifted: true, reason: 'live doc state no longer matches the dry-run backup' });

  assert.deepEqual(computeDrift({
    liveExists: true,
    liveData: { entries: [{ hours: 1 }], sheetTotals: { totalBillableHours: 1, untouched: 9 } },
    priorState: { exists: true, data: { entries: [{ hours: 1 }], sheetTotals: { totalBillableHours: 1 } } },
    op: 'update',
    payload: { entries: [{ hours: 2 }], sheetTotals: { totalBillableHours: 2 } },
  }), { drifted: false, reason: null });
});

test('serialized apply doc freezes complete entries, totals, op, and prior state', () => {
  const priorData = {
    entries: [{ hours: 1, earnings: 100 }],
    sheetTotals: { totalBillableHours: 1, billableEarnings: 100 },
    preserved: 'yes',
  };
  const replacementEntries = [{ hours: 2, earnings: 200 }];
  const docs = new Map([['users/Test/billables/2025_February', {
    docPath: 'users/Test/billables/2025_February',
    domain: 'billables',
    monthKey: '2025-02',
    exists: true,
    data: priorData,
    replacementEntries,
    results: [
      { field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES },
      { field: 'earnings', classification: CLASSIFICATION.FIXABLE_ROLLUP },
    ],
    changes: [
      { field: 'hours', classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 2 },
      { field: 'earnings', classification: CLASSIFICATION.FIXABLE_ROLLUP, proposedValue: 200 },
    ],
  }]]);

  const [row] = serializeDocsForApply(docs);
  assert.equal(row.op, 'update');
  assert.equal(row.bucket, CLASSIFICATION.STALE_ENTRIES);
  assert.deepEqual(row.payload.entries, replacementEntries);
  assert.equal(row.payload.entryCount, 1);
  assert.deepEqual(row.payload.sheetTotals, { totalBillableHours: 2, billableEarnings: 200 });
  assert.deepEqual(row.priorState, { exists: true, data: priorData });
});

test('serialized phantom is a whole-doc delete and empty mirrors never enter docs[]', () => {
  const docs = new Map([
    ['phantom', {
      docPath: 'users/Test/eightThreeB/2025_February', domain: 'eightThreeB', monthKey: '2025-02',
      exists: true, data: { entries: [{ flatFee: 1 }, { flatFee: 2 }], totalFlatFees: 300 },
      replacementEntries: [], results: [{ isPhantom: true }],
      changes: [{ field: 'entries', classification: CLASSIFICATION.PHANTOM_83B, proposedValue: [] }],
    }],
    ['empty', {
      docPath: 'users/Test/eightThreeB/2025_March', domain: 'eightThreeB', monthKey: '2025-03',
      exists: false, data: null, replacementEntries: [],
      results: [{ field: 'flatFee', classification: CLASSIFICATION.EMPTY_MIRROR_SKIPPED }],
      changes: [{ field: 'flatFee', classification: CLASSIFICATION.EMPTY_MIRROR_SKIPPED, proposedValue: 0 }],
    }],
  ]);
  const serialized = serializeDocsForApply(docs);
  assert.equal(serialized.length, 1);
  assert.equal(serialized[0].op, 'delete');
  assert.equal(serialized[0].payload, null);
});

test('empty mirror demotion is default-only and preserves the proposed value', () => {
  const stale = { classification: CLASSIFICATION.STALE_ENTRIES, proposedValue: 0, reason: 'empty mirror' };
  const demoted = demoteEmptyMirrorCreation(stale, {
    docExists: false, sheetEmpty: true, includeEmptyMirrors: false,
  });
  assert.equal(demoted.classification, CLASSIFICATION.EMPTY_MIRROR_SKIPPED);
  assert.equal(demoted.proposedValue, 0);
  assert.equal(demoteEmptyMirrorCreation(stale, {
    docExists: false, sheetEmpty: true, includeEmptyMirrors: true,
  }).classification, CLASSIFICATION.STALE_ENTRIES);
});

test('parseArgs enforces frozen apply flow and repeatable/comma-separated bucket exclusions', () => {
  assert.throws(
    () => parseArgs(['--apply', '--bogus']),
    /--apply no longer applies live/
  );
  assert.throws(() => parseArgs(['--apply-from', 'changes.json']), /requires the literal/);
  assert.throws(
    () => parseArgs(['--i-understand-this-writes-production-data']),
    /only valid together with --apply-from/
  );
  assert.throws(() => parseArgs(['--exclude-bucket', 'A']), /only valid together with --apply-from/);
  assert.throws(
    () => parseArgs([
      '--apply-from', 'changes.json',
      '--i-understand-this-writes-production-data',
      '--include-empty-mirrors',
    ]),
    /only valid in dry-run collection mode/
  );
  const args = parseArgs([
    '--apply-from', 'changes.json',
    '--i-understand-this-writes-production-data',
    '--exclude-bucket', 'STALE_ENTRIES_CONVERTED,BLIND_SPOT',
    '--exclude-bucket', 'PHANTOM_83B',
  ]);
  assert.deepEqual([...args.excludeBuckets], [
    'STALE_ENTRIES_CONVERTED', 'BLIND_SPOT', 'PHANTOM_83B',
  ]);
});
