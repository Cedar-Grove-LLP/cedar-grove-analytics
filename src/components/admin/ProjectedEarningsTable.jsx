"use client";

import { useMemo } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { getEntryDate } from '@/utils/dateHelpers';
import { formatCurrency, formatHours } from '@/utils/formatters';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys';

const MAX_RANK = 19;
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const isColin = (name) => /colin\s+van\s+loon/i.test(name || '');
const rateField = (name) => (isColin(name) ? 'colinRate' : 'clientRate');

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

const ProjectedEarningsTable = () => {
  const {
    users,
    allBillableEntries,
    allRates,
    allTargets,
    rateCard,
    loading,
  } = useFirestoreCache();

  const rows = useMemo(() => {
    if (!rateCard || !Array.isArray(rateCard.levels) || rateCard.levels.length === 0) return [];
    if (!users || users.length === 0) return [];

    const levels = [...rateCard.levels].sort((a, b) => a.rank - b.rank);

    const today = new Date();
    const currentYear = today.getFullYear();
    const currentMonth = today.getMonth() + 1;

    // Only active attorneys; respect hidden list. Inactive (departed) attorneys
    // are excluded from forward-looking earnings projections.
    const attorneys = users.filter((u) => (u.role || 'Attorney') === 'Attorney' && u.active !== false);
    const visibleNames = filterHiddenAttorneys(attorneys.map((u) => u.name || u.id));
    const visibleAttorneys = attorneys
      .filter((u) => visibleNames.includes(u.name || u.id))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));

    return visibleAttorneys.map((u) => {
      const name = u.name || u.id;
      const field = rateField(name);

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
      const startRank = latest ? findRankForRate(levels, latest.rate, field) : -1;
      const hasRankMatch = startRank !== -1;
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
        if (hasRankMatch) {
          rank = predictedRankForMonth(startRank, currentMonth, m);
          endRank = Math.max(endRank, rank);
          monthRate = Number(levels[rank]?.[field]) || Number(levels[rank]?.clientRate) || currentRate;
        } else {
          monthRate = currentRate;
        }

        let hoursToProject = targetHours;
        if (m === currentMonth) {
          const actualThisMonth = monthlyActualHours[m] || 0;
          hoursToProject = Math.max(0, targetHours - actualThisMonth);
        }

        projectedEarnings += hoursToProject * monthRate;
        projectedHours += hoursToProject;
      }

      const startLevel = hasRankMatch ? levels[startRank] : null;
      const endLevel = hasRankMatch ? levels[endRank] : null;

      return {
        userId: u.id,
        name,
        isColin: isColin(name),
        currentRate,
        hasRankMatch,
        startLevelLabel: startLevel ? `${startLevel.level}/${startLevel.tier}` : '—',
        endLevelLabel: endLevel ? `${endLevel.level}/${endLevel.tier}` : '—',
        ytdEarnings,
        ytdHours,
        projectedEarnings,
        projectedHours,
        totalPredicted: ytdEarnings + projectedEarnings,
      };
    });
  }, [users, allBillableEntries, allRates, allTargets, rateCard]);

  const totals = useMemo(() => {
    return rows.reduce(
      (acc, r) => ({
        ytdEarnings: acc.ytdEarnings + r.ytdEarnings,
        ytdHours: acc.ytdHours + r.ytdHours,
        projectedEarnings: acc.projectedEarnings + r.projectedEarnings,
        projectedHours: acc.projectedHours + r.projectedHours,
        totalPredicted: acc.totalPredicted + r.totalPredicted,
      }),
      { ytdEarnings: 0, ytdHours: 0, projectedEarnings: 0, projectedHours: 0, totalPredicted: 0 }
    );
  }, [rows]);

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
          YTD actual earnings plus projection through Dec {currentYear}, using monthly billable
          targets × predicted rate. Rank bumps applied at Apr 1 (Q2) and Oct 1 (Q4). Colin Van
          Loon uses the Colin rate column.
        </p>
        <p className="text-xs text-gray-500 mt-1">
          As of {MONTH_LABELS[currentMonth - 1]} {today.getDate()}, {currentYear}.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead className="bg-cg-green text-white">
            <tr>
              <th className="px-3 py-2 text-left font-semibold">Attorney</th>
              <th className="px-3 py-2 text-right font-semibold">Current Rate</th>
              <th className="px-3 py-2 text-center font-semibold">Level (Now → EOY)</th>
              <th className="px-3 py-2 text-right font-semibold">YTD Hours</th>
              <th className="px-3 py-2 text-right font-semibold">YTD Earnings</th>
              <th className="px-3 py-2 text-right font-semibold">Projected Hours</th>
              <th className="px-3 py-2 text-right font-semibold">Projected Earnings</th>
              <th className="px-3 py-2 text-right font-semibold">Predicted Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-6 text-center text-gray-500">
                  No attorney data available.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.userId} className="hover:bg-gray-50">
                <td className="px-3 py-2 font-medium text-cg-black whitespace-nowrap">
                  {r.name}
                  {r.isColin && (
                    <span className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-cg-green/10 text-cg-green rounded">
                      Colin rate
                    </span>
                  )}
                  {!r.hasRankMatch && (
                    <span
                      className="ml-2 px-1.5 py-0.5 text-[10px] font-semibold bg-yellow-100 text-yellow-800 rounded"
                      title="Stored rate did not match any rate card level — projecting flat current rate, no rank bumps."
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
                <td className="px-3 py-2 text-right text-gray-900">{formatHours(r.ytdHours)}</td>
                <td className="px-3 py-2 text-right text-gray-900">{formatCurrency(r.ytdEarnings)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{formatHours(r.projectedHours)}</td>
                <td className="px-3 py-2 text-right text-gray-700">{formatCurrency(r.projectedEarnings)}</td>
                <td className="px-3 py-2 text-right font-semibold text-cg-black">
                  {formatCurrency(r.totalPredicted)}
                </td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-gray-50 font-semibold">
              <tr>
                <td className="px-3 py-2 text-cg-black">Total</td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2"></td>
                <td className="px-3 py-2 text-right text-cg-black">{formatHours(totals.ytdHours)}</td>
                <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.ytdEarnings)}</td>
                <td className="px-3 py-2 text-right text-cg-black">{formatHours(totals.projectedHours)}</td>
                <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.projectedEarnings)}</td>
                <td className="px-3 py-2 text-right text-cg-black">{formatCurrency(totals.totalPredicted)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
};

export default ProjectedEarningsTable;
