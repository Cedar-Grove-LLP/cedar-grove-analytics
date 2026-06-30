/**
 * Annual utilization progress — pure, Node-importable calculation for the
 * "at-a-glance" yearly pacing block on the Targets page and each member's
 * detail page. Given a person's 12-month target, actual, and capacity-fraction
 * arrays for one calendar year, it reports how much of the annual target is
 * done, how much remains, and whether they are ahead of / behind / on the pace
 * needed to finish the year on target.
 *
 * Pace is capacity-weighted: each month's target counts only by that month's
 * available working capacity so far (completed month = 1, current month =
 * working capacity elapsed through today, future month = 0). Those fractions
 * come from useMonthlyActualsVsTarget (which uses utils/timeOff proRateMonth),
 * so OOO/holidays lower where you "should" be without ever reducing the annual
 * target — they compress it into the days actually worked. This module never
 * computes capacity itself; it only weights a target array by a fraction array.
 *
 * Pure module — no React/Firebase imports; covered by
 * tests/annual-utilization-progress.test.mjs.
 */

import { compareBySeniority } from './seniority.mjs';

export const ANNUAL_STATUS = Object.freeze({
  NA: 'na',
  NOT_STARTED: 'not-started',
  COMPLETE: 'complete',
  AHEAD: 'ahead',
  ON_TRACK: 'on-track',
  BEHIND: 'behind',
});

export const ANNUAL_STATUS_LABEL = Object.freeze({
  [ANNUAL_STATUS.NA]: 'N/A',
  [ANNUAL_STATUS.NOT_STARTED]: 'Not started',
  [ANNUAL_STATUS.COMPLETE]: 'Complete',
  [ANNUAL_STATUS.AHEAD]: 'Ahead',
  [ANNUAL_STATUS.ON_TRACK]: 'On track',
  [ANNUAL_STATUS.BEHIND]: 'Behind',
});

/**
 * The three annual-progress groups, in the canonical section render order:
 * full-time attorneys, then operational (Ops) staff, then part-time attorneys.
 * This is the SINGLE SOURCE OF TRUTH for section ordering on the Targets page —
 * both the editable targets grid and the Annual progress summary iterate this
 * array, so the two can never drift out of order.
 *   - gridTitle:   section header in the editable targets grid (Targets page)
 *   - title:       section header in the Annual progress summary
 *   - metricLabel: the "Metric" column value ("Ops" / "Client")
 *   - matrixField: key in the editable grid cell ({ client, ops }) — Targets page
 *   - targetField: key in a stored target entry ({ billableHours, opsHours }) — member page
 *   - actualField: key in the bucketed actuals ({ client, ops })
 */
export const ANNUAL_GROUPS = Object.freeze([
  Object.freeze({
    key: 'fte',
    title: 'Attorneys Full-time — Annual progress (Client hours)',
    gridTitle: 'Attorneys Full-time',
    metricLabel: 'Client',
    matrixField: 'client',
    targetField: 'billableHours',
    actualField: 'client',
  }),
  Object.freeze({
    key: 'other',
    title: 'Other (Ops) — Annual progress',
    gridTitle: 'Other',
    metricLabel: 'Ops',
    matrixField: 'ops',
    targetField: 'opsHours',
    actualField: 'ops',
  }),
  Object.freeze({
    key: 'pte',
    title: 'Attorneys Part-time — Annual progress (Client hours)',
    gridTitle: 'Attorneys Part-time',
    metricLabel: 'Client',
    matrixField: 'client',
    targetField: 'billableHours',
    actualField: 'client',
  }),
]);

/** Map an ANNUAL_GROUPS key to its group object (or null). */
export function annualGroupByKey(key) {
  return ANNUAL_GROUPS.find((g) => g.key === key) || null;
}

/**
 * Classify users into the targets groups exactly as the monthly grid does:
 * non-attorneys → other; attorneys with employmentType 'PTE' → pte; everyone
 * else (FTE or unset) → fte. Each bucket is ordered by firm seniority. Shared so
 * the grid and the annual summary never drift apart.
 *
 * @returns {{ fte: object[], pte: object[], other: object[] }}
 */
export function groupUsersByEmployment(users) {
  const fte = [];
  const pte = [];
  const other = [];
  (users || []).forEach((u) => {
    if (!u) return;
    const role = u.role || 'Attorney';
    const emp = u.employmentType || 'FTE';
    if (role !== 'Attorney') other.push(u);
    else if (emp === 'PTE') pte.push(u);
    else fte.push(u);
  });
  const bySeniority = (a, b) => compareBySeniority(a.name || a.id || '', b.name || b.id || '');
  fte.sort(bySeniority);
  pte.sort(bySeniority);
  other.sort(bySeniority);
  return { fte, pte, other };
}

/**
 * Which annual group a single user belongs to (the ANNUAL_GROUPS object),
 * using the same rules as groupUsersByEmployment. Used by the member detail
 * page to pick the right metric/target/actual fields for one person.
 */
export function annualGroupForUser(user) {
  if (!user) return null;
  const role = user.role || 'Attorney';
  const emp = user.employmentType || 'FTE';
  if (role !== 'Attorney') return annualGroupByKey('other');
  if (emp === 'PTE') return annualGroupByKey('pte');
  return annualGroupByKey('fte');
}

const sum = (arr) => (arr || []).reduce((acc, n) => acc + (Number(n) || 0), 0);

/**
 * Dense 12-element monthly hours array from a stored target map keyed by
 * "YYYY-MM" (the cache's allTargets[name] shape). `field` is 'billableHours'
 * or 'opsHours'. Months without a stored entry contribute 0.
 */
export function monthlyHoursFromTargetMap(targetMap, year, field) {
  const out = new Array(12).fill(0);
  if (!targetMap) return out;
  for (let mi = 0; mi < 12; mi++) {
    const key = `${year}-${String(mi + 1).padStart(2, '0')}`;
    const entry = targetMap[key];
    if (entry && entry[field] != null) out[mi] = Number(entry[field]) || 0;
  }
  return out;
}

/**
 * Dense 12-element hours array from an object keyed by month index 0-11 whose
 * values are objects with numeric (or numeric-string) fields. Handles both the
 * bucketed actuals ({ [monthIdx]: { client, ops } } — useMonthlyActualsVsTarget's
 * actuals[id], numbers) and the editable targets grid matrix (same shape, but
 * cells are strings being typed). `field` is 'client' or 'ops'; parseFloat
 * tolerates both, and blank/garbage cells contribute 0.
 */
export function monthlyHoursByIndex(byMonthIdx, field) {
  const out = new Array(12).fill(0);
  if (!byMonthIdx) return out;
  for (let mi = 0; mi < 12; mi++) {
    const cell = byMonthIdx[mi];
    if (cell && cell[field] != null) out[mi] = parseFloat(cell[field]) || 0;
  }
  return out;
}

/**
 * Core annual-progress calculation for one person + metric.
 *
 * @param {number[]} monthlyTargets    length-12 target hours (Jan..Dec)
 * @param {number[]} monthlyActuals    length-12 logged hours (Jan..Dec)
 * @param {number[]} capacityFractions length-12 capacity fraction per month
 *        (completed=1, current=elapsed working capacity, future=0)
 * @param {{ tolerance?: number, isFutureYear?: boolean }} [opts]
 *        tolerance: |pace delta| within this many hours counts as On track (default 1)
 *        isFutureYear: the selected year is entirely in the future → Not started
 * @returns {{
 *   annualTarget: number, actualYtd: number, paceExpectedHours: number,
 *   remaining: number, percentComplete: number|null, pacePercent: number|null,
 *   paceDeltaHours: number, status: string, hasTarget: boolean
 * }}  percentComplete/pacePercent are null when annualTarget is 0; all
 *      hour/percent values are real (unclamped) — the UI clamps for display.
 */
export function computeAnnualProgress(monthlyTargets, monthlyActuals, capacityFractions, opts = {}) {
  const tolerance = opts.tolerance == null ? 1 : opts.tolerance;
  const isFutureYear = !!opts.isFutureYear;

  const targets = monthlyTargets || [];
  const actuals = monthlyActuals || [];
  const fractions = capacityFractions || [];

  const annualTarget = sum(targets);
  const actualYtd = sum(actuals);

  let paceExpectedHours = 0;
  for (let mi = 0; mi < 12; mi++) {
    paceExpectedHours += (Number(targets[mi]) || 0) * (Number(fractions[mi]) || 0);
  }

  const hasTarget = annualTarget > 0;
  const remaining = Math.max(annualTarget - actualYtd, 0);
  const percentComplete = hasTarget ? actualYtd / annualTarget : null;
  const pacePercent = hasTarget ? paceExpectedHours / annualTarget : null;
  const paceDeltaHours = actualYtd - paceExpectedHours;

  let status;
  if (!hasTarget) status = ANNUAL_STATUS.NA;
  else if (isFutureYear) status = ANNUAL_STATUS.NOT_STARTED;
  else if (actualYtd >= annualTarget) status = ANNUAL_STATUS.COMPLETE;
  else if (paceDeltaHours > tolerance) status = ANNUAL_STATUS.AHEAD;
  else if (paceDeltaHours < -tolerance) status = ANNUAL_STATUS.BEHIND;
  else status = ANNUAL_STATUS.ON_TRACK;

  return {
    annualTarget,
    actualYtd,
    paceExpectedHours,
    remaining,
    percentComplete,
    pacePercent,
    paceDeltaHours,
    status,
    hasTarget,
  };
}
