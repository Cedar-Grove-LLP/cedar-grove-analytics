"use client";

import { useMemo, useState } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { getEntryDate, getPSTDate } from '@/utils/dateHelpers';
import { formatCurrency, formatHours } from '@/utils/formatters';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';
import { hasJoinedBy } from '@/utils/userActivation.mjs';
import { buildProjectedRow, predictedAnnualProfit, sumTotals } from '@/utils/projectedEarnings.mjs';
import { CalcTooltip } from '@/components/shared';

const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// One card (green title bar + table) per employment group, mirroring the
// Targets page's Annual progress layout.
const EarningsCard = ({ title, rows, togglePromote }) => {
  if (rows.length === 0) return null;
  const totals = sumTotals(rows);

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <div className="bg-cg-green text-white px-4 py-3 font-semibold">{title}</div>
      <table aria-label={`${title} projected earnings`} className="w-full min-w-[1180px] table-fixed text-xs border-collapse [&_th]:!px-2 [&_td]:!px-2">
        {/* Both employment groups use the same column grid. Without explicit
            widths, each table sizes itself from its own currency values, so
            the Full-time headers wrap while the shorter Part-time values do
            not. Narrow viewports scroll horizontally instead of reflowing. */}
        <colgroup>
          <col className="w-[12%]" />
          <col className="w-[8%]" />
          <col className="w-[10%]" />
          <col className="w-[6%]" />
          <col className="w-[10%]" />
          <col className="w-[9%]" />
          <col className="w-[10%]" />
          <col className="w-[12%]" />
          <col className="w-[11%]" />
          <col className="w-[12%]" />
        </colgroup>
        <thead className="bg-gray-100 text-gray-700">
          <tr>
            <th scope="col" className="px-3 py-2 text-left font-semibold whitespace-nowrap">Attorney</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Current Rate
                <CalcTooltip calcKey="billingRate" position="bottom" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-center font-semibold whitespace-nowrap">Level (Now → EOY)</th>
            <th scope="col" className="px-3 py-2 text-center font-semibold whitespace-nowrap">Promote</th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                YTD Client Hours
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                YTD $
                <CalcTooltip calcKey="earnings" position="bottom" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Proj. Client Hours
                <CalcTooltip calcKey="projectedHours" position="bottom" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Proj. Client $
                <CalcTooltip calcKey="projectedEarnings" position="bottom" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Proj. Profit Share
                <CalcTooltip calcKey="partnerProfitShare" position="bottom" align="right" />
              </span>
            </th>
            <th scope="col" className="px-3 py-2 text-right font-semibold whitespace-nowrap">
              <span className="inline-flex items-center gap-1 whitespace-nowrap">
                Proj. Total
                <CalcTooltip calcKey="projectedEarningsTotal" position="bottom" align="right" />
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
                    aria-label={`Promote ${r.name}`}
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
              <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(r.projectedEarnings)}</td>
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
            <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.projectedEarnings)}</td>
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
    const annualProfit = predictedAnnualProfit(monthlyMetrics, currentMonth, currentYear);

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

    return visibleAttorneys.map((u) => buildProjectedRow({
      user: u,
      levels,
      allBillableEntries,
      allRates,
      allTargets,
      today,
      currentMonth,
      currentYear,
      promoted: promoteOverrides[u.id] !== false,
      annualProfit,
      getEntryDate,
    }));
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
          full-year firm profit, added into their Proj. Total.
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
