import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRatesMapFromUserDoc,
  rateBounds,
  summarizeMonthDoc,
  windowStats,
  detectOrphans,
  suggestOrphanMatches,
  classifyUser,
} from '../scripts/lib/audit-helpers.mjs';

const users = [
  { id: 'Michael Ohta', name: 'Michael Ohta', email: 'michael@cedargrovellp.com' },
  { id: 'Valery Uscanga', name: 'Valery Uscanga', email: 'valery@cedargrovellp.com' },
  { id: 'Sam McClure', name: 'Sam McClure', email: 'sam@cedargrovellp.com' },
];

test('buildRatesMapFromUserDoc converts month names to YYYY-MM keys', () => {
  const map = buildRatesMapFromUserDoc({
    rates: [
      { month: 'January', year: 2026, rate: 300 },
      { month: 'April', year: 2026, rate: 350 },
    ],
  });
  assert.deepEqual(Object.keys(map).sort(), ['2026-01', '2026-04']);
  assert.equal(map['2026-01'].rate, 300);
  assert.deepEqual(rateBounds(map), { count: 2, earliest: '2026-01', latest: '2026-04' });
  assert.deepEqual(buildRatesMapFromUserDoc({}), {});
});

test('buildRatesMapFromUserDoc warns (but still mirrors app behavior) on an unrecognized month name', () => {
  // getMonthNumber's fallback-to-January for a non-matching name mirrors an
  // existing app quirk (dateHelpers.js) — this function must reproduce that
  // exact computed value, but must not absorb it silently: the whole point
  // of this audit tool is to surface bad source data.
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    const map = buildRatesMapFromUserDoc({
      rates: [{ month: 'Marchh', year: 2025, rate: 300 }],
    });
    assert.deepEqual(Object.keys(map), ['2025-01']); // mirrors app's silent-January fallback
    assert.equal(map['2025-01'].rate, 300);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /unrecognized month.*Marchh/);
  } finally {
    console.warn = originalWarn;
  }
});

test('buildRatesMapFromUserDoc does not warn for recognized month names', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (msg) => warnings.push(msg);
  try {
    buildRatesMapFromUserDoc({ rates: [{ month: 'january', year: 2025, rate: 100 }] }); // case-insensitive match
    assert.equal(warnings.length, 0);
  } finally {
    console.warn = originalWarn;
  }
});

test('summarizeMonthDoc flags entry-sum vs sheetTotals mismatches', () => {
  const summary = summarizeMonthDoc('billables', '2025_January', {
    month: 'January',
    year: 2025,
    entries: [
      { date: '2025-01-10T12:00:00', hours: '2.5', earnings: '500' },
      { date: '2025-01-11T12:00:00', hours: 3, earnings: 600 },
    ],
    sheetTotals: { totalBillableHours: 6, billableEarnings: 1100 },
  });
  assert.equal(summary.entryCount, 2);
  assert.equal(summary.hours, 5.5);
  assert.equal(summary.earnings, 1100);
  assert.deepEqual(summary.mismatches, ['hours 5.5 != sheet 6']);
});

test('detectOrphans flags parent IDs absent from users', () => {
  const orphans = detectOrphans(
    {
      billables: new Map([['Michael Ohta', 3], ['Ohta', 2]]),
      ops: new Map([['Ohta', 2], ['valery@cedargrovellp.com', 1]]),
    },
    new Set(users.map((u) => u.id))
  );
  assert.deepEqual(orphans, [
    { parentId: 'Ohta', collections: ['billables', 'ops'], docCount: 4 },
    { parentId: 'valery@cedargrovellp.com', collections: ['ops'], docCount: 1 },
  ]);
});

test('suggestOrphanMatches maps aliases to canonical IDs conservatively', () => {
  const matches = suggestOrphanMatches(
    ['michael ohta ', 'Ohta', 'valery@cedargrovellp.com', 'Totally Unknown'],
    users
  );
  assert.deepEqual(matches[0], {
    orphanId: 'michael ohta ', suggestedTargetId: 'Michael Ohta', confidence: 'exact-normalized',
  });
  assert.deepEqual(matches[1], {
    orphanId: 'Ohta', suggestedTargetId: 'Michael Ohta', confidence: 'token',
  });
  assert.deepEqual(matches[2], {
    orphanId: 'valery@cedargrovellp.com', suggestedTargetId: 'Valery Uscanga', confidence: 'exact-normalized',
  });
  assert.deepEqual(matches[3], {
    orphanId: 'Totally Unknown', suggestedTargetId: null, confidence: 'none',
  });
});

test('windowStats uses app rate fallback and reports missing-rate months', () => {
  const billableDocs = [{
    docId: '2025_January',
    data: {
      month: 'January', year: 2025,
      entries: [
        { date: '2025-01-10T12:00:00', hours: 4 },
        { date: '2025-02-20T12:00:00', hours: 2 },   // outside Jan doc but inside window
        { date: '2024-12-01T12:00:00', hours: 9 },   // outside window — ignored
      ],
    },
  }];
  const opsDocs = [{
    docId: '2025_January',
    data: { month: 'January', year: 2025, entries: [{ date: '2025-01-12T12:00:00', hours: 1.5 }] },
  }];

  // Rates exist for 2025 → gross computed at backward-fallback rates.
  const withRates = windowStats(
    { billableDocs, opsDocs },
    { '2024-06': { rate: 200 } },
    new Date(2025, 0, 1),
    new Date(2025, 2, 12, 23, 59, 59)
  );
  assert.equal(withRates.billableHours, 6);
  assert.equal(withRates.opsHours, 1.5);
  assert.equal(withRates.gross, 1200);
  assert.deepEqual(withRates.missingRateMonthKeys, []);

  // Only-2026 rates → hours counted, gross $0, months reported missing.
  const withoutRates = windowStats(
    { billableDocs, opsDocs },
    { '2026-01': { rate: 300 } },
    new Date(2025, 0, 1),
    new Date(2025, 2, 12, 23, 59, 59)
  );
  assert.equal(withoutRates.billableHours, 6);
  assert.equal(withoutRates.gross, 0);
  assert.deepEqual(withoutRates.missingRateMonthKeys, ['2025-01', '2025-02']);
});

test('classifyUser supports multiple simultaneous flags', () => {
  assert.deepEqual(
    classifyUser({ windowStats: { billableHours: 5, opsHours: 0, missingRateMonthKeys: [] } }).flags,
    ['OK']
  );
  assert.deepEqual(
    classifyUser({ windowStats: { billableHours: 0, opsHours: 0, missingRateMonthKeys: [] } }).flags,
    ['MISSING']
  );
  assert.deepEqual(
    classifyUser({
      windowStats: { billableHours: 0, opsHours: 0, missingRateMonthKeys: ['2025-01'] },
      orphanMatchesForUser: [{ orphanId: 'Ohta' }],
    }).flags,
    ['MISSING', 'ORPHANED', 'MISSING_RATE']
  );
});
