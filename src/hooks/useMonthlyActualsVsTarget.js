import { useMemo } from 'react';
import { useAllBillableEntries, useAllOpsEntries, useTimeOff } from '@/hooks/useFirestoreData';
import { getEntryDate, getPSTDate } from '@/utils/dateHelpers';
import { parseTimeOff, getHolidaySet, getOooMapFor, proRateMonth } from '@/utils/timeOff';

const EMPTY_OOO_MAP = new Map();

/**
 * Bucket billable + ops entries into per-user, per-month hour sums for one
 * calendar `year`, keyed by entry date via the app-wide getEntryDate rule.
 *
 * @returns {{ [userId: string]: { [monthIdx: number]: { client: number, ops: number } } }}
 *          monthIdx is 0-11; client = billable hours, ops = ops hours.
 */
export const bucketMonthlyHoursByUser = (billableEntries, opsEntries, year) => {
  const out = {};
  const bump = (userId, monthIdx, field, hrs) => {
    if (!userId) return;
    if (!out[userId]) out[userId] = {};
    if (!out[userId][monthIdx]) out[userId][monthIdx] = { client: 0, ops: 0 };
    out[userId][monthIdx][field] += hrs;
  };
  (billableEntries || []).forEach((e) => {
    const d = getEntryDate(e);
    if (!d || isNaN(d.getTime()) || d.getFullYear() !== year) return;
    bump(e.userId, d.getMonth(), 'client', e.billableHours || 0);
  });
  (opsEntries || []).forEach((e) => {
    const d = getEntryDate(e);
    if (!d || isNaN(d.getTime()) || d.getFullYear() !== year) return;
    bump(e.userId, d.getMonth(), 'ops', e.opsHours || 0);
  });
  return out;
};

/**
 * Per-user capacity-model pro-rate fraction for each month of `year` (firm
 * holidays + that user's OOO), plus which months are still in the future.
 * Mirrors the utilization pro-rating used elsewhere (utils/timeOff.js): the
 * in-progress current month is pro-rated to `now`, completed months get a full
 * month, and future months are left at fraction 0 (callers blank them).
 *
 * The future-month flags and the no-OOO fraction set depend only on
 * year/holidays/now — not the attorney — so they are computed once and shared
 * (read-only) across every user without OOO, the common case, avoiding a
 * redundant per-attorney month scan.
 *
 * @returns {{ [userId: string]: { fractions: number[], future: boolean[] } }}
 *          fractions/future are length-12 (monthIdx 0-11).
 */
export const computeMonthlyCapacity = (users, parsedTimeOff, year, now) => {
  const yearStart = new Date(year, 0, 1, 0, 0, 0, 0);
  const yearEnd = new Date(year, 11, 31, 23, 59, 59, 999);
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const range = { startDate: yearStart, endDate: yearEnd, currentMonthKey, now };
  const holidaySet = getHolidaySet(parsedTimeOff, yearStart, yearEnd);

  // Attorney-independent: future flags + the fraction for someone with no OOO.
  // Frozen because they're handed out by reference to every no-OOO user — the
  // freeze turns the read-only contract into an enforced invariant.
  const future = [];
  const baseFractions = [];
  for (let mi = 0; mi < 12; mi++) {
    const isFuture = new Date(year, mi, 1).getTime() > now.getTime();
    future[mi] = isFuture;
    baseFractions[mi] = isFuture ? 0 : proRateMonth(year, mi + 1, range, holidaySet, EMPTY_OOO_MAP).fraction;
  }
  Object.freeze(future);
  Object.freeze(baseFractions);

  const out = {};
  (users || []).forEach((u) => {
    const oooMap = getOooMapFor(parsedTimeOff, { name: u.name || u.id, email: u.email || '' });
    if (!oooMap || oooMap.size === 0) {
      // No OOO → identical to the shared base (read-only, safe to share).
      out[u.id] = { fractions: baseFractions, future };
      return;
    }
    const fractions = [];
    for (let mi = 0; mi < 12; mi++) {
      fractions[mi] = future[mi] ? 0 : proRateMonth(year, mi + 1, range, holidaySet, oooMap).fraction;
    }
    out[u.id] = { fractions, future };
  });
  return out;
};

/**
 * Shared source of truth for the per-attorney, per-month "actual hours vs.
 * capacity-pro-rated target" data over a single calendar `year`. Reads entries
 * and time-off from the Firestore cache; the caller passes the `users` cohort
 * to compute capacity for, so a view can scope it to the rows it actually
 * renders (e.g. with hidden attorneys already filtered out). Returns memoized:
 *   - actuals:  per userId → monthIdx → { client, ops } logged hours
 *   - capacity: per userId → { fractions[12], future[12] }
 *   - loading:  whether the underlying entry collections are still loading
 * The caller combines these with its own target source (e.g. the editable
 * targets grid) to compute the variance.
 *
 * NOTE: the dashboard (useAnalyticsData) and the attorney-detail view pro-rate
 * over the active *date range* (a variable month set) — a different shape — so
 * they keep their own range-based aggregation and are not consumers of this
 * full-year hook.
 */
export const useMonthlyActualsVsTarget = (year, users) => {
  const { data: allBillableEntries, loading: billableLoading } = useAllBillableEntries();
  const { data: allOpsEntries, loading: opsLoading } = useAllOpsEntries();
  const { data: timeOff } = useTimeOff();

  const actuals = useMemo(
    () => bucketMonthlyHoursByUser(allBillableEntries, allOpsEntries, year),
    [allBillableEntries, allOpsEntries, year]
  );

  const parsedTimeOff = useMemo(() => parseTimeOff(timeOff), [timeOff]);

  // Capacity is the costly part (per-attorney month scans), so it's scoped to
  // the `users` the caller will actually render — not the full cache roster.
  const capacity = useMemo(
    () => computeMonthlyCapacity(users, parsedTimeOff, year, getPSTDate()),
    [users, parsedTimeOff, year]
  );

  return { actuals, capacity, loading: billableLoading || opsLoading };
};

export default useMonthlyActualsVsTarget;
