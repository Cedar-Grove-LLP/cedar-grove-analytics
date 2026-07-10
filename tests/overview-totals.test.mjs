// End-to-end totals over fixtures, composed from the same pure helpers the
// app uses (filterByCohort + findRate/findRateInfo) — no hooks executed.
// These are the regression assertions for the Jan 1 – Mar 12, 2025 bug:
// invisible PTE/mis-keyed data and 2026-only rates rendering as a silent $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findRate, findRateInfo, monthKeyFromDate } from '../src/utils/rateLookup.mjs';
import { filterByCohort } from '../src/utils/cohortFilter.mjs';
import { detectOrphans } from '../scripts/lib/audit-helpers.mjs';

// users/{id} with canonical full-name doc IDs
const users = [
  { id: 'Colin van Loon', name: 'Colin van Loon', role: 'Attorney', employmentType: 'FTE' },
  { id: 'Michael Ohta', name: 'Michael Ohta', role: 'Attorney', employmentType: 'FTE' },
  { id: 'Valery Uscanga', name: 'Valery Uscanga', role: 'Attorney', employmentType: 'PTE' },
];

const rates2025 = {
  'Colin van Loon': { '2025-01': { rate: 400 } },
  'Michael Ohta': { '2025-01': { rate: 300 } },
  'Valery Uscanga': { '2025-01': { rate: 250 } },
};
const rates2026Only = {
  'Colin van Loon': { '2026-01': { rate: 400 } },
  'Michael Ohta': { '2026-01': { rate: 300 } },
  'Valery Uscanga': { '2026-01': { rate: 250 } },
};

// Billable entries keyed by canonical user ID, Jan–Mar 2025
const entries = [
  { userId: 'Colin van Loon', date: '2025-01-15T12:00:00', billableHours: 10 },
  { userId: 'Michael Ohta', date: '2025-02-10T12:00:00', billableHours: 8 },
  { userId: 'Valery Uscanga', date: '2025-03-05T12:00:00', billableHours: 6 },
];

const aggregate = (entryList, ratesByUser) => {
  const byUser = {};
  users.forEach((u) => {
    byUser[u.name] = { ...u, billable: 0, grossBillables: 0 };
  });
  entryList.forEach((entry) => {
    const att = byUser[entry.userId];
    if (!att) return; // mirrors the app: entries under unknown IDs never aggregate
    att.billable += entry.billableHours;
    att.grossBillables +=
      findRate(ratesByUser[entry.userId] || {}, monthKeyFromDate(entry.date)) * entry.billableHours;
  });
  return Object.values(byUser);
};

test('canonical full-name IDs: Ohta and Uscanga entries are included', () => {
  const attorneyData = aggregate(entries, rates2025);
  const ohta = attorneyData.find((a) => a.name === 'Michael Ohta');
  const uscanga = attorneyData.find((a) => a.name === 'Valery Uscanga');
  assert.equal(ohta.billable, 8);
  assert.equal(uscanga.billable, 6);
});

test('FTE totals and All Lawyers totals differ when PTE entries exist', () => {
  const attorneyData = aggregate(entries, rates2025);
  const sum = (cohort) =>
    filterByCohort(attorneyData, cohort).reduce((acc, a) => acc + a.billable, 0);
  assert.equal(sum('fte-lawyers'), 18);
  assert.equal(sum('lawyers'), 24);
  assert.notEqual(sum('fte-lawyers'), sum('lawyers'));
  assert.equal(sum('lawyers'), sum('fte-lawyers') + sum('pte-lawyers'));
});

test('Total Billables > 0 when rates exist for the entry months', () => {
  const attorneyData = aggregate(entries, rates2025);
  const total = attorneyData.reduce((acc, a) => acc + a.grossBillables, 0);
  assert.equal(total, 10 * 400 + 8 * 300 + 6 * 250);
  assert.ok(total > 0);
});

test('2026-only rates: 2025 entries bill retrospectively at the earliest rate, no warning', () => {
  // Previously these months billed at a flagged $0; the retrospective
  // fallback now applies each attorney's earliest stored rate backward.
  const attorneyData = aggregate(entries, rates2026Only);
  const total = attorneyData.reduce((acc, a) => acc + a.grossBillables, 0);
  assert.equal(total, 10 * 400 + 8 * 300 + 6 * 250);

  const infos = entries.map((entry) =>
    findRateInfo(rates2026Only[entry.userId], monthKeyFromDate(entry.date))
  );
  assert.ok(infos.every((i) => i.found === true && i.retrospective === true));
  assert.deepEqual(
    infos.map((i) => i.requestedMonthKey),
    ['2025-01', '2025-02', '2025-03']
  );
});

test('attorneys with no usable rates at all still warn (found:false, $0)', () => {
  const noRates = { 'Colin van Loon': {}, 'Michael Ohta': {}, 'Valery Uscanga': {} };
  const attorneyData = aggregate(entries, noRates);
  assert.equal(attorneyData.reduce((acc, a) => acc + a.grossBillables, 0), 0);
  const infos = entries.map((entry) =>
    findRateInfo(noRates[entry.userId], monthKeyFromDate(entry.date))
  );
  assert.ok(infos.every((i) => i.found === false));
});

test('entries under orphan/mis-keyed IDs do not aggregate and are classified ORPHANED', () => {
  const orphanEntries = [
    ...entries,
    { userId: 'Ohta', date: '2025-01-20T12:00:00', billableHours: 99 },
  ];
  const attorneyData = aggregate(orphanEntries, rates2025);
  // The 99 hours vanish from the dashboard aggregation...
  assert.equal(attorneyData.reduce((acc, a) => acc + a.billable, 0), 24);
  // ...and the audit classifies the parent ID as orphaned.
  const orphans = detectOrphans(
    { billables: new Map([['Ohta', 1], ['Michael Ohta', 1]]) },
    new Set(users.map((u) => u.id))
  );
  assert.deepEqual(orphans.map((o) => o.parentId), ['Ohta']);
});
