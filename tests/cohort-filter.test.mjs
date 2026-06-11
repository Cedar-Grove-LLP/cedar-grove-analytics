import { test } from 'node:test';
import assert from 'node:assert/strict';
import { filterByCohort, isLawyer, deriveTransactionTotals } from '../src/utils/cohortFilter.mjs';

const roster = [
  { name: 'Colin van Loon', role: 'Attorney', employmentType: 'FTE', transactions: { Litigation: 10, 'Real Estate': 5 } },
  { name: 'Michael Ohta', role: 'Attorney', employmentType: 'FTE', transactions: { Litigation: 7 } },
  { name: 'Valery Uscanga', role: 'Attorney', employmentType: 'PTE', transactions: { 'Real Estate': 4 } },
  { name: 'Paige Wilson', employmentType: 'PTE', transactions: { Corporate: 3 } }, // missing role → Attorney
  { name: 'Ops Person', role: 'Operations', employmentType: 'FTE', transactions: {} },
];

test('missing role defaults to Attorney', () => {
  assert.equal(isLawyer({ name: 'X' }), true);
  assert.equal(isLawyer({ name: 'X', role: 'Operations' }), false);
});

test('fte-lawyers cohort', () => {
  assert.deepEqual(
    filterByCohort(roster, 'fte-lawyers').map((m) => m.name),
    ['Colin van Loon', 'Michael Ohta']
  );
});

test('pte-lawyers cohort', () => {
  assert.deepEqual(
    filterByCohort(roster, 'pte-lawyers').map((m) => m.name),
    ['Valery Uscanga', 'Paige Wilson']
  );
});

test('lawyers cohort = FTE + PTE lawyers, excludes non-lawyer staff', () => {
  const lawyers = filterByCohort(roster, 'lawyers').map((m) => m.name);
  assert.deepEqual(lawyers, ['Colin van Loon', 'Michael Ohta', 'Valery Uscanga', 'Paige Wilson']);
  const fte = filterByCohort(roster, 'fte-lawyers');
  const pte = filterByCohort(roster, 'pte-lawyers');
  assert.equal(lawyers.length, fte.length + pte.length);
});

test('full-team (and unknown cohort) returns everyone', () => {
  assert.equal(filterByCohort(roster, 'full-team').length, roster.length);
  assert.equal(filterByCohort(roster, 'whatever').length, roster.length);
});

test('deriveTransactionTotals aggregates per category, sorted desc', () => {
  const totals = deriveTransactionTotals(filterByCohort(roster, 'lawyers'));
  assert.deepEqual(totals, [
    { type: 'Litigation', totalHours: 17 },
    { type: 'Real Estate', totalHours: 9 },
    { type: 'Corporate', totalHours: 3 },
  ]);
});

test('deriveTransactionTotals differs between cohorts when PTE entries exist', () => {
  const fte = deriveTransactionTotals(filterByCohort(roster, 'fte-lawyers'));
  const all = deriveTransactionTotals(filterByCohort(roster, 'lawyers'));
  assert.notDeepEqual(fte, all);
});

test('deriveTransactionTotals tolerates missing transactions field and empty input', () => {
  assert.deepEqual(deriveTransactionTotals([{ name: 'X' }]), []);
  assert.deepEqual(deriveTransactionTotals([]), []);
  assert.deepEqual(deriveTransactionTotals(undefined), []);
});
