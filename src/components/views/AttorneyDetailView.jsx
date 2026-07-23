"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  User,
  Clock,
  DollarSign,
  Users,
  Briefcase,
  Calendar,
  Target,
  TrendingUp,
  TrendingDown,
  FileText,
  Building2,
  AlertTriangle
} from 'lucide-react';
import { 
  BarChart, 
  Bar, 
  LineChart, 
  Line, 
  PieChart, 
  Pie, 
  Cell,
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer 
} from 'recharts';
import { useUserBillableEntries, useUserOpsEntries, useUsers, useDataWarnings } from '@/hooks/useFirestoreData';
import { useMonthlyActualsVsTarget } from '@/hooks/useMonthlyActualsVsTarget';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import {
  calculateDateRange,
  getEntryDate,
  getPSTDate,
  getDateRangeLabel,
} from '@/utils/dateHelpers';
import {
  buildClientBreakdown,
  buildMatterBreakdown,
  buildMonthlyTrend,
  buildOpsBreakdown,
  buildTransactionBreakdown,
  collectActiveMonths,
  computeAttorneyDetailStats,
  computeAttorneyDetailTargets,
  filterEntriesByWindow,
  hasAdjustmentData,
  selectRecentEntries,
} from '@/utils/attorneyDetail.mjs';
import {
  parseTimeOff,
  getHolidaySet,
  getOooMapFor,
  proRateMonth,
} from '@/utils/timeOff';
import {
  annualGroupForUser,
  computeAnnualProgress,
  monthlyHoursFromTargetMap,
  monthlyHoursByIndex,
} from '@/utils/annualUtilizationProgress';
import { formatCurrency, formatHours, formatDate, formatTimeOffContext } from '@/utils/formatters';
import { CHART_COLORS, CHART, GRAY, LABEL_LINE_COLOR } from '@/utils/colors';
import { getUtilizationColor, getUtilizationBgColor, getProgressBarColor } from '@/utils/statusStyles';
import { DateRangeDropdown, CalcTooltip, AnnualProgressBar } from '@/components/shared';

// Custom tooltip for charts - defined outside component to prevent re-creation on render
const CustomChartTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-1">{label}</p>
        {payload.map((entry, index) => (
          <p key={index} style={{ color: entry.color }} className="text-sm">
            {entry.name}: {entry.name.toLowerCase().includes('earning') 
              ? formatCurrency(entry.value) 
              : `${formatHours(entry.value)}h`}
          </p>
        ))}
      </div>
    );
  }
  return null;
};

// Pie chart label renderer - defined outside component
const renderPieLabel = ({ cx, cy, midAngle, outerRadius, percent, hours }) => {
  if (percent < 0.05) return null;
  const RADIAN = Math.PI / 180;
  const radius = outerRadius * 1.2;
  const x = cx + radius * Math.cos(-midAngle * RADIAN);
  const y = cy + radius * Math.sin(-midAngle * RADIAN);

  return (
    <text 
      x={x} 
      y={y} 
      fill={GRAY[700]}
      textAnchor={x > cx ? 'start' : 'end'} 
      dominantBaseline="central"
      fontSize={12}
    >
      {`${formatHours(hours)}h`}
    </text>
  );
};

// One labelled stat (with calc tooltip) inside the compact annual card. Hoisted
// to module scope so it isn't re-created on every AnnualProgressCompact render.
const AnnualStat = ({ label, calcKey, value }) => (
  <div>
    <div className="text-xs text-gray-500 inline-flex items-center gap-1">
      {label}
      <CalcTooltip calcKey={calcKey} position="bottom" />
    </div>
    <div className="text-2xl font-bold text-cg-black">{value}</div>
  </div>
);

// Compact single-person annual progress card — mirrors the Targets-page summary
// for one member (same capacity-weighted pacing). Shows aggregate pace only; no
// per-event OOO details are surfaced, so it is safe on a non-admin's own page.
const AnnualProgressCompact = ({ year, group, result }) => {
  return (
    <div className="bg-white rounded-lg shadow p-6">
      <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <TrendingUp className="w-5 h-5 text-blue-600" />
        {year} Annual Progress
        <span className="text-sm font-normal text-gray-500">· {group.metricLabel} hours</span>
      </h3>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <AnnualStat label="Annual Target" calcKey="annualTarget" value={result.hasTarget ? `${formatHours(result.annualTarget)}h` : '—'} />
        <AnnualStat label="Actual YTD" calcKey="annualActualYtd" value={`${formatHours(result.actualYtd)}h`} />
        <AnnualStat label="Remaining" calcKey="annualRemaining" value={result.hasTarget ? `${formatHours(result.remaining)}h` : '—'} />
        <AnnualStat label="% Complete" calcKey="annualPctComplete" value={result.percentComplete == null ? '—' : `${Math.round(result.percentComplete * 100)}%`} />
      </div>
      <AnnualProgressBar
        percentComplete={result.percentComplete}
        pacePercent={result.pacePercent}
        status={result.status}
        paceDeltaHours={result.paceDeltaHours}
        barClassName="h-3"
      />
      <p className="text-xs text-gray-600 mt-3 flex items-center gap-x-3 gap-y-1 flex-wrap">
        <span className="inline-flex items-center gap-1">
          Pace marker shows where you should be by today
          <CalcTooltip calcKey="annualPaceMarker" position="bottom" />
        </span>
        <span className="inline-flex items-center gap-1">
          Ahead / Behind status
          <CalcTooltip calcKey="annualPaceDelta" position="bottom" />
        </span>
      </p>
    </div>
  );
};

const AttorneyDetailView = ({ attorneyName }) => {
  const router = useRouter();
  const { data: billableEntries, loading: billableLoading, error: billableError } = useUserBillableEntries(attorneyName);
  const { data: opsEntries, loading: opsLoading, error: opsError } = useUserOpsEntries(attorneyName);
  const { users } = useUsers();
  const { allTargets, timeOff } = useFirestoreCache();
  const dataWarnings = useDataWarnings();

  // Parse OOO + firm holidays once (memoized on the raw doc).
  const parsedTimeOff = useMemo(() => parseTimeOff(timeOff), [timeOff]);

  // Date range state
  const [dateRange, setDateRange] = useState('all-time');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Attorney targets from shared cache
  const attorneyTargets = useMemo(() => allTargets[attorneyName] || {}, [allTargets, attorneyName]);

  // The full user record for this person (role, email, employment type).
  const currentUser = useMemo(
    () => users.find(u => (u.name || u.id) === attorneyName || u.id === attorneyName) || null,
    [users, attorneyName]
  );
  const personRole = currentUser?.role || 'Attorney';
  // Email for joining out-of-office data (exact normalized match in the calendar)
  const attorneyEmail = currentUser?.email || '';
  // activationDate is "YYYY-MM" (month precision — no partial-month proration
  // exists anywhere in the app, so day-of-month isn't tracked). Floor the
  // custom date-range picker's minDate at the 1st of that month.
  const activationDate = currentUser?.activationDate || null;
  const activationMonthStart = activationDate ? activationDate + '-01' : null;
  const activationDateLabel = activationMonthStart ? new Date(activationMonthStart + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : null;

  const loading = billableLoading || opsLoading;
  const error = billableError || opsError;

  // Calculate date range boundaries (shared calculateDateRange, with one
  // page-specific override: this view treats unbounded selections — all-time,
  // and custom before both dates are picked — as "no filter" (null startDate),
  // where the shared helper substitutes a first-of-month start instead.
  const dateRangeInfo = useMemo(() => {
    const now = getPSTDate();
    const { startDate: boundedStart, endDate } = calculateDateRange(dateRange, customDateStart, customDateEnd, [], now);
    const unbounded = dateRange === 'all-time' ||
      (dateRange === 'custom' && !(customDateStart && customDateEnd));
    const startDate = unbounded ? null : boundedStart;

    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return { startDate, endDate, currentMonthKey, now };
  }, [dateRange, customDateStart, customDateEnd]);

  // Filter billable entries by date range
  const filteredBillableEntries = useMemo(
    () => filterEntriesByWindow(billableEntries, dateRangeInfo.startDate, dateRangeInfo.endDate),
    [billableEntries, dateRangeInfo]
  );

  // Filter ops entries by date range
  const filteredOpsEntries = useMemo(
    () => filterEntriesByWindow(opsEntries, dateRangeInfo.startDate, dateRangeInfo.endDate),
    [opsEntries, dateRangeInfo]
  );

  // Combined entries reference (used for active months, targets, etc.)
  const attorneyEntries = useMemo(() => {
    return [...filteredBillableEntries, ...filteredOpsEntries];
  }, [filteredBillableEntries, filteredOpsEntries]);

  // Calculate targets based on active months
  const calculatedTargets = useMemo(() => {
    const { startDate, endDate, currentMonthKey } = dateRangeInfo;

    const activeMonths = collectActiveMonths(attorneyEntries);

    // Firm holidays for the range + this attorney's out-of-office days.
    // Only needed when there are active months to pro-rate (getMonthProRate
    // is never invoked otherwise).
    const hasMonths = activeMonths.size > 0;
    const rangeHolidaySet = hasMonths ? getHolidaySet(parsedTimeOff, startDate, endDate) : null;
    const oooMap = hasMonths ? getOooMapFor(parsedTimeOff, { name: attorneyName, email: attorneyEmail }) : null;

    return computeAttorneyDetailTargets({
      activeMonths,
      monthTargets: attorneyTargets,
      currentMonthKey,
      // Capacity-model fraction — the attorney's OOO reduces the target for any
      // period (in-progress or completed); firm holidays only affect intra-month
      // pace (they cancel for a full month, leaving a full clean month at 1).
      getMonthProRate: (monthKey, year, month) =>
        proRateMonth(year, month, dateRangeInfo, rangeHolidaySet, oooMap),
    });
  }, [attorneyEntries, attorneyTargets, dateRangeInfo, parsedTimeOff, attorneyName, attorneyEmail]);

  // Process attorney statistics
  const attorneyStats = useMemo(
    () => computeAttorneyDetailStats({
      billableEntries: filteredBillableEntries,
      opsEntries: filteredOpsEntries,
      targets: calculatedTargets,
    }),
    [filteredBillableEntries, filteredOpsEntries, calculatedTargets]
  );

  // Annual utilization progress for this person — the same capacity-weighted
  // pacing shown on the Targets page, scoped to one member. The year follows the
  // active date range's end date (current PST year for all-time / unbounded).
  const summaryYear = dateRangeInfo.endDate.getFullYear();
  const summaryUsers = useMemo(() => (currentUser ? [currentUser] : []), [currentUser]);
  const { actuals: annualActuals, capacity: annualCapacity } = useMonthlyActualsVsTarget(summaryYear, summaryUsers);

  const annualProgress = useMemo(() => {
    if (!currentUser) return null;
    const group = annualGroupForUser(currentUser);
    if (!group) return null;
    const monthlyTargets = monthlyHoursFromTargetMap(attorneyTargets, summaryYear, group.targetField);
    const monthlyActuals = monthlyHoursByIndex(annualActuals?.[currentUser.id], group.actualField);
    const capacityFractions = annualCapacity?.[currentUser.id]?.fractions;
    const isFutureYear = summaryYear > getPSTDate().getFullYear();
    const result = computeAnnualProgress(monthlyTargets, monthlyActuals, capacityFractions, { isFutureYear });
    return { group, result };
  }, [currentUser, attorneyTargets, summaryYear, annualActuals, annualCapacity]);

  // Client breakdown data (billable entries only — ops entries have no client)
  const clientBreakdown = useMemo(
    () => buildClientBreakdown(filteredBillableEntries),
    [filteredBillableEntries]
  );

  // Matter breakdown data (billable entries only)
  const matterBreakdown = useMemo(
    () => buildMatterBreakdown(filteredBillableEntries),
    [filteredBillableEntries]
  );

  // Transaction type breakdown data (billable entries only)
  const transactionBreakdown = useMemo(
    () => buildTransactionBreakdown(filteredBillableEntries),
    [filteredBillableEntries]
  );

  // Ops category breakdown (ops entries only)
  const opsBreakdown = useMemo(
    () => buildOpsBreakdown(filteredOpsEntries),
    [filteredOpsEntries]
  );

  // Monthly trend data
  const monthlyTrend = useMemo(() => buildMonthlyTrend(attorneyEntries), [attorneyEntries]);

  // Recent entries
  const recentEntries = useMemo(() => selectRecentEntries(attorneyEntries), [attorneyEntries]);

  // Sam McClure's manual month-end adjustments (folded into earnings). Only show
  // the Adjustments KPI/column when this attorney actually has adjustment data.
  const hasAdjustments = hasAdjustmentData(attorneyStats, recentEntries);

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);

  // OOO/holiday context for the target tooltips (mirrors the visible note).
  const targetAdjustmentContext = (calculatedTargets.oooDays > 0 || calculatedTargets.holidayDays > 0)
    ? `Targets reflect ${formatTimeOffContext(calculatedTargets.oooDays, calculatedTargets.holidayDays)} this period`
    : undefined;


  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
          <div className="mt-4 text-xl text-gray-700">Loading data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center max-w-md" role="alert">
          <div className="text-red-600 text-xl mb-4">Error loading data</div>
          <div className="text-gray-600 mb-4">{error}</div>
          <Link href="/" className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">
            Back to Dashboard
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => router.back()}
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back</span>
              </button>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-100 rounded-lg">
                  <User className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{attorneyName}</h1>
                  <p className="text-sm text-gray-500">{personRole} Performance Analytics{activationDateLabel && <span className="ml-2 text-gray-600">&middot; Active since {activationDateLabel}</span>}</p>
                </div>
              </div>
            </div>

            <DateRangeDropdown
              dateRange={dateRange}
              setDateRange={setDateRange}
              customDateStart={customDateStart}
              setCustomDateStart={setCustomDateStart}
              customDateEnd={customDateEnd}
              setCustomDateEnd={setCustomDateEnd}
              showDropdown={showDateDropdown}
              setShowDropdown={setShowDateDropdown}
              minDate={activationMonthStart || undefined}
            />
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8 space-y-6">
        
        {/* Date Range Indicator */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-2 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-blue-600" />
          <span className="text-sm text-blue-700">
            Showing data for: <span className="font-semibold">{dateRangeLabel}</span>
            <span className="ml-2 text-blue-600">({attorneyEntries.length} entries)</span>
          </span>
        </div>

        {/* Data Warnings */}
        {dataWarnings[attorneyName] && dataWarnings[attorneyName].length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5 flex-shrink-0" />
            <div className="text-sm text-amber-800">
              <span className="font-medium">Data issues detected:</span>
              <ul className="mt-1 space-y-1">
                {dataWarnings[attorneyName].map((w, i) => (
                  <li key={i}>
                    {w.message}
                    {w.type === 'date-mismatch' && w.mismatchedRows && w.mismatchedRows.length > 0 && (
                      <div className="mt-1 ml-2">
                        <table className="text-xs border-collapse" aria-label="Rows with mismatched dates">
                          <thead>
                            <tr className="text-amber-700">
                              <th scope="col" className="pr-3 py-0.5 text-left font-medium">Row</th>
                              <th scope="col" className="pr-3 py-0.5 text-left font-medium">Date</th>
                              <th scope="col" className="pr-3 py-0.5 text-left font-medium">{w.collection === 'billables' ? 'Client' : 'Description'}</th>
                              <th scope="col" className="pr-3 py-0.5 text-right font-medium">Hours</th>
                            </tr>
                          </thead>
                          <tbody>
                            {w.mismatchedRows.map((row, j) => (
                              <tr key={j} className="text-amber-800">
                                <td className="pr-3 py-0.5">{row.row}</td>
                                <td className="pr-3 py-0.5">{row.date}</td>
                                <td className="pr-3 py-0.5 max-w-[200px] truncate">{row.client || row.description || '—'}</td>
                                <td className="pr-3 py-0.5 text-right">{row.hours}h</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {/* Utilization Summary Card */}
        <div className="bg-white rounded-lg shadow p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
            <Target className="w-5 h-5 text-blue-600" />
            Utilization Summary
          </h3>
          {(calculatedTargets.oooDays > 0 || calculatedTargets.holidayDays > 0) && (
            <p className="text-xs text-gray-500 -mt-2 mb-4">
              Targets reflect {formatTimeOffContext(calculatedTargets.oooDays, calculatedTargets.holidayDays)} this period.
            </p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Overall Utilization */}
            <div className="text-center">
              <div className={`text-4xl font-bold ${attorneyStats.utilization === null ? 'text-gray-400' : getUtilizationColor(attorneyStats.utilization)}`}>
                {attorneyStats.utilization === null ? '-' : attorneyStats.utilization}%
              </div>
              <div className="text-sm text-gray-500 mt-1 inline-flex items-center gap-1">
                Overall Utilization
                <CalcTooltip calcKey="utilizationPct" position="bottom" />
              </div>
              <div className="text-xs text-gray-600 mt-1">
                <CalcTooltip calcKey="proRatedTarget" dynamic={{ context: targetAdjustmentContext }} variant="underline">
                  {formatHours(attorneyStats.totalHours)}h / {formatHours(calculatedTargets.totalTarget)}h target
                </CalcTooltip>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${attorneyStats.utilization === null ? 'bg-gray-300' : getProgressBarColor(attorneyStats.utilization)}`}
                  style={{ width: `${Math.min(attorneyStats.utilization || 0, 100)}%` }}
                />
              </div>
            </div>

            {/* Billable Utilization */}
            <div className="text-center">
              <div className={`text-4xl font-bold ${attorneyStats.billableUtilization === null ? 'text-gray-400' : getUtilizationColor(attorneyStats.billableUtilization)}`}>
                {attorneyStats.billableUtilization === null ? '-' : attorneyStats.billableUtilization}%
              </div>
              <div className="text-sm text-gray-500 mt-1 inline-flex items-center gap-1">
                Billable Utilization
                <CalcTooltip calcKey="utilizationPct" position="bottom" />
              </div>
              <div className="text-xs text-gray-600 mt-1">
                <CalcTooltip calcKey="proRatedTarget" dynamic={{ context: targetAdjustmentContext }} variant="underline">
                  {formatHours(attorneyStats.billableHours)}h / {formatHours(calculatedTargets.billableTarget)}h target
                </CalcTooltip>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${attorneyStats.billableUtilization === null ? 'bg-gray-300' : getProgressBarColor(attorneyStats.billableUtilization)}`}
                  style={{ width: `${Math.min(attorneyStats.billableUtilization || 0, 100)}%` }}
                />
              </div>
            </div>

            {/* Ops Utilization */}
            <div className="text-center">
              <div className={`text-4xl font-bold ${attorneyStats.opsUtilization === null ? 'text-gray-400' : getUtilizationColor(attorneyStats.opsUtilization)}`}>
                {attorneyStats.opsUtilization === null ? '-' : attorneyStats.opsUtilization}%
              </div>
              <div className="text-sm text-gray-500 mt-1 inline-flex items-center gap-1">
                Ops Utilization
                <CalcTooltip calcKey="utilizationPct" position="bottom" />
              </div>
              <div className="text-xs text-gray-600 mt-1">
                <CalcTooltip calcKey="proRatedTarget" dynamic={{ context: targetAdjustmentContext }} variant="underline">
                  {formatHours(attorneyStats.opsHours)}h / {formatHours(calculatedTargets.opsTarget)}h target
                </CalcTooltip>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
                <div
                  className={`h-2 rounded-full ${attorneyStats.opsUtilization === null ? 'bg-gray-300' : getProgressBarColor(attorneyStats.opsUtilization)}`}
                  style={{ width: `${Math.min(attorneyStats.opsUtilization || 0, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Annual Progress (capacity-weighted YTD pacing for the selected year) */}
        {annualProgress && (
          <AnnualProgressCompact year={summaryYear} group={annualProgress.group} result={annualProgress.result} />
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Total Hours
                <CalcTooltip calcKey="totalHours" position="bottom" />
              </span>
              <Clock className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatHours(attorneyStats.totalHours)}h</div>
            <div className="text-xs text-gray-500 mt-1">
              {formatHours(attorneyStats.billableHours)}h bill / {formatHours(attorneyStats.opsHours)}h ops
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Earnings
                <CalcTooltip calcKey="earnings" position="bottom" />
              </span>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-green-700">{formatCurrency(attorneyStats.totalEarnings)}</div>
            <div className="text-xs text-gray-500 mt-1">From billable work</div>
          </div>

          {hasAdjustments && (
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                  Adjustments
                  <CalcTooltip calcKey="adjustment" position="bottom" />
                </span>
                <DollarSign className="w-5 h-5 text-amber-500" />
              </div>
              <div className={`text-2xl font-bold ${attorneyStats.totalAdjustments < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                {formatCurrency(attorneyStats.totalAdjustments)}
              </div>
              <div className="text-xs text-gray-500 mt-1">Included in Earnings</div>
            </div>
          )}

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Matters</span>
              <FileText className="w-5 h-5 text-purple-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{attorneyStats.matterCount}</div>
            <div className="text-xs text-gray-500 mt-1">{attorneyStats.uniqueTransactionTypes} transaction types</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Avg Hours/Matter
                <CalcTooltip calcKey="avgHoursPerTransaction" position="bottom" />
              </span>
              <TrendingUp className="w-5 h-5 text-orange-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatHours(attorneyStats.avgHoursPerMatter)}h</div>
            <div className="text-xs text-gray-500 mt-1">Per matter</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Clients</span>
              <Building2 className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{attorneyStats.uniqueClients}</div>
            <div className="text-xs text-gray-500 mt-1">Unique clients served</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Bill:Ops Ratio</span>
              <Briefcase className="w-5 h-5 text-gray-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">
              {attorneyStats.opsHours > 0 
                ? `${(attorneyStats.billableHours / attorneyStats.opsHours).toFixed(1)}:1`
                : '∞:1'}
            </div>
            <div className="text-xs text-gray-500 mt-1">Billable to ops</div>
          </div>
        </div>

        {/* Charts Row */}
        {attorneyEntries.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Trend */}
            {monthlyTrend.length > 1 && (
              <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label="Hours Trend Over Time chart">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Hours Trend Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={monthlyTrend}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" interval={0} />
                    <YAxis />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="billableHours"
                      stroke={CHART.billable}
                      strokeWidth={2} 
                      name="Billable Hours"
                      dot={{ r: 4 }}
                    />
                    <Line 
                      type="monotone" 
                      dataKey="opsHours" 
                      stroke={CHART.ops}
                      strokeWidth={2} 
                      name="Ops Hours"
                      dot={{ r: 4 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Clients */}
            {clientBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label="Top Clients by Hours chart">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Clients by Hours</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={clientBreakdown.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar dataKey="billableHours" fill={CHART.billable} name="Hours" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Matters */}
            {matterBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label="Top Matters by Hours chart">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Matters by Hours</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={matterBreakdown.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar dataKey="hours" fill={CHART.billable} name="Hours" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Transaction Type and Ops Breakdown */}
        {(transactionBreakdown.length > 0 || opsBreakdown.length > 0) && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Transaction Type Pie Chart */}
            {transactionBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label="Billable Time by Transaction Type chart">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Billable Time by Transaction Type</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={transactionBreakdown.slice(0, 8)}
                      dataKey="hours"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={renderPieLabel}
                      labelLine={{ stroke: LABEL_LINE_COLOR, strokeWidth: 1 }}
                    >
                      {transactionBreakdown.slice(0, 8).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${formatHours(value)}h`]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Ops Category Pie Chart */}
            {opsBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label="Ops Time by Category chart">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Ops Time by Category</h3>
                <ResponsiveContainer width="100%" height={350}>
                  <PieChart>
                    <Pie
                      data={opsBreakdown.slice(0, 8)}
                      dataKey="hours"
                      nameKey="category"
                      cx="50%"
                      cy="50%"
                      outerRadius={100}
                      label={renderPieLabel}
                      labelLine={{ stroke: LABEL_LINE_COLOR, strokeWidth: 1 }}
                    >
                      {opsBreakdown.slice(0, 8).map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(value) => [`${formatHours(value)}h`]} />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Client Details Table */}
        {clientBreakdown.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Client Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200" aria-label="Client breakdown">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Hours
                        <CalcTooltip calcKey="billableHours" position="bottom" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Earnings
                        <CalcTooltip calcKey="earnings" position="bottom" align="right" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        % of Total
                        <CalcTooltip calcKey="shareOfTotalHours" position="bottom" align="right" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {clientBreakdown.map((client, idx) => (
                    <tr 
                      key={idx} 
                      className="hover:bg-purple-50 cursor-pointer"
                      onClick={() => router.push(`/clients/${encodeURIComponent(client.name)}`)}
                    >
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
                        <Link
                          href={`/clients/${encodeURIComponent(client.name)}`}
                          className="hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {client.name}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {client.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                        {formatHours(client.billableHours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 text-right font-medium">
                        {formatCurrency(client.earnings)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {attorneyStats.totalHours > 0 
                          ? Math.round((client.hours / attorneyStats.totalHours) * 100)
                          : 0}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Transaction Type Table */}
        {transactionBreakdown.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Transaction Type Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200" aria-label="Transaction type breakdown">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Hours
                        <CalcTooltip calcKey="billableHours" position="bottom" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Earnings
                        <CalcTooltip calcKey="earnings" position="bottom" align="right" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        % of Billable
                        <CalcTooltip calcKey="shareOfTotalHours" position="bottom" align="right" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {transactionBreakdown.map((txn, idx) => (
                    <tr key={idx} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                          {txn.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {txn.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                        {formatHours(txn.hours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 text-right font-medium">
                        {formatCurrency(txn.earnings)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {txn.percentage}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Recent Entries */}
        {recentEntries.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Recent Entries</h3>
              <p className="text-sm text-gray-500 mt-1">
                Showing {Math.min(50, recentEntries.length)} most recent entries
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200" aria-label="Recent time entries">
                <thead className="bg-gray-50">
                  <tr>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Billable
                        <CalcTooltip calcKey="billableHours" position="bottom" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Ops
                        <CalcTooltip calcKey="opsHours" position="bottom" align="right" />
                      </span>
                    </th>
                    <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Earnings
                        <CalcTooltip calcKey="entryEarnings" position="bottom" align="right" />
                      </span>
                    </th>
                    {hasAdjustments && (
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          Adjustment
                          <CalcTooltip calcKey="entryAdjustment" position="bottom" align="right" />
                        </span>
                      </th>
                    )}
                    <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentEntries.map((entry, idx) => {
                    const entryDate = getEntryDate(entry);
                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
                          <Link
                            href={`/clients/${encodeURIComponent(entry.client || 'Unknown')}`}
                            className="hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {entry.client || 'Unknown'}
                          </Link>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            {entry.billingCategory || entry.category || 'Other'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 text-right font-medium">
                          {entry.billableHours > 0 ? `${formatHours(entry.billableHours)}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 text-right font-medium">
                          {entry.opsHours > 0 ? `${formatHours(entry.opsHours)}h` : '-'}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${entry.earnings < 0 ? 'text-red-600' : 'text-green-700'}`}>
                          {entry.earnings ? formatCurrency(entry.earnings) : '-'}
                        </td>
                        {hasAdjustments && (
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-right font-medium">
                            {entry.adjustment
                              ? <span className={entry.adjustment < 0 ? 'text-red-600' : 'text-gray-900'}>{formatCurrency(entry.adjustment)}</span>
                              : <span className="text-gray-400">-</span>}
                          </td>
                        )}
                        <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={entry.notes}>
                          {entry.notes || '-'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* No Data State */}
        {attorneyEntries.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <User className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No entries found</h3>
            <p className="text-gray-500">
              No time entries found for {attorneyName} in the selected date range.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default AttorneyDetailView;