import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildYearTargetEntries, buildTargetsPayload } from '../src/utils/targetsPayload.mjs';

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Grid cells hold raw <input type="number"> strings.
const fullMatrix = () => {
  const m = {};
  for (let i = 0; i < 12; i++) {
    m[i] = { client: String(100 + i), ops: String(10 + i) };
  }
  return m;
};

test('full grid round-trip: 12 entries, month/year stamped, hours parsed, totalHours derived, earnings zeroed', () => {
  const entries = buildYearTargetEntries(fullMatrix(), 2026);
  assert.equal(entries.length, 12);
  entries.forEach((e, i) => {
    assert.deepEqual(e, {
      month: MONTH_LONG[i],
      year: 2026,
      billableHours: 100 + i,
      opsHours: 10 + i,
      totalHours: 110 + 2 * i,
      earnings: 0,
    });
  });
});

test('decimal input strings parse as floats', () => {
  const entries = buildYearTargetEntries({ 0: { client: '7.5', ops: '2.25' } }, 2026);
  assert.equal(entries[0].billableHours, 7.5);
  assert.equal(entries[0].opsHours, 2.25);
  assert.equal(entries[0].totalHours, 9.75);
});

test('blank cells silently become 0-hour targets (current behavior)', () => {
  // CURRENT BEHAVIOR (silent-0): a blank grid cell is indistinguishable from
  // an explicit 0 — parseFloat('') || 0 === 0 — so saving with blanks writes
  // real { billableHours: 0, opsHours: 0, totalHours: 0 } entries for those
  // months rather than omitting them. There is no "unset" state in the payload.
  const entries = buildYearTargetEntries({ 3: { client: '', ops: '' } }, 2025);
  const apr = entries[3];
  assert.deepEqual(apr, {
    month: 'April', year: 2025,
    billableHours: 0, opsHours: 0, totalHours: 0, earnings: 0,
  });
  // Months with no cell object at all get the same 0-hour entry.
  assert.deepEqual(entries[7], {
    month: 'August', year: 2025,
    billableHours: 0, opsHours: 0, totalHours: 0, earnings: 0,
  });
});

test('partial row: filled side parses, blank side is 0, total reflects only the filled side', () => {
  const entries = buildYearTargetEntries({ 0: { client: '120', ops: '' }, 1: { client: '', ops: '15' } }, 2026);
  assert.equal(entries[0].billableHours, 120);
  assert.equal(entries[0].opsHours, 0);
  assert.equal(entries[0].totalHours, 120);
  assert.equal(entries[1].billableHours, 0);
  assert.equal(entries[1].opsHours, 15);
  assert.equal(entries[1].totalHours, 15);
});

test('non-numeric input coerces to 0; numeric-prefix strings keep their prefix (parseFloat semantics)', () => {
  const entries = buildYearTargetEntries(
    { 0: { client: 'abc', ops: 'NaN' }, 1: { client: '5x', ops: '  8  ' } },
    2026,
  );
  // Pure garbage -> 0 (parseFloat -> NaN -> || 0).
  assert.equal(entries[0].billableHours, 0);
  assert.equal(entries[0].opsHours, 0);
  // CURRENT BEHAVIOR: parseFloat takes the leading numeric prefix, so '5x'
  // saves as 5 rather than being rejected. Whitespace-padded numbers parse.
  assert.equal(entries[1].billableHours, 5);
  assert.equal(entries[1].opsHours, 8);
});

test('empty/missing matrix still emits all 12 months as 0-hour entries', () => {
  for (const matrix of [{}, undefined, null]) {
    const entries = buildYearTargetEntries(matrix, 2024);
    assert.equal(entries.length, 12);
    assert.ok(entries.every(e => e.billableHours === 0 && e.opsHours === 0 && e.totalHours === 0));
  }
});

test('payload replaces EVERY selected-year entry — months not represented in the grid are overwritten with 0-hour targets (data-loss pin)', () => {
  // CURRENT BEHAVIOR (the data-loss risk): the save always rewrites the full
  // 12-month slate for the selected year. If the grid matrix is missing a
  // month (e.g. state that never loaded a stored value, or a cell cleared to
  // blank), the previously stored non-zero target for that month is replaced
  // by a 0-hour entry — it is NOT preserved. Note the UI loads all 12 months
  // into state regardless of the quarter view filter, so quarter view alone
  // does not trigger this; a blank/missing cell does.
  const existing = [
    { month: 'June', year: 2026, billableHours: 140, opsHours: 20, totalHours: 160, earnings: 12000 },
    { month: 'July', year: 2026, billableHours: 130, opsHours: 10, totalHours: 140, earnings: 9500 },
  ];
  // Grid only has January filled; June/July are absent from the matrix.
  const payload = buildTargetsPayload(existing, { 0: { client: '100', ops: '20' } }, 2026);

  assert.equal(payload.length, 12); // old June/July entries dropped, full slate emitted
  const june = payload.find(e => e.month === 'June' && e.year === 2026);
  const july = payload.find(e => e.month === 'July' && e.year === 2026);
  assert.deepEqual(june, { month: 'June', year: 2026, billableHours: 0, opsHours: 0, totalHours: 0, earnings: 0 });
  assert.deepEqual(july, { month: 'July', year: 2026, billableHours: 0, opsHours: 0, totalHours: 0, earnings: 0 });
  // Stored earnings on the replaced entries are wiped to 0 as well.
  assert.ok(payload.every(e => e.earnings === 0));
  const jan = payload.find(e => e.month === 'January');
  assert.equal(jan.billableHours, 100);
});

test('entries for other years are preserved untouched, in original order, ahead of the rebuilt year', () => {
  const y2025a = { month: 'December', year: 2025, billableHours: 90, opsHours: 5, totalHours: 95, earnings: 8000 };
  const y2027 = { month: 'January', year: 2027, billableHours: 150, opsHours: 0, totalHours: 150, earnings: 0 };
  const y2025b = { month: 'March', year: 2025, billableHours: 80, opsHours: 8, totalHours: 88, earnings: 7000 };
  const stale2026 = { month: 'May', year: 2026, billableHours: 999, opsHours: 99, totalHours: 1098, earnings: 1 };
  const existing = [y2025a, y2027, y2025b, stale2026];

  const payload = buildTargetsPayload(existing, fullMatrix(), 2026);
  assert.equal(payload.length, 3 + 12);
  // Other-year entries come first, same objects, original relative order.
  assert.equal(payload[0], y2025a);
  assert.equal(payload[1], y2027);
  assert.equal(payload[2], y2025b);
  // The stale same-year entry is gone; rebuilt Jan–Dec follows.
  assert.ok(!payload.includes(stale2026));
  assert.deepEqual(payload.slice(3).map(e => e.month), MONTH_LONG);
  assert.ok(payload.slice(3).every(e => e.year === 2026));
});

test('year match is strict: a string-typed year never matches and survives as a duplicate (current behavior)', () => {
  // CURRENT BEHAVIOR: `t.year !== year` is strict, so an entry stored with
  // year "2026" (string) is treated as "another year" and kept alongside the
  // freshly built numeric-2026 entries — producing duplicate months.
  const stringYear = { month: 'January', year: '2026', billableHours: 50, opsHours: 5, totalHours: 55, earnings: 0 };
  const payload = buildTargetsPayload([stringYear], buildYearTargetEntriesMatrix(), 2026);
  assert.equal(payload.length, 13);
  assert.equal(payload[0], stringYear);
  const januaries = payload.filter(e => e.month === 'January');
  assert.equal(januaries.length, 2);
});

// Helper for the string-year test: a minimal matrix.
function buildYearTargetEntriesMatrix() {
  return { 0: { client: '100', ops: '10' } };
}

test('null/undefined existing targets are treated as empty', () => {
  for (const existing of [null, undefined, []]) {
    const payload = buildTargetsPayload(existing, {}, 2026);
    assert.equal(payload.length, 12);
  }
});
