"use client";

import { useMemo, useState } from 'react';
import { Activity, Clock, Users, DollarSign } from 'lucide-react';
import { formatCurrency, formatHours, formatTimeOffContext } from '../../utils/formatters';
import { DateRangeIndicator } from '../shared';
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

const isLawyer = (member) => (member.role || 'Attorney') === 'Attorney';

const filterByCohort = (members, cohort) => {
  switch (cohort) {
    case 'fte-lawyers':
      return members.filter((m) => isLawyer(m) && m.employmentType === 'FTE');
    case 'pte-lawyers':
      return members.filter((m) => isLawyer(m) && m.employmentType === 'PTE');
    case 'lawyers':
      return members.filter(isLawyer);
    case 'full-team':
    default:
      return members;
  }
};

const OverviewView = ({
  dateRangeLabel,
  filteredEntriesCount,
  globalAttorneyFilter,
  allAttorneyNames,
  periodRevenueAccrued = null,
  periodAttorneyBillables = null,
  attorneyData,
  transactionData,
}) => {
  const [cohort, setCohort] = useState('lawyers');

  const cohortMetrics = useMemo(() => {
    const subset = filterByCohort(attorneyData || [], cohort);

    const billable = subset.reduce((acc, a) => acc + (a.billable || 0), 0);
    const ops = subset.reduce((acc, a) => acc + (a.ops || 0), 0);
    const billableTarget = subset.reduce((acc, a) => acc + (a.billableTarget || 0), 0);
    const opsTarget = subset.reduce((acc, a) => acc + (a.opsTarget || 0), 0);
    const grossBillablesSum = subset.reduce((acc, a) => acc + (a.grossBillables || 0), 0);
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
    if (isFullTeam && periodAttorneyBillables != null) {
      grossBillables = periodAttorneyBillables;
      billablesLabel = 'Total Billables';
      billablesSubtitle = 'Firm-wide';
    } else if (isFullTeam && periodRevenueAccrued != null) {
      grossBillables = periodRevenueAccrued;
      billablesLabel = 'Revenue Accrued';
      billablesSubtitle = 'Firm-wide';
    } else {
      grossBillables = grossBillablesSum;
      billablesLabel = 'Total Billables';
      billablesSubtitle = 'Rate × Hours';
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
      billablesLabel,
      billablesSubtitle,
      utilization,
      oooDays,
      holidayDays,
      attorneyCount: subset.length,
    };
  }, [cohort, attorneyData, periodRevenueAccrued, periodAttorneyBillables]);

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

      {/* KPI Cards - keeping original colors */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">Avg Utilization</span>
            <Activity className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{cohortMetrics.utilization}%</div>
          </div>
          <div className="text-sm text-gray-600 text-center">
            {cohortMetrics.attorneyCount} {memberNoun}
          </div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">Time Split</span>
            <Clock className="w-5 h-5 text-purple-500" />
          </div>
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
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">Total Billable</span>
            <Clock className="w-5 h-5 text-green-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatHours(cohortMetrics.billable)}h</div>
          </div>
          <div
            className={`text-sm text-gray-600 text-center${paceAdjustmentTitle ? ' underline decoration-dotted decoration-gray-300 cursor-help' : ''}`}
            title={paceAdjustmentTitle}
          >{billableProgress}% current pace</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">Total Ops</span>
            <Users className="w-5 h-5 text-orange-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatHours(cohortMetrics.ops)}h</div>
          </div>
          <div
            className={`text-sm text-gray-600 text-center${paceAdjustmentTitle ? ' underline decoration-dotted decoration-gray-300 cursor-help' : ''}`}
            title={paceAdjustmentTitle}
          >{opsProgress}% current pace</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">{cohortMetrics.billablesLabel}</span>
            <DollarSign className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatCurrency(cohortMetrics.grossBillables)}</div>
          </div>
          <div className="text-sm text-gray-600 text-center">{cohortMetrics.billablesSubtitle}</div>
        </div>
      </div>

      {/* Billable vs Ops Time by Attorney */}
      <BillableVsOpsChart 
        data={attorneyData}
        title={`Billable vs Ops Time by Attorney - ${dateRangeLabel}`}
      />

      {/* Top Transactions */}
      <TopTransactionsChart 
        data={transactionData} 
        title={`Top Transaction Types by Time - ${dateRangeLabel}`}
      />
    </div>
  );
};

export default OverviewView;