import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  round2,
  validateBillablesSheetTotals,
  validateOpsSheetTotals,
  buildUserMonthTotals,
  validateTotalHours,
} from '../src/utils/sheetTotalsValidation.mjs';

// ---------- round2 ----------

test('round2 rounds to 2 decimal places', () => {
  assert.equal(round2(1.005), 1.01);
  assert.equal(round2(10.333333), 10.33);
  assert.equal(round2(0.1 + 0.2), 0.3);
  assert.equal(round2(0), 0);
});

// ---------- validateBillablesSheetTotals ----------

test('billables: matching totals produce no warning', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 10.5, billableEarnings: 4200 },
    computedHours: 10.5,
    computedEarnings: 4200,
    month: 'January',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('billables: floating-point sums that round to the sheet total match', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 0.3, billableEarnings: 120 },
    computedHours: 0.1 + 0.2, // 0.30000000000000004
    computedEarnings: 120.0000001,
    month: 'January',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('billables: divergent hours produce an hours-mismatch warning with expected shape', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 12, billableEarnings: 4800 },
    computedHours: 10.25,
    computedEarnings: 4800,
    month: 'March',
    year: 2026,
  });
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], {
    type: 'hours-mismatch',
    collection: 'billables',
    month: 'March',
    year: 2026,
    message: 'Billable hours mismatch in March 2026: entries sum to 10.25h but sheet total is 12h',
  });
});

test('billables: divergent earnings produce an earnings-mismatch warning with expected shape', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 10, billableEarnings: 5000 },
    computedHours: 10,
    computedEarnings: 4750.5,
    month: 'February',
    year: 2026,
  });
  assert.equal(warnings.length, 1);
  const w = warnings[0];
  assert.equal(w.type, 'earnings-mismatch');
  assert.equal(w.collection, 'billables');
  assert.equal(w.month, 'February');
  assert.equal(w.year, 2026);
  assert.equal(
    w.message,
    `Billable earnings mismatch in February 2026: entries sum to $${(4750.5).toLocaleString()} but sheet total is $${(5000).toLocaleString()}`,
  );
});

test('billables: both hours and earnings divergent produce two warnings', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 12, billableEarnings: 5000 },
    computedHours: 10,
    computedEarnings: 4000,
    month: 'April',
    year: 2026,
  });
  assert.deepEqual(warnings.map(w => w.type), ['hours-mismatch', 'earnings-mismatch']);
});

test('billables: zero sheet totals mean ABSENT — divergent computed sums produce no warning', () => {
  // sheetTotals zero semantics: a 0 rollup means the totals row was not
  // synced, not that the true total is zero. No mismatch warning.
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { totalBillableHours: 0, billableEarnings: 0 },
    computedHours: 42,
    computedEarnings: 16800,
    month: 'May',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('billables: missing sheetTotals field on a rollup doc produces no warning', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: { billableEarnings: 5000 }, // totalBillableHours absent (undefined)
    computedHours: 42,
    computedEarnings: 5000,
    month: 'May',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('billables: null sheetTotals (doc without a totals block) produces no warning', () => {
  const warnings = validateBillablesSheetTotals({
    sheetTotals: null,
    computedHours: 42,
    computedEarnings: 16800,
    month: 'May',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

// ---------- validateOpsSheetTotals ----------

test('ops: matching totals produce no warning', () => {
  const warnings = validateOpsSheetTotals({
    sheetTotals: { opsHours: 8.75 },
    computedOpsHours: 8.75,
    month: 'January',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('ops: divergent hours produce an hours-mismatch warning with expected shape', () => {
  const warnings = validateOpsSheetTotals({
    sheetTotals: { opsHours: 9 },
    computedOpsHours: 8.5,
    month: 'June',
    year: 2026,
  });
  assert.equal(warnings.length, 1);
  assert.deepEqual(warnings[0], {
    type: 'hours-mismatch',
    collection: 'ops',
    month: 'June',
    year: 2026,
    message: 'Ops hours mismatch in June 2026: entries sum to 8.5h but sheet total is 9h',
  });
});

test('ops: zero opsHours sheet total means absent — no warning', () => {
  const warnings = validateOpsSheetTotals({
    sheetTotals: { opsHours: 0 },
    computedOpsHours: 12,
    month: 'June',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

test('ops: null sheetTotals produces no warning', () => {
  const warnings = validateOpsSheetTotals({
    sheetTotals: null,
    computedOpsHours: 12,
    month: 'June',
    year: 2026,
  });
  assert.deepEqual(warnings, []);
});

// ---------- buildUserMonthTotals ----------

test('buildUserMonthTotals aggregates computed sums and keys sheet totals by type', () => {
  const docRecords = [
    {
      userName: 'Jane Doe',
      type: 'billables',
      month: 'January',
      year: 2026,
      entries: [
        { hours: '2.5', earnings: '$1,000.00', reimbursements: '$25.50' },
        { hours: 3, earnings: 1200, reimbursements: 0 },
      ],
      sheetTotals: { totalBillableHours: 5.5, billableEarnings: 2200 },
    },
    {
      userName: 'Jane Doe',
      type: 'ops',
      month: 'January',
      year: 2026,
      entries: [{ hours: '1.5' }, { hours: 2 }],
      sheetTotals: { opsHours: 3.5, totalHours: 9 },
    },
    {
      userName: 'Jane Doe',
      type: 'eightThreeB',
      month: 'January',
      year: 2026,
      entries: [{ flatFee: '$350' }],
      sheetTotals: null,
    },
  ];

  const { userMonthSheetTotals, userMonthComputedTotals } = buildUserMonthTotals(docRecords);

  assert.deepEqual(userMonthComputedTotals, {
    'Jane Doe': {
      '2026_January': {
        billableHours: 5.5,
        billableEarnings: 2200,
        opsHours: 3.5,
        reimbursements: 25.5,
        eightThreeBFees: 350,
      },
    },
  });
  assert.deepEqual(userMonthSheetTotals, {
    'Jane Doe': {
      '2026_January': {
        billables: { totalBillableHours: 5.5, billableEarnings: 2200 },
        ops: { opsHours: 3.5, totalHours: 9 },
        // eightThreeB doc had null sheetTotals — no key
      },
    },
  });
});

test('buildUserMonthTotals treats unparseable hours as 0', () => {
  const { userMonthComputedTotals } = buildUserMonthTotals([
    {
      userName: 'Jane Doe',
      type: 'billables',
      month: 'February',
      year: 2026,
      entries: [{ hours: 'n/a', earnings: 'TBD', reimbursements: undefined }],
      sheetTotals: null,
    },
  ]);
  assert.deepEqual(userMonthComputedTotals['Jane Doe']['2026_February'], {
    billableHours: 0, billableEarnings: 0, opsHours: 0, reimbursements: 0, eightThreeBFees: 0,
  });
});

// ---------- validateTotalHours (cross-collection) ----------

const crossRecords = (opsSheetTotals, billableHours = 5, opsHours = 3) => [
  {
    userName: 'Jane Doe',
    type: 'billables',
    month: 'January',
    year: 2026,
    entries: [{ hours: billableHours, earnings: 0, reimbursements: 0 }],
    sheetTotals: null,
  },
  {
    userName: 'Jane Doe',
    type: 'ops',
    month: 'January',
    year: 2026,
    entries: [{ hours: opsHours }],
    sheetTotals: opsSheetTotals,
  },
];

test('validateTotalHours: matching combined total produces no warnings', () => {
  const { userMonthSheetTotals, userMonthComputedTotals } =
    buildUserMonthTotals(crossRecords({ opsHours: 3, totalHours: 8 }));
  const results = validateTotalHours(userMonthSheetTotals, userMonthComputedTotals);
  assert.deepEqual(results, []);
});

test('validateTotalHours: divergent combined total produces total-hours-mismatch', () => {
  const { userMonthSheetTotals, userMonthComputedTotals } =
    buildUserMonthTotals(crossRecords({ opsHours: 3, totalHours: 10 }));
  const results = validateTotalHours(userMonthSheetTotals, userMonthComputedTotals);
  assert.equal(results.length, 1);
  assert.equal(results[0].userName, 'Jane Doe');
  assert.deepEqual(results[0].warning, {
    type: 'total-hours-mismatch',
    month: 'January',
    year: 2026,
    message: 'Total hours mismatch in January 2026: entries sum to 8h but sheet total is 10h',
  });
});

test('validateTotalHours: zero totalHours sheet total means absent — no warning', () => {
  const { userMonthSheetTotals, userMonthComputedTotals } =
    buildUserMonthTotals(crossRecords({ opsHours: 3, totalHours: 0 }));
  const results = validateTotalHours(userMonthSheetTotals, userMonthComputedTotals);
  assert.deepEqual(results, []);
});

test('validateTotalHours: month with no ops sheetTotals doc is skipped', () => {
  const { userMonthSheetTotals, userMonthComputedTotals } =
    buildUserMonthTotals(crossRecords(null));
  const results = validateTotalHours(userMonthSheetTotals, userMonthComputedTotals);
  assert.deepEqual(results, []);
});
