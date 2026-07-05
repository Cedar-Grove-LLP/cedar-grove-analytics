"use client";

import { useMemo, useState } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { getEntryDate, getPSTDate } from '@/utils/dateHelpers';
import { formatCurrency, formatHours } from '@/utils/formatters';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';
import { hasJoinedBy } from '@/utils/userActivation.mjs';
import { CalcTooltip } from '@/components/shared';

const MAX_RANK = 19;
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const isColin = (name) => /colin\s+van\s+loon/i.test(name || '');

// Partners share the predicted firm profit: Sam 95%, Colin 5%. Everyone else 0.
const PARTNER_SHARES = [
  { test: (n) => /sam\s+mcclure/i.test(n || ''), pct: 0.95 },
  { test: (n) => /colin\s+van\s+loon/i.test(n || ''), pct: 0.05 },
];
const partnerSharePct = (name) => PARTNER_SHARES.find((p) => p.test(name))?.pct || 0;

const MONTH_INDEX = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
// Stored rates in users/{id}.rates are CLIENT billing rates, so rank is always
// derived from clientRate. Projection pays out the take-home column instead:
// colinRate for Colin (his bespoke ladder), attorneyRate for everyone else.
const takeHomeField = (name) => (isColin(name) ? 'colinRate' : 'attorneyRate');

const monthKey = (year, month) => `${year}-${String(month).padStart(2, '0')}`;

// Find latest stored rate for an attorney (highest monthKey).
const findLatestRate = (ratesByMonth) => {
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
const findRankForRate = (levels, rate, field) => {
  if (!rate || !Array.isArray(levels)) return -1;
  return levels.findIndex((lvl) => Number(lvl[field]) === Number(rate));
};

// Predicted rank in a given month, with Q2 (Apr) and Q4 (Oct) bumps applied
// only when the boundary lies on or after the current month.
const predictedRankForMonth = (startRank, currentMonth, month) => {
  let rank = startRank;
  if (currentMonth < 4 && month >= 4) rank += 1;
  if (currentMonth < 10 && month >= 10) rank += 1;
  return Math.min(rank, MAX_RANK);
};

const sumTotals = (list) =>
  list.reduce(
    (acc, r) => ({
      ytdEarnings: acc.ytdEarnings + r.ytdEarnings,
      ytdHours: acc.ytdHours + r.ytdHours,
      projectedHours: acc.projectedHours + r.projectedHours,
      profitShare: acc.profitShare + r.profitShare,
      totalProjectedEarnings: acc.totalProjectedEarnings + r.totalProjectedEarnings,
    }),
    { ytdEarnings: 0, ytdHours: 0, projectedHours: 0, profitShare: 0, totalProjectedEarnings: 0 }
  );

// One card (green title bar + table) per employment group, mirroring the
// Targets page's Annual progress layout.
const EarningsCard = ({ title, rows, togglePromote }) => {
  if (rows.length === 0) return null;
  const totals = sumTotals(rows);

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <div className="bg-cg-green text-white px-4 py-3 font-semibold">{title}</div>
      <table className="w-full text-sm border-collapse">
        <thead className="bg-gray-100 text-gray-700">
          <tr>
            <th className="px-3 py-2 text-left font-semibold">Attorney</th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                Current Rate
                <CalcTooltip calcKey="billingRate" position="bottom" />
              </span>
            </th>
            <th className="px-3 py-2 text-center font-semibold">Level (Now → EOY)</th>
            <th className="px-3 py-2 text-center font-semibold">Promote</th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                YTD Client Hours
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                YTD Earnings
                <CalcTooltip calcKey="earnings" position="bottom" />
              </span>
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                Proj. Hours
                <CalcTooltip calcKey="projectedHours" position="bottom" />
              </span>
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                Profit Share
                <CalcTooltip calcKey="partnerProfitShare" position="bottom" align="right" />
              </span>
            </th>
            <th className="px-3 py-2 text-right font-semibold">
              <span className="inline-flex items-center gap-1">
                Proj. Earnings
                <CalcTooltip calcKey="projectedEarnings" position="bottom" align="right" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-200">
          {rows.map((r) => (
            <tr key={r.userId} className="hover:bg-gray-50">
              <td className="px-3 py-2 font-medium text-cg-black whitespace-nowrap">
                {r.name}
                {r.isColin && (
                  <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-cg-green/10 text-cg-green rounded">
                    Colin rate
                  </span>
                )}
                {!r.hasRankMatch && !r.isPte && (
                  <span
                    className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-yellow-100 text-yellow-800 rounded"
                    title="Stored client rate did not match any rate card level — take-home rate unknown, projecting $0."
                  >
                    No rank match
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(r.currentRate)}</td>
              <td className="px-3 py-2 text-center text-gray-700">
                {r.startLevelLabel}
                {r.hasRankMatch && r.startLevelLabel !== r.endLevelLabel && (
                  <> → {r.endLevelLabel}</>
                )}
              </td>
              <td className="px-3 py-2 text-center">
                {r.canPromote ? (
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-cg-green cursor-pointer"
                    checked={r.promoted}
                    onChange={() => togglePromote(r.userId)}
                    title="Toggle Q2/Q4 rank promotions for this attorney"
                  />
                ) : (
                  <span className="text-gray-400">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-right text-gray-900">{formatHours(r.ytdHours)}</td>
              <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(r.ytdEarnings)}</td>
              <td className="px-3 py-2 text-right text-gray-700">{formatHours(r.projectedHours)}</td>
              <td className="px-3 py-2 text-right text-gray-700">
                {r.isPartner ? formatCurrency(r.profitShare) : <span className="text-gray-400">—</span>}
              </td>
              <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(r.totalProjectedEarnings)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="bg-gray-50 font-semibold">
          <tr>
            <td className="px-3 py-2 text-cg-black">Total</td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2"></td>
            <td className="px-3 py-2 text-right text-cg-black">{formatHours(totals.ytdHours)}</td>
            <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.ytdEarnings)}</td>
            <td className="px-3 py-2 text-right text-cg-black">{formatHours(totals.projectedHours)}</td>
            <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.profitShare)}</td>
            <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.totalProjectedEarnings)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
};

const ProjectedEarningsTable = () => {
  const {
    users,
    allBillableEntries,
    allRates,
    allTargets,
    rateCard,
    monthlyMetrics,
    loading,
  } = useFirestoreCache();

  // Per-attorney promotion toggle (userId → bool). Absent = promoted (default on).
  // Unchecking holds the attorney at their current rank for the whole projection.
  const [promoteOverrides, setPromoteOverrides] = useState({});
  const togglePromote = (id) =>
    setPromoteOverrides((prev) => ({ ...prev, [id]: prev[id] === false }));

  const rows = useMemo(() => {
    if (!rateCard || !Array.isArray(rateCard.levels) || rateCard.levels.length === 0) return [];
    if (!users || users.length === 0) return [];

    const levels = [...rateCard.levels].sort((a, b) => a.rank - b.rank);

    const today = getPSTDate();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Only active attorneys; respect hidden list. Inactive (departed) attorneys
    // are excluded from forward-looking earnings projections.
    // Predicted full-year firm profit: average the completed-month firm profit
    // (invoices sheet B16, synced as `firmProfit` on monthlyMetrics) and × 12.
    // "Completed" = months of the current year that have fully ended.
    const completedProfitMonths = (monthlyMetrics || []).filter((e) => {
      const mi = MONTH_INDEX[e.month];
      return Number(e.year) === currentYear && mi && mi < currentMonth && Number.isFinite(e.firmProfit);
    });
    const predictedAnnualProfit = completedProfitMonths.length
      ? (completedProfitMonths.reduce((s, e) => s + Number(e.firmProfit), 0) / completedProfitMonths.length) * 12
      : 0;

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
    // Firm seniority order; the Full-time / Part-time cards below preserve it
    // when they split these rows by employment type.
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
        const d = getEntryDate(e);
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
      const profitShare = predictedAnnualProfit * sharePct;

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
  }, [users, allBillableEntries, allRates, allTargets, rateCard, monthlyMetrics, promoteOverrides]);

  const fteRows = rows.filter((r) => !r.isPte);
  const pteRows = rows.filter((r) => r.isPte);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-cg-green"></div>
      </div>
    );
  }

  if (!rateCard || !Array.isArray(rateCard.levels) || rateCard.levels.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow p-6 text-center text-gray-600">
        Rate card not loaded — cannot project earnings.
      </div>
    );
  }

  const today = new Date();
  const currentYear = today.getFullYear();
  const currentMonth = today.getMonth() + 1;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold text-cg-black">Projected Earnings — {currentYear}</h2>
        <p className="text-sm text-cg-dark">
          YTD actual take-home earnings plus projection through Dec {currentYear}, using monthly
          billable targets × predicted take-home rate. Rank is derived from the client rate; the
          payout uses the rate card&apos;s attorney (take-home) column. Rank bumps applied at
          Apr 1 (Q2) and Oct 1 (Q4). Colin Van Loon uses the Colin rate column.
          Part-time attorneys skip the rate card — their stored rate is held flat all year.
          Partners (Sam McClure 95%, Colin Van Loon 5%) also receive a share of the predicted
          full-year firm profit, added into their Proj. Earnings total.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          As of {MONTH_LABELS[currentMonth - 1]} {today.getDate()}, {currentYear}.
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-6 text-center text-gray-500">
          No attorney data available.
        </div>
      ) : (
        <>
          <EarningsCard title="Full-time" rows={fteRows} togglePromote={togglePromote} />
          <EarningsCard title="Part-time" rows={pteRows} togglePromote={togglePromote} />
        </>
      )}
    </div>
  );
};

export default ProjectedEarningsTable;
