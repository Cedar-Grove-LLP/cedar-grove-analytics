import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MONTHS,
  monthIndex,
  buildMonthKey,
  parseMonthKey,
  sortMonthKeysDesc,
  collectMonthKeys,
  sortBySheetRow,
  resolveTakeHomeRate,
  computeManualEarnings,
  buildManualOpsEntry,
  buildManualBillableEntry,
} from '../src/utils/manualEntry.mjs';

// Rates map shape mirrors FirestoreDataContext: { 'YYYY-MM': { rate, takeHomeRate } }.
const RATES = {
  '2025-01': { rate: 250, takeHomeRate: 125 },
  '2025-06': { rate: 300, takeHomeRate: 150 },
  '2026-02': { rate: 350, takeHomeRate: 175 },
};

// ---------------------------------------------------------------------------
// resolveTakeHomeRate
// ---------------------------------------------------------------------------

test('resolveTakeHomeRate: exact rate month resolves that month take-home', () => {
  assert.equal(resolveTakeHomeRate(RATES, '2025-06-15'), 150);
  assert.equal(resolveTakeHomeRate(RATES, '2026-02-01'), 175);
});

test('resolveTakeHomeRate: backward fallback uses the most recent prior month', () => {
  // No entry for 2025-09 — falls back to 2025-06, and reads THAT month's
  // takeHomeRate (not the requested month's).
  assert.equal(resolveTakeHomeRate(RATES, '2025-09-03'), 150);
  // After the last stored month, the latest entry carries forward.
  assert.equal(resolveTakeHomeRate(RATES, '2026-07-22'), 175);
});

test('resolveTakeHomeRate: pre-history date uses the retrospective earliest rate', () => {
  // Strictly before the whole history — findRateInfo's retrospective path.
  assert.equal(resolveTakeHomeRate(RATES, '2024-03-10'), 125);
});

test('resolveTakeHomeRate: missing rate pins current behavior — 0', () => {
  // No map / no date.
  assert.equal(resolveTakeHomeRate(null, '2025-06-15'), 0);
  assert.equal(resolveTakeHomeRate(RATES, ''), 0);
  // Empty history.
  assert.equal(resolveTakeHomeRate({}, '2025-06-15'), 0);
  // CURRENT BEHAVIOR: the resolved month has a client `rate` but no
  // takeHomeRate — resolution succeeds but the take-home read yields 0
  // (the entry bar blocks saves until one is set in User Management).
  assert.equal(resolveTakeHomeRate({ '2025-06': { rate: 300 } }, '2025-06-15'), 0);
  // CURRENT BEHAVIOR: resolution keys off `rate` (findRateInfo), so a month
  // holding ONLY a takeHomeRate (falsy rate) never resolves → 0.
  assert.equal(resolveTakeHomeRate({ '2025-06': { takeHomeRate: 150 } }, '2025-06-15'), 0);
});

// ---------------------------------------------------------------------------
// computeManualEarnings
// ---------------------------------------------------------------------------

test('computeManualEarnings: hours × take-home, rounded to cents', () => {
  assert.equal(computeManualEarnings(2, 150), 300);
  assert.equal(computeManualEarnings('2.5', 150), 375); // form hours arrive as strings
  assert.equal(computeManualEarnings(1.1, 333.33), 366.66); // 366.663 → cents
});

test('computeManualEarnings: non-positive or invalid hours contribute $0', () => {
  assert.equal(computeManualEarnings(0, 150), 0);
  assert.equal(computeManualEarnings(-2, 150), 0);
  assert.equal(computeManualEarnings('', 150), 0);
  assert.equal(computeManualEarnings('abc', 150), 0);
});

test('computeManualEarnings: adjustment folds into earnings (sheet semantics)', () => {
  assert.equal(computeManualEarnings(2, 150, 25.5), 325.5);
  assert.equal(computeManualEarnings(2, 150, -50), 250); // credits are negative
  // Pure adjustment (no hours) still bills the adjustment alone.
  assert.equal(computeManualEarnings(0, 150, 40), 40);
  // Omitted adjustment defaults to 0 — the manual-entry path.
  assert.equal(computeManualEarnings(2, 150), 300);
});

// ---------------------------------------------------------------------------
// Entry payload builders
// ---------------------------------------------------------------------------

test('buildManualOpsEntry: ops doc shape with noon-local date and month name', () => {
  const entry = buildManualOpsEntry({
    dateIso: '2026-07-09',
    description: '  Filing annual report  ',
    category: 'Admin',
    hours: '2.5',
  });
  assert.equal(entry.date.getTime(), new Date(2026, 6, 9, 12, 0, 0).getTime());
  assert.deepEqual({ ...entry, date: undefined }, {
    date: undefined,
    description: 'Filing annual report',
    category: 'Admin',
    hours: 2.5,
    month: 'July',
    year: 2026,
  });
});

test('buildManualBillableEntry: billable doc shape freezes earnings, zeroes adjustment/reimbursements', () => {
  const entry = buildManualBillableEntry({
    dateIso: '2026-01-31',
    client: 'Acme Corp',
    matter: ' Series A ',
    hours: 3,
    earnings: 525,
    billingCategory: 'Corporate',
    notes: ' sent drafts ',
  });
  assert.equal(entry.date.getTime(), new Date(2026, 0, 31, 12, 0, 0).getTime());
  assert.deepEqual({ ...entry, date: undefined }, {
    date: undefined,
    client: 'Acme Corp',
    matter: 'Series A',
    hours: 3,
    earnings: 525,
    billingCategory: 'Corporate',
    notes: 'sent drafts',
    adjustment: 0,
    reimbursements: 0,
    month: 'January',
    year: 2026,
  });
});

// ---------------------------------------------------------------------------
// Month keys + sheet-row sorting
// ---------------------------------------------------------------------------

test('month keys: build/parse round-trip and malformed keys', () => {
  assert.equal(buildMonthKey(2026, 'July'), '2026_July');
  assert.deepEqual(parseMonthKey('2026_July'), { year: 2026, month: 'July' });
  assert.deepEqual(parseMonthKey('garbage'), { year: 0, month: '' });
  assert.equal(monthIndex('January'), 0);
  assert.equal(MONTHS.length, 12);
});

test('sortMonthKeysDesc: newest year first, then calendar month within a year', () => {
  assert.deepEqual(
    sortMonthKeysDesc(['2025_March', '2026_January', '2025_December', '2026_July']),
    ['2026_July', '2026_January', '2025_December', '2025_March'],
  );
});

test('collectMonthKeys: merges sheetTotals keys with entry months, deduped and sorted desc', () => {
  const keys = collectMonthKeys(
    [{ year: 2026, month: 'February' }],
    [{ year: 2025, month: 'November' }, { month: 'June' }], // no year → skipped
    [{ year: 2026, month: 'February' }], // duplicate → deduped
    { '2026_March': {} },
  );
  assert.deepEqual(keys, ['2026_March', '2026_February', '2025_November']);
});

test('sortBySheetRow: rows without sheetRowNumber (manual entries) sort last', () => {
  const rows = [{ sheetRowNumber: 9 }, { id: 'manual' }, { sheetRowNumber: 3 }];
  assert.deepEqual(sortBySheetRow(rows), [
    { sheetRowNumber: 3 },
    { sheetRowNumber: 9 },
    { id: 'manual' },
  ]);
});
