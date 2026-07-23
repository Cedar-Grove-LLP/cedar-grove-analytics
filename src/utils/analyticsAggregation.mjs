/**
 * Pure attorney-aggregation helpers extracted from
 * src/hooks/useAnalyticsData.js. The hook keeps all fetching / memoization /
 * React concerns and calls these functions over already-fetched entry arrays
 * plus rates/targets lookups (injected as plain callbacks, so this module
 * stays free of React/Firebase imports and is Node-importable for tests).
 *
 * Behavior mirrors the hook's original inline logic exactly — any oddity is
 * deliberate parity, not a design choice.
 */
import { getEntryDate } from './dateHelpers.js';
import { monthKeyFromDate } from './rateLookup.mjs';
import { sortBySeniority } from './seniority.mjs';
import {
  isAttorneyHidden,
  shouldIncludeAttorneyData,
} from './hiddenAttorneys.mjs';

/**
 * Billable hours for an entry. The fetch layer (useFirestoreData's
 * normalizeBillableEntry) normalizes the raw sheet `hours` field to
 * `billableHours` (parseFloat(hours) || 0); entries that came through the
 * hooks always carry the normalized field. The same normalization is applied
 * here as a fallback so pure callers (tests, scripts) can pass legacy
 * un-normalized rows and get identical numbers.
 */
export const entryBillableHours = (entry) =>
  (entry.billableHours ?? Number.parseFloat(entry.hours)) || 0;

/** Ops-hours twin of entryBillableHours (legacy `hours` → `opsHours`). */
export const entryOpsHours = (entry) =>
  (entry.opsHours ?? Number.parseFloat(entry.hours)) || 0;

const newActivity = () => ({
  months: new Set(),
  billable: 0,
  ops: 0,
  earnings: 0,
  adjustment: 0,
  transactions: {},
  clients: {},
});

const entryMonthKey = (entryDate) =>
  `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;

/**
 * First + second aggregation pass: accumulate per-attorney activity from
 * billable and ops entries (assumed already date/attorney filtered).
 *
 * @param {object} args
 * @param {object[]} [args.billableEntries]
 * @param {object[]} [args.opsEntries]
 * @param {(entry: object) => string} args.getUserName - entry → display name
 * @param {(userName: string, entryDate: Date) => number} args.getRate -
 *        client billing rate for gross billables (rate × hours)
 * @param {string[]} [args.seedNames] - names seeded with zero records so they
 *        appear even with no hours in range
 * @returns {Record<string, {months: Set<string>, billable: number, ops: number,
 *   earnings: number, adjustment: number, hasAdjustment?: boolean,
 *   grossBillables?: number, transactions: Record<string, number>,
 *   clients: Record<string, number>}>}
 */
export function buildUserActivity({
  billableEntries = [],
  opsEntries = [],
  getUserName,
  getRate,
  seedNames = [],
}) {
  const activity = {};

  seedNames.forEach((name) => {
    activity[name] = newActivity();
  });

  // First pass: collect billable hours per user
  billableEntries.forEach((entry) => {
    const userName = getUserName(entry);
    const entryDate = getEntryDate(entry);

    if (!activity[userName]) activity[userName] = newActivity();

    if (entryDate) {
      activity[userName].months.add(entryMonthKey(entryDate));
    }

    const billableHours = entryBillableHours(entry);
    const earnings = entry.earnings || 0;

    activity[userName].billable += billableHours;
    activity[userName].earnings += earnings;
    activity[userName].adjustment += entry.adjustment || 0;
    if (entry.adjustment) activity[userName].hasAdjustment = true;
    // Gross billables = rate × hours (distinct from take-home `earnings`)
    if (billableHours > 0) {
      activity[userName].grossBillables =
        (activity[userName].grossBillables || 0) + getRate(userName, entryDate) * billableHours;
    }

    const category = entry.billingCategory || 'Other';
    const client = entry.client || 'Unknown';
    const isAdjustment =
      category.toLowerCase() === 'adjustment' || category.toLowerCase() === 'adjustments';

    // Track transactions, but exclude adjustments
    if (billableHours > 0 && !isAdjustment) {
      activity[userName].transactions[category] =
        (activity[userName].transactions[category] || 0) + billableHours;
    }

    activity[userName].clients[client] =
      (activity[userName].clients[client] || 0) + billableHours;
  });

  // Second pass: collect ops hours per user
  opsEntries.forEach((entry) => {
    const userName = getUserName(entry);
    const entryDate = getEntryDate(entry);

    if (!activity[userName]) activity[userName] = newActivity();

    if (entryDate) {
      activity[userName].months.add(entryMonthKey(entryDate));
    }

    activity[userName].ops += entryOpsHours(entry);
  });

  return activity;
}

/**
 * Third-pass target math for ONE attorney: apply a per-month pro-rate
 * fraction (computed by the caller — e.g. timeOff.js proRateMonth — and
 * passed in, never re-derived here) to that month's stored or default target.
 *
 * @param {object} args
 * @param {Iterable<string>} [args.dataMonths] - 'YYYY-MM' months with entries;
 *        fallback when rangeMonths is empty
 * @param {string[]} [args.rangeMonths] - 'YYYY-MM' months spanned by the
 *        selected date range (preferred, so zero-hour users still get targets)
 * @param {Record<string, {billableHours?: number, opsHours?: number,
 *        totalHours?: number}>} [args.monthTargets] - this user's stored targets
 * @param {{billableHours: number, opsHours: number, totalHours: number}} args.defaultTarget
 * @param {(monthKey: string, year: number, month: number) =>
 *        {fraction: number, oooDays: number, holidayDays: number}} args.getMonthProRate
 * @returns {{target: number, billableTarget: number, opsTarget: number,
 *   oooDays: number, holidayDays: number}} targets rounded to 1 decimal
 */
export function computeProRatedTargets({
  dataMonths,
  rangeMonths = [],
  monthTargets = {},
  defaultTarget,
  getMonthProRate,
}) {
  let totalBillableTarget = 0;
  let totalOpsTarget = 0;
  let totalTarget = 0;
  let oooDays = 0;
  let holidayDays = 0;

  // Use date range months for target calculation so users with zero hours
  // still get proper pro-rated targets for the selected period
  const monthsForTargets =
    rangeMonths.length > 0 ? rangeMonths : Array.from(dataMonths ?? []);

  // If no months at all, use defaults for one month
  if (monthsForTargets.length === 0) {
    totalBillableTarget = defaultTarget.billableHours;
    totalOpsTarget = defaultTarget.opsHours;
    totalTarget = defaultTarget.totalHours;
  } else {
    monthsForTargets.forEach((monthKey) => {
      const [year, month] = monthKey.split('-').map(Number);

      const monthTarget = monthTargets[monthKey];
      const billableTarget = monthTarget?.billableHours ?? defaultTarget.billableHours;
      const opsTarget = monthTarget?.opsHours ?? defaultTarget.opsHours;
      const monthTotalTarget = monthTarget?.totalHours ?? defaultTarget.totalHours;

      const pm = getMonthProRate(monthKey, year, month);

      totalBillableTarget += billableTarget * pm.fraction;
      totalOpsTarget += opsTarget * pm.fraction;
      totalTarget += monthTotalTarget * pm.fraction;
      oooDays += pm.oooDays; // OOO / holiday context (UI messaging only)
      holidayDays += pm.holidayDays;
    });
  }

  return {
    target: Math.round(totalTarget * 10) / 10,
    billableTarget: Math.round(totalBillableTarget * 10) / 10,
    opsTarget: Math.round(totalOpsTarget * 10) / 10,
    oooDays,
    holidayDays,
  };
}

/**
 * Assemble the full per-attorney stats array (attorneyData shape, before
 * visibility filtering) from an activity map + target inputs.
 *
 * @param {object} args
 * @param {ReturnType<typeof buildUserActivity>} args.activity
 * @param {string[]} args.rangeMonths
 * @param {Record<string, object>} [args.userTargets] - userName → monthKey → target
 * @param {(userName: string) => {billableHours: number, opsHours: number,
 *        totalHours: number}} args.getDefaultTarget
 * @param {(userName: string) => (monthKey: string, year: number, month: number) =>
 *        {fraction: number, oooDays: number, holidayDays: number}} args.getMonthProRateFor -
 *        per-user factory so callers resolve user-scoped inputs (OOO map) once
 * @param {(userName: string) => string} args.getUserRole
 * @param {(userName: string) => string} args.getEmploymentType
 * @returns {object[]} stats in activity insertion order (unsorted, unfiltered)
 */
export function buildAttorneyStats({
  activity,
  rangeMonths,
  userTargets = {},
  getDefaultTarget,
  getMonthProRateFor,
  getUserRole,
  getEmploymentType,
}) {
  return Object.entries(activity).map(([userName, data]) => {
    const targets = computeProRatedTargets({
      dataMonths: data.months,
      rangeMonths,
      monthTargets: userTargets[userName] || {},
      defaultTarget: getDefaultTarget(userName),
      getMonthProRate: getMonthProRateFor(userName),
    });

    return {
      name: userName,
      billable: data.billable,
      ops: data.ops,
      earnings: data.earnings,
      adjustment: data.adjustment || 0,
      hasAdjustment: !!data.hasAdjustment,
      grossBillables: data.grossBillables || 0,
      target: targets.target,
      billableTarget: targets.billableTarget,
      opsTarget: targets.opsTarget,
      oooDays: targets.oooDays,
      holidayDays: targets.holidayDays,
      role: getUserRole(userName),
      employmentType: getEmploymentType(userName),
      transactions: data.transactions,
      clients: data.clients,
      topTransactions: Object.entries(data.transactions)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name]) => name),
    };
  });
}

/**
 * Visibility filter + seniority sort for the attorneyData list. Hidden
 * attorneys (hiddenAttorneys.mjs) whose configured window doesn't overlap the
 * range — and inactive / not-yet-joined attorneys with no data in range — are
 * dropped from DISPLAY here; their entries still count in aggregate totals
 * via buildAttorneyTotalsIncludingHidden.
 *
 * @param {object[]} attorneys - stats objects with a `name` property
 * @param {object} args
 * @param {Set<string>} [args.inactiveNames]
 * @param {Set<string>} [args.notYetJoinedNames]
 * @param {Set<string>} [args.namesWithData] - names with entries in range
 * @param {Date} args.startDate
 * @param {Date} args.endDate
 * @returns {object[]} visible attorneys in firm seniority order
 */
export function selectVisibleAttorneys(attorneys, {
  inactiveNames = new Set(),
  notYetJoinedNames = new Set(),
  namesWithData = new Set(),
  startDate,
  endDate,
}) {
  const visible = attorneys.filter((user) => {
    // Inactive attorneys only show when the timeframe overlaps their data.
    if (inactiveNames.has(user.name) && !namesWithData.has(user.name)) {
      return false;
    }
    // Not-yet-joined attorneys only show when the timeframe overlaps their data.
    if (notYetJoinedNames.has(user.name) && !namesWithData.has(user.name)) {
      return false;
    }
    return shouldIncludeAttorneyData(user.name, startDate, endDate) &&
           !isAttorneyHidden(user.name);
  });

  // Default per-attorney order is firm seniority, so any consumer that renders
  // this list as-is (and not via its own sort) shows staff most→least tenured.
  return sortBySeniority(visible, (user) => user.name || user.id);
}

/**
 * Simple per-attorney totals INCLUDING hidden users — powers firm-wide
 * aggregate totals per the hiddenAttorneys.mjs contract (hidden from UI but
 * included in aggregates). Targets here are flat current-month defaults
 * (not pro-rated), exactly as the hook always computed them for this dataset.
 *
 * @param {object} args
 * @param {object[]} [args.billableEntries]
 * @param {object[]} [args.opsEntries]
 * @param {(entry: object) => string} args.getUserName
 * @param {(userName: string) => {billableHours: number, opsHours: number,
 *        totalHours: number}} args.getDefaultTarget
 * @returns {object[]}
 */
export function buildAttorneyTotalsIncludingHidden({
  billableEntries = [],
  opsEntries = [],
  getUserName,
  getDefaultTarget,
}) {
  const totalsByUser = {};
  const ensure = (userName) => {
    if (!totalsByUser[userName]) {
      totalsByUser[userName] = { billable: 0, ops: 0, earnings: 0, adjustment: 0 };
    }
    return totalsByUser[userName];
  };

  billableEntries.forEach((entry) => {
    const record = ensure(getUserName(entry));
    record.billable += entryBillableHours(entry);
    record.earnings += entry.earnings || 0;
    record.adjustment += entry.adjustment || 0;
  });

  opsEntries.forEach((entry) => {
    ensure(getUserName(entry)).ops += entryOpsHours(entry);
  });

  return Object.entries(totalsByUser).map(([userName, data]) => {
    const defaultTarget = getDefaultTarget(userName);
    return {
      name: userName,
      billable: data.billable,
      ops: data.ops,
      earnings: data.earnings,
      adjustment: data.adjustment || 0,
      target: defaultTarget.totalHours,
      billableTarget: defaultTarget.billableHours,
      opsTarget: defaultTarget.opsHours,
    };
  });
}

/**
 * Utilization %. Returns null (→ "N/A") when the pro-rated target is 0,
 * which happens when an attorney is out of office for the entire period —
 * reporting 0% there would misread leave as underperformance.
 */
export const calculateUtilization = (user) => {
  const total = user.billable + user.ops;
  if (!user.target || user.target <= 0) return null;
  return Math.round((total / user.target) * 100);
};

/**
 * One pass over in-range billable entries computes both the gross billables
 * total (rate × hours — includes hidden users) AND the missing-rate warnings:
 * attorneys whose hours bill at $0 because no usable rate covers those months
 * (see rateLookup.mjs for the retrospective earliest-rate fallback semantics).
 *
 * @param {object} args
 * @param {object[]} [args.billableEntries]
 * @param {(entry: object) => string} args.getUserName
 * @param {(userName: string, entryDate: Date) =>
 *        {rate: number, found: boolean}} args.getRateInfo
 * @returns {{totalGrossBillables: number, missingRateWarnings:
 *   Array<{userName: string, monthKeys: string[], hours: number}>}}
 *   warnings in firm seniority order
 */
export function computeGrossBillables({
  billableEntries = [],
  getUserName,
  getRateInfo,
}) {
  const rateInfoCache = new Map(); // `${userName}|${monthKey}` -> { rate, found }
  const byUser = new Map();        // userName -> { monthKeys: Set, hours: number }
  let total = 0;

  billableEntries.forEach((entry) => {
    const billableHours = entryBillableHours(entry);
    if (billableHours <= 0) return;

    const entryDate = getEntryDate(entry);
    const userName = getUserName(entry);
    const monthKey = monthKeyFromDate(entryDate);
    if (!monthKey) return;

    const cacheKey = `${userName}|${monthKey}`;
    let info = rateInfoCache.get(cacheKey);
    if (!info) {
      info = getRateInfo(userName, entryDate);
      rateInfoCache.set(cacheKey, info);
    }

    total += info.rate * billableHours;
    if (info.found) return;

    if (!byUser.has(userName)) {
      byUser.set(userName, { monthKeys: new Set(), hours: 0 });
    }
    const record = byUser.get(userName);
    record.monthKeys.add(monthKey);
    record.hours += billableHours;
  });

  const warnings = sortBySeniority(
    [...byUser.entries()].map(([userName, record]) => ({
      userName,
      monthKeys: [...record.monthKeys].sort(),
      hours: record.hours,
    })),
    (w) => w.userName,
  );

  return { totalGrossBillables: total, missingRateWarnings: warnings };
}

/**
 * Firm-wide totals: hour/earnings sums come from the INCLUDING-hidden dataset
 * (aggregate-totals convention), target sums and utilization averages from
 * the visible list only. Average utilization skips attorneys with no target
 * for the period (fully out of office) so their N/A doesn't drag the average.
 *
 * @param {object} args
 * @param {object[]} [args.visibleAttorneys] - attorneyData (hidden excluded)
 * @param {object[]} [args.attorneysIncludingHidden]
 */
export function computeFirmTotals({
  visibleAttorneys = [],
  attorneysIncludingHidden = [],
}) {
  const totalBillable = attorneysIncludingHidden.reduce((acc, att) => acc + att.billable, 0);
  const totalOps = attorneysIncludingHidden.reduce((acc, att) => acc + att.ops, 0);
  const totalEarnings = attorneysIncludingHidden.reduce((acc, att) => acc + att.earnings, 0);

  const totalBillableTarget = visibleAttorneys.reduce((acc, att) => acc + att.billableTarget, 0);
  const totalOpsTarget = visibleAttorneys.reduce((acc, att) => acc + att.opsTarget, 0);

  const attorneysOnly = visibleAttorneys;
  const fteAttorneys = attorneysOnly.filter((att) => att.employmentType === 'FTE');
  const pteAttorneys = attorneysOnly.filter((att) => att.employmentType === 'PTE');

  const avgOf = (list) => {
    const vals = list.map((att) => calculateUtilization(att)).filter((v) => v !== null);
    return vals.length > 0
      ? Math.round(vals.reduce((acc, v) => acc + v, 0) / vals.length)
      : 0;
  };

  return {
    totalBillable,
    totalOps,
    totalEarnings,
    totalBillableTarget,
    totalOpsTarget,
    avgUtilization: avgOf(attorneysOnly),
    avgUtilizationFTE: avgOf(fteAttorneys),
    avgUtilizationPTE: avgOf(pteAttorneys),
    attorneyCountFTE: fteAttorneys.length,
    attorneyCountPTE: pteAttorneys.length,
    attorneyCountTotal: attorneysOnly.length,
  };
}
