/**
 * Pure calculation helpers extracted from
 * src/components/views/AttorneyDetailView.jsx. The view keeps all React /
 * fetching concerns and calls these over already-fetched entry arrays, so the
 * module stays free of React/Firebase imports and is Node-importable for tests.
 *
 * Behavior mirrors the view's original inline logic exactly — any oddity is
 * deliberate parity, not a design choice. Entries are assumed to have come
 * through useFirestoreData's normalization (billableHours / opsHours already
 * present), which is why sums read `entry.billableHours || 0` directly rather
 * than analyticsAggregation's legacy-`hours` fallbacks.
 */
import { getEntryDate } from './dateHelpers.js';
import {
  calculateUtilization,
  computeProRatedTargets,
} from './analyticsAggregation.mjs';

/**
 * Date-window filter for one attorney's entries. A missing startDate means the
 * window is unbounded (all-time, or custom before both dates are picked) and
 * the input array is returned as-is.
 */
export function filterEntriesByWindow(entries, startDate, endDate) {
  if (!entries) return [];
  if (!startDate) return entries;
  return entries.filter((entry) => {
    const entryDate = getEntryDate(entry);
    return entryDate >= startDate && entryDate <= endDate;
  });
}

/** Unique 'YYYY-MM' month keys present in the (already filtered) entries. */
export function collectActiveMonths(entries) {
  const activeMonths = new Set();
  entries.forEach((entry) => {
    const entryDate = getEntryDate(entry);
    const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
    activeMonths.add(monthKey);
  });
  return activeMonths;
}

/**
 * Pro-rated targets for the attorney detail page: this view's defaults come
 * from the current month's stored target (falling back to the firm-wide
 * 100 / 50 / 150 constants), and only months WITH entries are pro-rated —
 * unlike the dashboard, which spans the whole selected range.
 *
 * @param {object} args
 * @param {Set<string>} args.activeMonths - collectActiveMonths output
 * @param {Record<string, object>} [args.monthTargets] - monthKey → stored target
 * @param {string} args.currentMonthKey - 'YYYY-MM' of "today" (PST)
 * @param {(monthKey: string, year: number, month: number) =>
 *        {fraction: number, oooDays: number, holidayDays: number}} args.getMonthProRate -
 *        never called when activeMonths is empty
 * @returns {{billableTarget: number, opsTarget: number, totalTarget: number,
 *   oooDays: number, holidayDays: number}}
 */
export function computeAttorneyDetailTargets({
  activeMonths,
  monthTargets = {},
  currentMonthKey,
  getMonthProRate,
}) {
  const defaultTarget = {
    billableHours: monthTargets[currentMonthKey]?.billableHours ?? 100,
    opsHours: monthTargets[currentMonthKey]?.opsHours ?? 50,
    totalHours: monthTargets[currentMonthKey]?.totalHours ?? 150,
  };

  if (activeMonths.size === 0) {
    // Parity with the view's historical no-entries branch: flat defaults
    // returned UNROUNDED (computeProRatedTargets would round to 1 decimal).
    return {
      billableTarget: defaultTarget.billableHours,
      opsTarget: defaultTarget.opsHours,
      totalTarget: defaultTarget.totalHours,
      oooDays: 0,
      holidayDays: 0,
    };
  }

  const targets = computeProRatedTargets({
    dataMonths: activeMonths,
    monthTargets,
    defaultTarget,
    getMonthProRate,
  });

  return {
    billableTarget: targets.billableTarget,
    opsTarget: targets.opsTarget,
    totalTarget: targets.target,
    oooDays: targets.oooDays,
    holidayDays: targets.holidayDays,
  };
}

/**
 * Headline stats for the attorney detail page (KPI cards + utilization
 * summary). `targets` is computeAttorneyDetailTargets output.
 */
export function computeAttorneyDetailStats({
  billableEntries = [],
  opsEntries = [],
  targets,
}) {
  if (!(billableEntries.length + opsEntries.length)) {
    return {
      totalHours: 0,
      billableHours: 0,
      opsHours: 0,
      totalEarnings: 0,
      totalAdjustments: 0,
      matterCount: 0,
      uniqueTransactionTypes: 0,
      uniqueClients: 0,
      avgHoursPerMatter: 0,
      lastActivity: null,
      firstActivity: null,
      utilization: calculateUtilization({ billable: 0, ops: 0, target: targets.totalTarget }),
      billableUtilization: calculateUtilization({ billable: 0, ops: 0, target: targets.billableTarget }),
      opsUtilization: calculateUtilization({ billable: 0, ops: 0, target: targets.opsTarget }),
    };
  }

  const stats = {
    totalHours: 0,
    billableHours: 0,
    opsHours: 0,
    totalEarnings: 0,
    totalAdjustments: 0,
    matters: new Set(),
    transactionTypes: new Set(),
    clients: new Set(),
    lastActivity: null,
    firstActivity: null,
  };

  billableEntries.forEach((entry) => {
    const billable = entry.billableHours || 0;
    stats.billableHours += billable;
    stats.totalHours += billable;
    stats.totalEarnings += entry.earnings || 0;
    stats.totalAdjustments += entry.adjustment || 0;

    if (entry.matter) {
      stats.matters.add(entry.matter);
    }
    if (entry.billingCategory) {
      stats.transactionTypes.add(entry.billingCategory);
    }
    if (entry.client) {
      stats.clients.add(entry.client);
    }

    const entryDate = getEntryDate(entry);
    if (!stats.lastActivity || entryDate > stats.lastActivity) {
      stats.lastActivity = entryDate;
    }
    if (!stats.firstActivity || entryDate < stats.firstActivity) {
      stats.firstActivity = entryDate;
    }
  });

  opsEntries.forEach((entry) => {
    const ops = entry.opsHours || 0;
    stats.opsHours += ops;
    stats.totalHours += ops;

    const entryDate = getEntryDate(entry);
    if (!stats.lastActivity || entryDate > stats.lastActivity) {
      stats.lastActivity = entryDate;
    }
    if (!stats.firstActivity || entryDate < stats.firstActivity) {
      stats.firstActivity = entryDate;
    }
  });

  return {
    ...stats,
    matterCount: stats.matters.size,
    uniqueTransactionTypes: stats.transactionTypes.size,
    uniqueClients: stats.clients.size,
    avgHoursPerMatter: stats.matters.size > 0
      ? stats.billableHours / stats.matters.size
      : 0,
    // Passing the pre-summed hours as `billable` (ops 0) keeps the exact
    // accumulation order of the original inline math.
    utilization: calculateUtilization({ billable: stats.totalHours, ops: 0, target: targets.totalTarget }),
    billableUtilization: calculateUtilization({ billable: stats.billableHours, ops: 0, target: targets.billableTarget }),
    opsUtilization: calculateUtilization({ billable: stats.opsHours, ops: 0, target: targets.opsTarget }),
  };
}

/**
 * Per-client rollup (billable entries only — ops entries have no client),
 * sorted by hours descending.
 */
export function buildClientBreakdown(billableEntries) {
  const breakdown = {};

  billableEntries.forEach((entry) => {
    const client = entry.client || 'Unknown';
    const billableHours = entry.billableHours || 0;
    if (!breakdown[client]) {
      breakdown[client] = {
        name: client,
        hours: 0,
        billableHours: 0,
        earnings: 0,
        count: 0,
      };
    }
    breakdown[client].billableHours += billableHours;
    breakdown[client].hours += billableHours;
    breakdown[client].earnings += entry.earnings || 0;
    breakdown[client].count += 1;
  });

  return Object.values(breakdown).sort((a, b) => b.hours - a.hours);
}

/** Per-matter rollup (entries without a matter are skipped), hours descending. */
export function buildMatterBreakdown(billableEntries) {
  const breakdown = {};

  billableEntries.forEach((entry) => {
    const matter = entry.matter;
    if (!matter) return;
    const billableHours = entry.billableHours || 0;
    if (!breakdown[matter]) {
      breakdown[matter] = { name: matter, hours: 0, count: 0 };
    }
    breakdown[matter].hours += billableHours;
    breakdown[matter].count += 1;
  });

  return Object.values(breakdown).sort((a, b) => b.hours - a.hours);
}

/**
 * Per-billing-category rollup with % of billable hours (zero-hour entries are
 * excluded), hours descending.
 */
export function buildTransactionBreakdown(billableEntries) {
  const breakdown = {};

  billableEntries.forEach((entry) => {
    const category = entry.billingCategory || 'Other';
    const billable = entry.billableHours || 0;

    if (billable > 0) {
      if (!breakdown[category]) {
        breakdown[category] = {
          type: category,
          hours: 0,
          earnings: 0,
          count: 0,
        };
      }
      breakdown[category].hours += billable;
      breakdown[category].earnings += entry.earnings || 0;
      breakdown[category].count += 1;
    }
  });

  const result = Object.values(breakdown).sort((a, b) => b.hours - a.hours);
  const totalHours = result.reduce((sum, t) => sum + t.hours, 0);

  return result.map((t) => ({
    ...t,
    percentage: totalHours > 0 ? Math.round((t.hours / totalHours) * 100) : 0,
  }));
}

/** Per-ops-category rollup with % of ops hours, hours descending. */
export function buildOpsBreakdown(opsEntries) {
  const breakdown = {};

  opsEntries.forEach((entry) => {
    const opsHours = entry.opsHours || 0;
    if (opsHours > 0) {
      const category = entry.category || 'Other';
      if (!breakdown[category]) {
        breakdown[category] = {
          category,
          hours: 0,
          count: 0,
        };
      }
      breakdown[category].hours += opsHours;
      breakdown[category].count += 1;
    }
  });

  const result = Object.values(breakdown).sort((a, b) => b.hours - a.hours);
  const totalHours = result.reduce((sum, t) => sum + t.hours, 0);

  return result.map((t) => ({
    ...t,
    percentage: totalHours > 0 ? Math.round((t.hours / totalHours) * 100) : 0,
  }));
}

/** Per-month hour/earnings series for the trend chart, month ascending. */
export function buildMonthlyTrend(entries) {
  const monthlyData = {};

  entries.forEach((entry) => {
    const entryDate = getEntryDate(entry);
    const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        month: monthKey,
        label: new Date(entryDate.getFullYear(), entryDate.getMonth(), 1)
          .toLocaleDateString('en-US', { month: 'short' }),
        billableHours: 0,
        opsHours: 0,
        totalHours: 0,
        earnings: 0,
        count: 0,
      };
    }

    monthlyData[monthKey].billableHours += entry.billableHours || 0;
    monthlyData[monthKey].opsHours += entry.opsHours || 0;
    monthlyData[monthKey].totalHours += (entry.billableHours || 0) + (entry.opsHours || 0);
    monthlyData[monthKey].earnings += entry.earnings || 0;
    monthlyData[monthKey].count += 1;
  });

  return Object.values(monthlyData).sort((a, b) => a.month.localeCompare(b.month));
}

/** Most-recent-first slice of entries for the Recent Entries table. */
export function selectRecentEntries(entries, limit = 50) {
  return [...entries]
    .sort((a, b) => {
      const dateA = getEntryDate(a);
      const dateB = getEntryDate(b);
      return dateB - dateA;
    })
    .slice(0, limit);
}

/**
 * Whether to surface the Adjustments KPI + Recent Entries column (Sam
 * McClure's manual month-end adjustments — see CLAUDE.md). True when the
 * period's adjustments net to non-zero OR any visible recent entry carries
 * one (covers offsetting +/− adjustments summing to 0).
 */
export function hasAdjustmentData(stats, recentEntries) {
  return stats.totalAdjustments !== 0 || recentEntries.some((e) => e.adjustment);
}
