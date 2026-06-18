"use client";

import { useMemo, useState } from 'react';
import { Activity, Clock, Users, DollarSign, AlertTriangle } from 'lucide-react';
import { formatCurrency, formatHours, formatTimeOffContext } from '../../utils/formatters';
import { filterByCohort, deriveTransactionTotals } from '../../utils/cohortFilter.mjs';
import { DateRangeIndicator, CalcTooltip } from '../shared';
import { TopTransactionsChart, BillableVsOpsChart } from '../charts';

const COHORT_OPTIONS = [
  { value: 'fte-lawyers', label: 'FTE Lawyers' },
  { value: 'pte-lawyers', label: 'PTE Lawyers' },
  { value: 'lawyers', label: 'All Lawyers' },
  { value: 'full-team', label: 'Full Team' },
];

const COHORT_LABELS = {
  'fte-lawyers': 'FTE lawyers',
  'pte-lawyers': 'PTE lawyers',
  'lawyers': 'all lawyers',
  'full-team': 'full team',
};

// Header row shared by the five inline KPI cards below (kept local — these
// cards predate the shared KPICard and keep their own colors/layout).
const KpiTitle = ({ label, calcKey, icon }) => (
  <div className="flex items-center justify-between mb-1">
    <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
      {label}
      <CalcTooltip calcKey={calcKey} position="bottom" />
    </span>
    {icon}
  </div>
);

const OverviewView = ({
  dateRangeLabel,
  filteredEntriesCount,
  globalAttorneyFilter,
  allAttorneyNames,
  periodRevenueAccrued = null,
  periodAttorneyBillables = null,
  attorneyData,
  transactionMemberData,
  missingRateWarnings = [],
  isAdmin = false,
}) => {
  const [cohort, setCohort] = useState('lawyers');

  const cohortAttorneyData = useMemo(
    () => filterByCohort(attorneyData || [], cohort),
    [attorneyData, cohort]
  );

  // Cohort-scoped transaction totals for the chart. Every cohort (full-team
  // included) derives from the same per-member dataset, which keeps hidden
  // attorneys in the aggregates, honors the transaction attorney filter, and
  // includes Adjustment categories — so cohort charts compose to the
  // full-team totals.
  const cohortTransactionData = useMemo(
    () => deriveTransactionTotals(filterByCohort(transactionMemberData || [], cohort)),
    [transactionMemberData, cohort]
  );

  const cohortMetrics = useMemo(() => {
    const subset = cohortAttorneyData;

    const billable = subset.reduce((acc, a) => acc + (a.billable || 0), 0);
    const ops = subset.reduce((acc, a) => acc + (a.ops || 0), 0);
    const billableTarget = subset.reduce((acc, a) => acc + (a.billableTarget || 0), 0);
    const opsTarget = subset.reduce((acc, a) => acc + (a.opsTarget || 0), 0);
    const grossBillablesSum = subset.reduce((acc, a) => acc + (a.grossBillables || 0), 0);
    // Σ of Sam McClure's manual month-end bill adjustments across the cohort
    // (already folded into each member's earnings; surfaced here for visibility,
    // NOT added into Total Billables, which is rate × hours / the sheet figure).
    const adjustmentSum = subset.reduce((acc, a) => acc + (a.adjustment || 0), 0);
    // Show the Adjustments card whenever any cohort member has an adjustment
    // entry (matches the detail pages, which also show it on a net-zero amount).
    const hasAdjustment = subset.some((a) => a.hasAdjustment);
    // Cohort-wide out-of-office / holiday context — the pace targets above are
    // already reduced for each member's OOO (capacity model); this drives a tooltip.
    const oooDays = subset.reduce((acc, a) => acc + (a.oooDays || 0), 0);
    const holidayDays = subset.reduce((acc, a) => acc + (a.holidayDays || 0), 0);
    // "Total Billables" source. Full Team prefers the firm-wide sheet figures —
    // Attorney Billables first (the authoritative billed amount), then Revenue
    // Accrued — and otherwise falls back to rate × hours. Sub-cohorts always use
    // rate × hours, since the sheet figures aren't broken out per person/cohort.
    // periodAttorneyBillables / periodRevenueAccrued are non-null only for
    // month-aligned ranges (a month in progress or completed months); custom or
    // partial ranges leave them null, so those fall back to rate × hours.
    const isFullTeam = cohort === 'full-team';
    let grossBillables;
    let billablesLabel;
    let billablesSubtitle;
    let billablesCalcKey;
    if (isFullTeam && periodAttorneyBillables != null) {
      grossBillables = periodAttorneyBillables;
      billablesLabel = 'Total Billables';
      billablesSubtitle = 'Firm-wide';
      billablesCalcKey = 'totalBillablesAttorney';
    } else if (isFullTeam && periodRevenueAccrued != null) {
      grossBillables = periodRevenueAccrued;
      billablesLabel = 'Revenue Accrued';
      billablesSubtitle = 'Firm-wide';
      billablesCalcKey = 'totalBillablesRevenueAccrued';
    } else {
      grossBillables = grossBillablesSum;
      billablesLabel = 'Total Billables';
      billablesSubtitle = 'Rate × Hours';
      billablesCalcKey = 'totalBillablesRateTimesHours';
    }

    // Exclude members with no target this period (fully out of office) so their
    // N/A doesn't drag the cohort average — matches calculateUtilization/avgOf.
    const utilizationValues = subset
      .filter((a) => (a.target || 0) > 0)
      .map((a) => (((a.billable || 0) + (a.ops || 0)) / a.target) * 100);
    const utilization = utilizationValues.length > 0
      ? Math.round(utilizationValues.reduce((acc, v) => acc + v, 0) / utilizationValues.length)
      : 0;

    return {
      billable,
      ops,
      billableTarget,
      opsTarget,
      grossBillables,
      adjustmentSum,
      hasAdjustment,
      billablesLabel,
      billablesSubtitle,
      billablesCalcKey,
      utilization,
      oooDays,
      holidayDays,
      attorneyCount: subset.length,
    };
  }, [cohort, cohortAttorneyData, periodRevenueAccrued, periodAttorneyBillables]);

  // Tooltip explaining the OOO/holiday adjustment behind the pace figures.
  const paceAdjustmentTitle = (cohortMetrics.oooDays > 0 || cohortMetrics.holidayDays > 0)
    ? `Pace targets reflect ${formatTimeOffContext(cohortMetrics.oooDays, cohortMetrics.holidayDays)} across the cohort this period`
    : undefined;

  const totalHours = cohortMetrics.billable + cohortMetrics.ops;
  const billablePercentage = totalHours > 0 ? Math.round((cohortMetrics.billable / totalHours) * 100) : 0;
  const opsPercentage = totalHours > 0 ? Math.round((cohortMetrics.ops / totalHours) * 100) : 0;
  const billableProgress = cohortMetrics.billableTarget > 0
    ? Math.round((cohortMetrics.billable / cohortMetrics.billableTarget) * 100)
    : 0;
  const opsProgress = cohortMetrics.opsTarget > 0
    ? Math.round((cohortMetrics.ops / cohortMetrics.opsTarget) * 100)
    : 0;
  const cohortLabel = COHORT_LABELS[cohort] || 'team';
  const memberNoun = cohort === 'full-team' ? 'members' : 'lawyers';

  return (
    <div className="space-y-6">
      <DateRangeIndicator 
        dateRangeLabel={dateRangeLabel}
        entryCount={filteredEntriesCount}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      {/* Cohort toggle */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">
          Viewing: <span className="font-medium text-gray-900">{cohortLabel}</span>
          <span className="text-gray-500"> ({cohortMetrics.attorneyCount})</span>
        </div>
        <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
          {COHORT_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setCohort(opt.value)}
              className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                cohort === opt.value
                  ? 'bg-cg-green text-white'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Missing billing rates make rate × hours figures silently understate —
          surface them to admins instead (same amber styling as dataWarnings). */}
      {isAdmin && missingRateWarnings.length > 0 && (
        <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600" />
            <span>
              {missingRateWarnings.length} attorney{missingRateWarnings.length === 1 ? ' has' : 's have'} no
              billing rate for months in this range —{' '}
              {cohortMetrics.billablesCalcKey === 'totalBillablesRateTimesHours'
                // Only the rate × hours figure is understated; the firm-wide
                // sheet figures shown for month-aligned Full Team ranges are
                // synced literals and unaffected.
                ? 'Total Billables is understated.'
                : 'rate × hours figures (sub-cohorts, custom ranges, detail pages) bill those hours at $0.'}
            </span>
          </div>
          <ul className="mt-2 ml-7 text-sm space-y-0.5">
            {missingRateWarnings.map((warning) => (
              <li key={warning.userName}>
                <span className="font-medium">{warning.userName}</span>
                {': '}{warning.monthKeys.join(', ')}
                {` (${formatHours(warning.hours)}h unbilled at $0)`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* KPI Cards - keeping original colors */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <KpiTitle label="Avg Utilization" calcKey="utilizationPct" icon={<Activity className="w-5 h-5 text-blue-500" />} />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{cohortMetrics.utilization}%</div>
          </div>
          <div className="text-sm text-gray-600 text-center">
            {cohortMetrics.attorneyCount} {memberNoun}
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <KpiTitle label="Time Split" calcKey="timeSplitPct" icon={<Clock className="w-5 h-5 text-purple-500" />} />
          <div className="flex-1 flex items-center justify-center">
            <div className="flex items-baseline gap-1.5">
              <div className="text-3xl font-bold text-gray-600">{billablePercentage}%</div>
              <div className="text-xl text-gray-400">/</div>
              <div className="text-3xl font-bold text-green-600">{opsPercentage}%</div>
            </div>
          </div>
          <div className="text-sm text-gray-600 text-center">Billable / Ops</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <KpiTitle label="Total Billable" calcKey="billableHours" icon={<Clock className="w-5 h-5 text-green-500" />} />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatHours(cohortMetrics.billable)}h</div>
          </div>
          <div className="text-sm text-gray-600 text-center">
            <CalcTooltip calcKey="pacePct" dynamic={{ context: paceAdjustmentTitle }} variant="underline">
              {billableProgress}% current pace
            </CalcTooltip>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <KpiTitle label="Total Ops" calcKey="opsHours" icon={<Users className="w-5 h-5 text-orange-500" />} />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatHours(cohortMetrics.ops)}h</div>
          </div>
          <div className="text-sm text-gray-600 text-center">
            <CalcTooltip calcKey="pacePct" dynamic={{ context: paceAdjustmentTitle }} variant="underline">
              {opsProgress}% current pace
            </CalcTooltip>
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <KpiTitle
            label={cohortMetrics.billablesLabel}
            calcKey={cohortMetrics.billablesCalcKey}
            icon={<DollarSign className="w-5 h-5 text-emerald-500" />}
          />
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatCurrency(cohortMetrics.grossBillables)}</div>
          </div>
          <div className="text-sm text-gray-600 text-center">{cohortMetrics.billablesSubtitle}</div>
        </div>

        {cohortMetrics.hasAdjustment && (
          <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
            <KpiTitle label="Adjustments" calcKey="adjustment" icon={<DollarSign className="w-5 h-5 text-amber-500" />} />
            <div className="flex-1 flex items-center justify-center">
              <div className={`text-3xl font-bold ${cohortMetrics.adjustmentSum < 0 ? 'text-red-600' : 'text-gray-900'}`}>{formatCurrency(cohortMetrics.adjustmentSum)}</div>
            </div>
            <div className="text-sm text-gray-600 text-center">Included in earnings</div>
          </div>
        )}
      </div>

      {/* Billable vs Ops Time by Attorney */}
      <BillableVsOpsChart
        data={cohortAttorneyData}
        title={`Billable vs Ops Time by Attorney - ${dateRangeLabel}`}
      />

      {/* Top Transactions */}
      <TopTransactionsChart
        data={cohortTransactionData}
        title={`Top Transaction Types by Time - ${dateRangeLabel}`}
      />
    </div>
  );
};

export default OverviewView;