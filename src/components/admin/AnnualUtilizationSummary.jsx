"use client";

import { useMemo } from 'react';
import { formatHours } from '@/utils/formatters';
import {
  ANNUAL_GROUPS,
  computeAnnualProgress,
  monthlyHoursByIndex,
} from '@/utils/annualUtilizationProgress';
import { AnnualProgressBar, AnnualStatusPill, CalcTooltip } from '@/components/shared';

const pctText = (result) =>
  result.percentComplete == null ? '—' : `${Math.round(result.percentComplete * 100)}%`;

const numText = (n, hasTarget = true) => (hasTarget ? `${formatHours(n)}` : '—');

const GroupTable = ({ group, users, matrix, actuals, capacity, isFutureYear }) => {
  const rows = useMemo(
    () =>
      users.map((u) => {
        const monthlyTargets = monthlyHoursByIndex(matrix?.[u.id], group.matrixField);
        const monthlyActuals = monthlyHoursByIndex(actuals?.[u.id], group.actualField);
        const capacityFractions = capacity?.[u.id]?.fractions;
        const result = computeAnnualProgress(monthlyTargets, monthlyActuals, capacityFractions, { isFutureYear });
        return { user: u, result };
      }),
    [users, matrix, actuals, capacity, group, isFutureYear]
  );

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="bg-cg-green text-white px-4 py-3 font-semibold">{group.title}</div>
      <div className="overflow-x-auto">
        <table aria-label={`${group.title} annual utilization progress`} className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-gray-500 border-b border-gray-200">
              <th scope="col" className="px-4 py-2 font-medium">Name</th>
              <th scope="col" className="px-4 py-2 font-medium">Metric</th>
              <th scope="col" className="px-4 py-2 font-medium text-right">
                <span className="inline-flex items-center gap-1">
                  Target
                  <CalcTooltip calcKey="annualTarget" position="bottom" align="center" />
                </span>
              </th>
              <th scope="col" className="px-4 py-2 font-medium text-right">
                <span className="inline-flex items-center gap-1">
                  Actual YTD
                  <CalcTooltip calcKey="annualActualYtd" position="bottom" align="center" />
                </span>
              </th>
              <th scope="col" className="px-4 py-2 font-medium text-right">
                <span className="inline-flex items-center gap-1">
                  Remaining
                  <CalcTooltip calcKey="annualRemaining" position="bottom" align="center" />
                </span>
              </th>
              <th scope="col" className="px-4 py-2 font-medium min-w-[200px]">
                <span className="inline-flex items-center gap-1">
                  % Complete
                  <CalcTooltip calcKey="annualPctComplete" position="bottom" align="center" />
                </span>
              </th>
              <th scope="col" className="px-4 py-2 font-medium">
                <span className="inline-flex items-center gap-1">
                  Pace
                  <CalcTooltip calcKey="annualPaceDelta" position="bottom" align="right" />
                </span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ user, result }) => (
              <tr key={user.id} className="border-b border-gray-100 last:border-0">
                <td className="px-4 py-3 font-medium text-cg-black whitespace-nowrap">{user.name || user.id}</td>
                <td className="px-4 py-3 text-gray-600">{group.metricLabel}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {numText(result.annualTarget, result.hasTarget)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatHours(result.actualYtd)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">
                  {numText(result.remaining, result.hasTarget)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <AnnualProgressBar
                      percentComplete={result.percentComplete}
                      pacePercent={result.pacePercent}
                      status={result.status}
                      paceDeltaHours={result.paceDeltaHours}
                      showPill={false}
                    />
                    <span className="shrink-0 tabular-nums text-gray-700 w-10 text-right">{pctText(result)}</span>
                  </div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <AnnualStatusPill status={result.status} paceDeltaHours={result.paceDeltaHours} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * Annual utilization progress — the at-a-glance block above the monthly target
 * grid on the Targets page. Renders one card per group (Ops, Part-time,
 * Full-time) showing each person's annual target, actual YTD, remaining,
 * % complete (with a capacity-weighted pace marker), and Ahead/Behind status.
 *
 * Targets come from the live editable matrix, so unsaved edits update the
 * summary immediately; actuals + capacity fractions come from
 * useMonthlyActualsVsTarget (computed once by the parent for the selected year).
 */
const AnnualUtilizationSummary = ({ groups, matrix, actuals, capacity, isFutureYear = false }) => {
  const hasAnyUser = ANNUAL_GROUPS.some((g) => (groups?.[g.key] || []).length > 0);
  if (!hasAnyUser) return null;

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold text-cg-black">Annual progress</h3>
        <p className="text-sm text-cg-dark">
          How much of each person&apos;s yearly target is done, what&apos;s left, and whether they&apos;re ahead of or
          behind the pace needed to finish the year on target.
        </p>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-gray-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-6 h-2.5 rounded-full bg-status-success" aria-hidden="true" />
          % of annual target completed (YTD)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block w-0.5 h-3.5 rounded bg-gray-700" aria-hidden="true" />
          <span className="inline-flex items-center gap-1">
            Pace marker = where you should be by today
            <CalcTooltip calcKey="annualPaceMarker" position="bottom" />
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-full font-medium bg-status-success-light text-status-success-text">Ahead</span>
          fill past the marker
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="px-2 py-0.5 rounded-full font-medium bg-status-danger-light text-status-danger-text">Behind</span>
          fill short of the marker
        </span>
      </div>

      {ANNUAL_GROUPS.map((group) => {
        const groupUsers = groups?.[group.key] || [];
        if (groupUsers.length === 0) return null;
        return (
          <GroupTable
            key={group.key}
            group={group}
            users={groupUsers}
            matrix={matrix}
            actuals={actuals}
            capacity={capacity}
            isFutureYear={isFutureYear}
          />
        );
      })}
    </div>
  );
};

export default AnnualUtilizationSummary;
