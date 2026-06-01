"use client";

import { useMemo, useState } from 'react';
import { Activity, Clock, Users, DollarSign } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/formatters';
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
  attorneyData,
  transactionData,
}) => {
  const [cohort, setCohort] = useState('lawyers');
  const showRevenueAccrued = cohort === 'full-team' && periodRevenueAccrued != null;

  const cohortMetrics = useMemo(() => {
    const subset = filterByCohort(attorneyData || [], cohort);

    const billable = subset.reduce((acc, a) => acc + (a.billable || 0), 0);
    const ops = subset.reduce((acc, a) => acc + (a.ops || 0), 0);
    const billableTarget = subset.reduce((acc, a) => acc + (a.billableTarget || 0), 0);
    const opsTarget = subset.reduce((acc, a) => acc + (a.opsTarget || 0), 0);
    const grossBillablesSum = subset.reduce((acc, a) => acc + (a.grossBillables || 0), 0);
    const grossBillables = cohort === 'full-team' && periodRevenueAccrued != null
      ? periodRevenueAccrued
      : grossBillablesSum;

    const utilizationValues = subset.map((a) => {
      const total = (a.billable || 0) + (a.ops || 0);
      const target = a.target || 0;
      return target > 0 ? (total / target) * 100 : 0;
    });
    const utilization = utilizationValues.length > 0
      ? Math.round(utilizationValues.reduce((acc, v) => acc + v, 0) / utilizationValues.length)
      : 0;

    return {
      billable,
      ops,
      billableTarget,
      opsTarget,
      grossBillables,
      utilization,
      attorneyCount: subset.length,
    };
  }, [cohort, attorneyData, periodRevenueAccrued]);

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
          <div className="text-sm text-gray-600 text-center">{billableProgress}% current pace</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">Total Ops</span>
            <Users className="w-5 h-5 text-orange-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatHours(cohortMetrics.ops)}h</div>
          </div>
          <div className="text-sm text-gray-600 text-center">{opsProgress}% current pace</div>
        </div>

        <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
          <div className="flex items-center justify-between mb-1">
            <span className="text-gray-600 text-sm font-medium">{showRevenueAccrued ? 'Revenue Accrued' : 'Total Billables'}</span>
            <DollarSign className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="flex-1 flex items-center justify-center">
            <div className="text-3xl font-bold text-gray-900">{formatCurrency(cohortMetrics.grossBillables)}</div>
          </div>
          <div className="text-sm text-gray-600 text-center">{showRevenueAccrued ? 'Firm-wide' : 'Rate × Hours'}</div>
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