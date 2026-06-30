import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNUAL_STATUS,
  ANNUAL_STATUS_LABEL,
  ANNUAL_GROUPS,
  annualGroupByKey,
  annualGroupForUser,
  groupUsersByEmployment,
  monthlyHoursFromTargetMap,
  monthlyHoursByIndex,
  computeAnnualProgress,
} from '../src/utils/annualUtilizationProgress.mjs';

// Helpers ------------------------------------------------------------------
const fill = (n) => new Array(12).fill(n);
// Capacity for a year that is half-elapsed through June (months 0-4 done,
// month 5 half-elapsed, months 6-11 future): the shape useMonthlyActualsVsTarget
// produces for a clean (no-OOO) attorney mid-June.
const HALF_JUNE = [1, 1, 1, 1, 1, 0.5, 0, 0, 0, 0, 0, 0];

// --- Status enum / labels -------------------------------------------------
test('every status has a human label', () => {
  for (const key of Object.values(ANNUAL_STATUS)) {
    assert.ok(ANNUAL_STATUS_LABEL[key], `label for ${key}`);
  }
});

// --- 1. Clean current-year pacing, no OOO ---------------------------------
test('clean current-year pacing: at pace = on track, above = ahead, below = behind', () => {
  const targets = fill(10); // 120h annual, even across months
  // pace-expected = 10*(1*5 + 0.5) = 55h
  const atPace = computeAnnualProgress(targets, [10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(atPace.paceExpectedHours, 55);
  assert.equal(atPace.actualYtd, 55);
  assert.equal(atPace.status, ANNUAL_STATUS.ON_TRACK);
  assert.equal(atPace.annualTarget, 120);
  assert.equal(atPace.remaining, 65);

  const ahead = computeAnnualProgress(targets, [12, 12, 12, 12, 12, 6, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(ahead.actualYtd, 66);
  assert.equal(ahead.status, ANNUAL_STATUS.AHEAD);
  assert.ok(ahead.paceDeltaHours > 1);

  const behind = computeAnnualProgress(targets, [8, 8, 8, 8, 8, 4, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(behind.actualYtd, 44);
  assert.equal(behind.status, ANNUAL_STATUS.BEHIND);
  assert.ok(behind.paceDeltaHours < -1);
});

test('tolerance boundary: ±1h delta is on track, outside flips', () => {
  const targets = fill(10); // pace-expected with HALF_JUNE = 55h
  const plusOne = computeAnnualProgress(targets, [11, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(plusOne.paceDeltaHours, 1);
  assert.equal(plusOne.status, ANNUAL_STATUS.ON_TRACK); // +1 is within tolerance

  const minusOne = computeAnnualProgress(targets, [9, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(minusOne.paceDeltaHours, -1);
  assert.equal(minusOne.status, ANNUAL_STATUS.ON_TRACK); // -1 is within tolerance

  const over = computeAnnualProgress(targets, [11.5, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0], HALF_JUNE);
  assert.equal(over.paceExpectedHours, 55);
  assert.equal(over.actualYtd, 56.5);
  assert.equal(over.status, ANNUAL_STATUS.AHEAD);
});

// --- 2. OOO early in the current month lowers expected pace ----------------
test('OOO early in the current month lowers pace-expected before the attorney returns', () => {
  const targets = fill(10);
  const actual = [10, 10, 10, 10, 10, 2, 0, 0, 0, 0, 0, 0]; // 52h logged, only 2h so far in June
  // No OOO: pace-expected = 55h → 52 is short → BEHIND
  const noOoo = computeAnnualProgress(targets, actual, HALF_JUNE);
  assert.equal(noOoo.paceExpectedHours, 55);
  assert.equal(noOoo.status, ANNUAL_STATUS.BEHIND);

  // OOO the first half of June → current-month capacity fraction drops 0.5 → 0.1
  const oooJune = [1, 1, 1, 1, 1, 0.1, 0, 0, 0, 0, 0, 0];
  const withOoo = computeAnnualProgress(targets, actual, oooJune);
  assert.equal(withOoo.paceExpectedHours, 51); // 10*(5 + 0.1)
  // Lower expected pace → the same 52h logged is now slightly ahead of pace
  assert.ok(withOoo.paceExpectedHours < noOoo.paceExpectedHours);
  assert.equal(withOoo.status, ANNUAL_STATUS.ON_TRACK);
  // Annual target is unchanged — OOO compresses pace, never reduces the target
  assert.equal(withOoo.annualTarget, noOoo.annualTarget);
});

// --- 3. Full past year (all months complete) ------------------------------
test('full past year: pace = full annual target; incomplete = behind, hit = complete', () => {
  const targets = fill(10); // 120h
  const cap = fill(1); // every month complete for a year already finished

  const behind = computeAnnualProgress(targets, fill(8), cap); // 96h
  assert.equal(behind.paceExpectedHours, 120);
  assert.equal(behind.status, ANNUAL_STATUS.BEHIND);
  assert.equal(behind.remaining, 24);

  const complete = computeAnnualProgress(targets, fill(10), cap); // 120h
  assert.equal(complete.status, ANNUAL_STATUS.COMPLETE);
  assert.equal(complete.remaining, 0);

  const over = computeAnnualProgress(targets, fill(11), cap); // 132h > target
  assert.equal(over.status, ANNUAL_STATUS.COMPLETE);
  assert.equal(over.remaining, 0);
  assert.ok(over.percentComplete > 1); // real value preserved (1.1)
});

// --- 4. Future year -------------------------------------------------------
test('future year: not started, never behind, no NaN', () => {
  const targets = fill(10);
  const cap = fill(0); // nothing has come due
  const res = computeAnnualProgress(targets, fill(0), cap, { isFutureYear: true });
  assert.equal(res.status, ANNUAL_STATUS.NOT_STARTED);
  assert.equal(res.paceExpectedHours, 0);
  assert.equal(res.actualYtd, 0);
  assert.equal(res.remaining, 120);
  assert.ok(Number.isFinite(res.percentComplete));
  assert.equal(res.percentComplete, 0);
});

// --- 5. Zero / missing target ---------------------------------------------
test('zero or missing target: N/A, null percents, no division by zero', () => {
  const zero = computeAnnualProgress(fill(0), fill(0), HALF_JUNE);
  assert.equal(zero.status, ANNUAL_STATUS.NA);
  assert.equal(zero.annualTarget, 0);
  assert.equal(zero.percentComplete, null);
  assert.equal(zero.pacePercent, null);
  assert.equal(zero.remaining, 0);
  assert.equal(zero.hasTarget, false);

  const missing = computeAnnualProgress(undefined, undefined, undefined);
  assert.equal(missing.status, ANNUAL_STATUS.NA);
  assert.equal(missing.annualTarget, 0);
  assert.ok(!Number.isNaN(missing.paceExpectedHours));

  // Logged hours but no target still resolves to N/A, not a divide-by-zero %.
  const loggedNoTarget = computeAnnualProgress(fill(0), fill(5), HALF_JUNE);
  assert.equal(loggedNoTarget.status, ANNUAL_STATUS.NA);
  assert.equal(loggedNoTarget.percentComplete, null);
});

// --- 6. PTE / FTE / Other grouping ----------------------------------------
test('groupUsersByEmployment buckets PTE / FTE / Other with sane defaults', () => {
  const roster = [
    { id: 'a', name: 'Zoe Adams', role: 'Attorney', employmentType: 'FTE' },
    { id: 'b', name: 'Bob Brown', role: 'Attorney', employmentType: 'PTE' },
    { id: 'c', name: 'Cara Cole', role: 'Operations' }, // non-attorney → other
    { id: 'd', name: 'Dan Dunn', role: 'Attorney' }, // missing employmentType → fte
    { id: 'e', name: 'Amy Ash', role: 'Attorney', employmentType: 'PTE' },
  ];
  const { fte, pte, other } = groupUsersByEmployment(roster);
  // None of these names are on the seniority roster, so each bucket falls back
  // to alphabetical order.
  assert.deepEqual(fte.map((u) => u.name), ['Dan Dunn', 'Zoe Adams']);
  assert.deepEqual(pte.map((u) => u.name), ['Amy Ash', 'Bob Brown']);
  assert.deepEqual(other.map((u) => u.name), ['Cara Cole']);
});

test('groupUsersByEmployment orders each bucket by firm seniority', () => {
  const roster = [
    { id: '1', name: 'Martyna Skrodzka', role: 'Attorney', employmentType: 'PTE' },
    { id: '2', name: 'Colin Van Loon', role: 'Attorney', employmentType: 'FTE' },
    { id: '3', name: 'Valery Uscanga', role: 'Attorney', employmentType: 'PTE' },
    { id: '4', name: 'Sam McClure', role: 'Attorney', employmentType: 'FTE' },
  ];
  const { fte, pte } = groupUsersByEmployment(roster);
  // Sam (rank 0) before Colin (rank 1); Valery (rank 5) before Martyna (rank 9).
  assert.deepEqual(fte.map((u) => u.name), ['Sam McClure', 'Colin Van Loon']);
  assert.deepEqual(pte.map((u) => u.name), ['Valery Uscanga', 'Martyna Skrodzka']);
});

test('groupUsersByEmployment tolerates empty / nullish input', () => {
  assert.deepEqual(groupUsersByEmployment([]), { fte: [], pte: [], other: [] });
  assert.deepEqual(groupUsersByEmployment(null), { fte: [], pte: [], other: [] });
  assert.deepEqual(groupUsersByEmployment([null, undefined]), { fte: [], pte: [], other: [] });
});

test('annualGroupForUser picks the right metric fields', () => {
  assert.equal(annualGroupForUser({ role: 'Operations' }).key, 'other');
  assert.equal(annualGroupForUser({ role: 'Attorney', employmentType: 'PTE' }).key, 'pte');
  assert.equal(annualGroupForUser({ role: 'Attorney' }).key, 'fte');
  assert.equal(annualGroupForUser(null), null);
  // Ops group meters ops hours; attorney groups meter client/billable hours.
  assert.equal(annualGroupByKey('other').actualField, 'ops');
  assert.equal(annualGroupByKey('other').targetField, 'opsHours');
  assert.equal(annualGroupByKey('fte').actualField, 'client');
  assert.equal(annualGroupByKey('fte').targetField, 'billableHours');
  // Canonical section order: Full-time, Operations (Other), Part-time.
  assert.deepEqual(ANNUAL_GROUPS.map((g) => g.key), ['fte', 'other', 'pte']);
  // Each group also carries its editable-grid section header.
  assert.deepEqual(
    ANNUAL_GROUPS.map((g) => g.gridTitle),
    ['Attorneys Full-time', 'Other', 'Attorneys Part-time'],
  );
});

// --- 7. Capacity-weighted front/back-loaded monthly targets ---------------
test('capacity-weighting respects front- vs back-loaded monthly target distribution', () => {
  // Same 120h annual total, but one front-loads Q1 and the other back-loads Q4.
  const frontLoaded = [30, 30, 30, 10, 10, 10, 0, 0, 0, 0, 0, 0];
  const backLoaded = [0, 0, 0, 0, 0, 0, 10, 10, 10, 30, 30, 30];
  assert.equal(frontLoaded.reduce((a, b) => a + b, 0), 120);
  assert.equal(backLoaded.reduce((a, b) => a + b, 0), 120);

  // Capacity: only Jan-Mar have come due (a year a quarter in).
  const cap = [1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  const front = computeAnnualProgress(frontLoaded, fill(0), cap);
  const back = computeAnnualProgress(backLoaded, fill(0), cap);

  // Front-loaded target → much higher expected pace this early in the year.
  assert.equal(front.paceExpectedHours, 90); // 30+30+30
  assert.equal(back.paceExpectedHours, 0); // nothing due yet
  assert.ok(front.paceExpectedHours > back.paceExpectedHours);
  // Both share the same annual target despite the different pace.
  assert.equal(front.annualTarget, back.annualTarget);
  assert.equal(front.pacePercent, 0.75);
  assert.equal(back.pacePercent, 0);
});

// --- Array builders -------------------------------------------------------
test('monthlyHoursFromTargetMap reads the "YYYY-MM" cache shape for one field', () => {
  const targetMap = {
    '2026-01': { billableHours: 100, opsHours: 20, totalHours: 120 },
    '2026-03': { billableHours: 80, opsHours: 10, totalHours: 90 },
    '2025-01': { billableHours: 999, opsHours: 999 }, // wrong year, ignored
  };
  const billable = monthlyHoursFromTargetMap(targetMap, 2026, 'billableHours');
  assert.equal(billable[0], 100);
  assert.equal(billable[2], 80);
  assert.equal(billable[1], 0); // no Feb entry
  assert.equal(billable.reduce((a, b) => a + b, 0), 180);
  const ops = monthlyHoursFromTargetMap(targetMap, 2026, 'opsHours');
  assert.equal(ops[0], 20);
  assert.deepEqual(monthlyHoursFromTargetMap(null, 2026, 'billableHours'), fill(0));
});

test('monthlyHoursByIndex densifies the { monthIdx: { client, ops } } shape (numbers and matrix strings)', () => {
  const actualsForUser = { 0: { client: 50, ops: 5 }, 5: { client: 12.5, ops: 0 } };
  const client = monthlyHoursByIndex(actualsForUser, 'client');
  assert.equal(client[0], 50);
  assert.equal(client[5], 12.5);
  assert.equal(client[1], 0);
  assert.equal(monthlyHoursByIndex(actualsForUser, 'ops')[0], 5);
  assert.deepEqual(monthlyHoursByIndex(undefined, 'client'), fill(0));

  // The same helper also reads the editable grid matrix, whose cells are
  // strings being typed ('' = unset → 0).
  const matrix = { 0: { client: '100', ops: '' }, 2: { client: '80.5', ops: '10' } };
  const target = monthlyHoursByIndex(matrix, 'client');
  assert.equal(target[0], 100);
  assert.equal(target[2], 80.5);
  assert.equal(target[1], 0);
  assert.equal(monthlyHoursByIndex(matrix, 'ops')[0], 0); // '' → 0
});
