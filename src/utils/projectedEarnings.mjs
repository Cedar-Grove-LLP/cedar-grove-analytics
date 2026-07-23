/**
 * Projected-earnings engine — pure, Node-importable calculation behind the
 * admin Projected Earnings page (components/admin/ProjectedEarningsTable.jsx).
 *
 * Contract (see CLAUDE.md "Earnings predictions"):
 * - Rank is derived by exact-matching an attorney's latest stored CLIENT rate
 *   against rateCard.levels[].clientRate.
 * - Rank bumps by 1 at each Q2 (Apr 1) and Q4 (Oct 1) boundary that lies on or
 *   after the current month, capped at MAX_RANK (19).
 * - Payout uses the take-home column — attorneyRate, or colinRate for Colin
 *   Van Loon (null below rank 13 → falls back to attorneyRate).
 * - No exact rate match → "No rank match" (hasRankMatch false) and $0 projected.
 * - PTE attorneys skip the rate card entirely: stored rate held flat all year,
 *   no bumps, no rank match required. The per-attorney Promote override
 *   (promoteOverrides[userId] === false) holds an FTE at their current rank.
 * - Partners additionally receive profitShare =
 *   avg(completed-month firmProfit) × 12 × share% (McClure 95%, Van Loon 5%).
 *
 * Pure module — no React/Firebase imports; `today` and the entry-date
 * extractor are injected (dateHelpers.js is not Node-importable). Covered by
 * tests/projected-earnings.test.mjs.
 */

import { filterHiddenAttorneys } from './hiddenAttorneys.mjs';
import { sortBySeniority } from './seniority.mjs';
import { hasJoinedBy } from './userActivation.mjs';

export const MAX_RANK = 19;

export const isColin = (name) => /colin\s+van\s+loon/i.test(name || '');

// Partners share the predicted firm profit: Sam 95%, Colin 5%. Everyone else 0.
const PARTNER_SHARES = [
  { test: (n) => /sam\s+mcclure/i.test(n || ''), pct: 0.95 },
  { test: (n) => /colin\s+van\s+loon/i.test(n || ''), pct: 0.05 },
];
export const partnerSharePct = (name) => PARTNER_SHARES.find((p) => p.test(name))?.pct || 0;

const MONTH_INDEX = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};

// Stored rates in users/{id}.rates are CLIENT billing rates, so rank is always
// derived from clientRate. Projection pays out the take-home column instead:
// colinRate for Colin (his bespoke ladder), attorneyRate for everyone else.
export const takeHomeField = (name) => (isColin(name) ? 'colinRate' : 'attorneyRate');

export const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Find latest stored rate for an attorney (highest monthKey).
export const findLatestRate = (ratesByMonth) => {
  if (!ratesByMonth) return null;
  const keys = Object.keys(ratesByMonth).sort();
  if (keys.length === 0) return null;
  const last = keys[keys.length - 1];
  return {
    rate: ratesByMonth[last]?.rate || 0,
    monthKey: last,
  };
};

// Match a stored rate against rateCard.levels by the appropriate field.
export const findRankForRate = (levels, rate, field) => {
  if (!rate || !Array.isArray(levels)) return -1;
  return levels.findIndex((lvl) => Number(lvl[field]) === Number(rate));
};

// Predicted rank in a given month, with Q2 (Apr) and Q4 (Oct) bumps applied
// only when the boundary lies on or after the current month.
export const predictedRankForMonth = (startRank, currentMonth, month) => {
  let rank = startRank;
  if (currentMonth < 4 && month >= 4) rank += 1;
  if (currentMonth < 10 && month >= 10) rank += 1;
  return Math.min(rank, MAX_RANK);
};

// Predicted full-year firm profit: average the completed-month firm profit
// (invoices sheet B16, synced as `firmProfit` on monthlyMetrics) and × 12.
// "Completed" = months of the current year that have fully ended.
export const predictedAnnualFirmProfit = (monthlyMetrics, currentYear, currentMonth) => {
  const completed = (monthlyMetrics || []).filter((e) => {
    const mi = MONTH_INDEX[e.month];
    return Number(e.year) === currentYear && mi && mi < currentMonth && Number.isFinite(e.firmProfit);
  });
  return completed.length
    ? (completed.reduce((s, e) => s + Number(e.firmProfit), 0) / completed.length) * 12
    : 0;
};

export const sumProjectedTotals = (list) =>
  list.reduce(
    (acc, r) => ({
      ytdEarnings: acc.ytdEarnings + r.ytdEarnings,
      ytdHours: acc.ytdHours + r.ytdHours,
      projectedHours: acc.projectedHours + r.projectedHours,
      projectedEarnings: acc.projectedEarnings + r.projectedEarnings,
      profitShare: acc.profitShare + r.profitShare,
      totalProjectedEarnings: acc.totalProjectedEarnings + r.totalProjectedEarnings,
    }),
    {
      ytdEarnings: 0,
      ytdHours: 0,
      projectedHours: 0,
      projectedEarnings: 0,
      profitShare: 0,
      totalProjectedEarnings: 0,
    }
  );

/**
 * Build the per-attorney projection rows for the current calendar year.
 *
 * @param {object} args
 * @param {Array}  args.users              users/{id} docs ({ id, name, role, active, employmentType, ... })
 * @param {Array}  args.allBillableEntries flat billable entries ({ userId, year, earnings, billableHours, date })
 * @param {object} args.allRates           name → { 'YYYY-MM': { rate } }
 * @param {object} args.allTargets         name → { 'YYYY-MM': { billableHours } }
 * @param {object} args.rateCard           rateCard/all doc ({ levels: [...] })
 * @param {Array}  args.monthlyMetrics     monthlyMetrics entries ({ month, year, firmProfit? })
 * @param {object} args.promoteOverrides   userId → bool; absent = promoted (default on)
 * @param {Date}   args.today              "now" (PST-shifted by the caller)
 * @param {function} args.entryDate        (entry) → Date|null (caller passes dateHelpers.getEntryDate)
 * @returns {Array} row objects consumed directly by the table renderer
 */
export const buildProjectedEarningsRows = ({
  users,
  allBillableEntries,
  allRates,
  allTargets,
  rateCard,
  monthlyMetrics,
  promoteOverrides = {},
  today,
  entryDate,
}) => {
  if (!rateCard || !Array.isArray(rateCard.levels) || rateCard.levels.length === 0) return [];
  if (!users || users.length === 0) return [];

  const levels = [...rateCard.levels].sort((a, b) => a.rank - b.rank);

  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  // Only active attorneys; respect hidden list. Inactive (departed) attorneys
  // are excluded from forward-looking earnings projections.
  const annualProfit = predictedAnnualFirmProfit(monthlyMetrics, currentYear, currentMonth);

  // User ids with at least one YTD billable entry this year — mirrors the
  // namesWithDataInRange escape hatch in useAnalyticsData.js so a mis-set/
  // future activationDate never hides an attorney whose real, already-earned
  // YTD figures should still be aggregated and shown.
  const userIdsWithYtdData = new Set();
  (allBillableEntries || []).forEach((e) => {
    if (e.year === currentYear) userIdsWithYtdData.add(e.userId);
  });

  const attorneys = users.filter((u) => (u.role || 'Attorney') === 'Attorney' && u.active !== false && (hasJoinedBy(u, today) || userIdsWithYtdData.has(u.id)));
  const visibleNames = filterHiddenAttorneys(attorneys.map((u) => u.name || u.id));
  // Firm seniority order; the Full-time / Part-time cards preserve it when
  // they split these rows by employment type.
  const visibleAttorneys = sortBySeniority(
    attorneys.filter((u) => visibleNames.includes(u.name || u.id)),
    (u) => u.name || u.id,
  );

  return visibleAttorneys.map((u) => {
    const name = u.name || u.id;
    const payField = takeHomeField(name);
    // Part-time attorneys don't ride the rate-card ladder: their stored rate
    // is held flat for the whole year (no Q2/Q4 rank bumps, no take-home lookup).
    const isPte = (u.employmentType || 'FTE') === 'PTE';
    const promoted = promoteOverrides[u.id] !== false;

    // YTD actual earnings + per-month actuals (for current-month partial blend).
    let ytdEarnings = 0;
    let ytdHours = 0;
    const monthlyActualHours = {};
    (allBillableEntries || []).forEach((e) => {
      if (e.userId !== u.id) return;
      if (e.year !== currentYear) return;
      const d = entryDate(e);
      if (!d || isNaN(d.getTime())) return;
      if (d > today) return;
      const m = d.getMonth() + 1;
      ytdEarnings += e.earnings || 0;
      ytdHours += e.billableHours || 0;
      monthlyActualHours[m] = (monthlyActualHours[m] || 0) + (e.billableHours || 0);
    });

    const latest = findLatestRate(allRates?.[name]);
    const startRank = latest ? findRankForRate(levels, latest.rate, 'clientRate') : -1;
    // PTE rates are flat and don't need a rate-card match — the stored rate is
    // paid directly, so the "No rank match" warning never applies to them.
    const hasRankMatch = isPte ? true : startRank !== -1;
    const currentRate = latest?.rate || 0;

    // Project remaining months (current → Dec).
    let projectedEarnings = 0;
    let projectedHours = 0;
    let endRank = startRank;

    for (let m = currentMonth; m <= 12; m += 1) {
      const targets = allTargets?.[name]?.[monthKey(currentYear, m)];
      const targetHours = targets?.billableHours || 0;
      if (!targetHours) continue;

      let monthRate;
      let rank;
      if (isPte) {
        // Flat stored rate, every month, no rank progression.
        monthRate = currentRate;
      } else if (hasRankMatch) {
        // Held at current rank when promotion is toggled off.
        rank = promoted ? predictedRankForMonth(startRank, currentMonth, m) : startRank;
        endRank = Math.max(endRank, rank);
        // Take-home payout for the predicted rank; colinRate is null below
        // rank 13, so fall back to the standard attorneyRate there.
        monthRate = Number(levels[rank]?.[payField]) || Number(levels[rank]?.attorneyRate) || 0;
      } else {
        // No rank match — currentRate is a client rate, so paying it out
        // would overstate take-home. Project $0 and surface the badge.
        monthRate = 0;
      }

      let hoursToProject = targetHours;
      if (m === currentMonth) {
        const actualThisMonth = monthlyActualHours[m] || 0;
        hoursToProject = Math.max(0, targetHours - actualThisMonth);
      }

      projectedEarnings += hoursToProject * monthRate;
      projectedHours += hoursToProject;
    }

    const startLevel = (!isPte && hasRankMatch) ? levels[startRank] : null;
    const endLevel = (!isPte && hasRankMatch) ? levels[endRank] : null;

    // Partner profit share — added on top of the labor projection.
    const sharePct = partnerSharePct(name);
    const isPartner = sharePct > 0;
    const profitShare = annualProfit * sharePct;

    return {
      userId: u.id,
      name,
      isColin: isColin(name),
      isPte,
      promoted,
      // Promotion only matters for FTE attorneys with a rate-card match.
      canPromote: !isPte && hasRankMatch,
      currentRate,
      hasRankMatch,
      startLevelLabel: startLevel ? `${startLevel.level}/${startLevel.tier}` : '—',
      endLevelLabel: endLevel ? `${endLevel.level}/${endLevel.tier}` : '—',
      ytdEarnings,
      ytdHours,
      projectedEarnings,
      projectedHours,
      isPartner,
      profitShare,
      // Full-year projection: actual YTD earnings + projected remainder + partner profit share.
      totalProjectedEarnings: ytdEarnings + projectedEarnings + profitShare,
    };
  });
};
