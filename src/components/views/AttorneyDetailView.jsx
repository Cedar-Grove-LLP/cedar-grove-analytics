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
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import {
  getEntryDate,
  getPSTDate,
  getDateRangeLabel,
} from '@/utils/dateHelpers';
import {
  parseTimeOff,
  getHolidaySet,
  getOooSetFor,
  proRateMonth,
} from '@/utils/timeOff';
import { formatCurrency, formatHours, formatDate, formatTimeOffContext } from '@/utils/formatters';
import { CHART_COLORS, CHART, GRAY, LABEL_LINE_COLOR } from '@/utils/colors';
import { getUtilizationColor, getUtilizationBgColor, getProgressBarColor } from '@/utils/statusStyles';
import { DateRangeDropdown } from '@/components/shared';

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

  // Get the person's role from user profile
  const personRole = useMemo(() => {
    const user = users.find(u => (u.name || u.id) === attorneyName || u.id === attorneyName);
    return user?.role || 'Attorney';
  }, [users, attorneyName]);

  // Email for joining out-of-office data (exact normalized match in the calendar)
  const attorneyEmail = useMemo(() => {
    const user = users.find(u => (u.name || u.id) === attorneyName || u.id === attorneyName);
    return user?.email || '';
  }, [users, attorneyName]);

  const loading = billableLoading || opsLoading;
  const error = billableError || opsError;

  // Calculate date range boundaries
  const dateRangeInfo = useMemo(() => {
    const now = getPSTDate();
    let startDate = null;
    let endDate = new Date(now);

    switch (dateRange) {
      case 'all-time':
        startDate = null;
        break;
      case 'current-week': {
        const dayOfWeek = now.getDay();
        const daysSinceMonday = (dayOfWeek + 6) % 7;
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
        break;
      }
      case 'last-week': {
        const dow = now.getDay();
        const dSinceMonday = (dow + 6) % 7;
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dSinceMonday, 0, 0, 0, 0);
        startDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7, 0, 0, 0, 0);
        endDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1, 23, 59, 59, 999);
        break;
      }
      case 'current-month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'last-month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'trailing-60':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60, 0, 0, 0, 0);
        break;
      case 'custom':
        if (customDateStart && customDateEnd) {
          const [startYear, startMonth, startDay] = customDateStart.split('-').map(Number);
          const [endYear, endMonth, endDay] = customDateEnd.split('-').map(Number);
          startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
          endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
        }
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
    }

    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return { startDate, endDate, currentMonthKey, now };
  }, [dateRange, customDateStart, customDateEnd]);

  // Filter billable entries by date range
  const filteredBillableEntries = useMemo(() => {
    if (!billableEntries) return [];
    let entries = billableEntries;
    if (dateRange !== 'all-time' && dateRangeInfo.startDate) {
      entries = entries.filter(entry => {
        const entryDate = getEntryDate(entry);
        return entryDate >= dateRangeInfo.startDate && entryDate <= dateRangeInfo.endDate;
      });
    }
    return entries;
  }, [billableEntries, dateRange, dateRangeInfo]);

  // Filter ops entries by date range
  const filteredOpsEntries = useMemo(() => {
    if (!opsEntries) return [];
    let entries = opsEntries;
    if (dateRange !== 'all-time' && dateRangeInfo.startDate) {
      entries = entries.filter(entry => {
        const entryDate = getEntryDate(entry);
        return entryDate >= dateRangeInfo.startDate && entryDate <= dateRangeInfo.endDate;
      });
    }
    return entries;
  }, [opsEntries, dateRange, dateRangeInfo]);

  // Combined entries reference (used for active months, targets, etc.)
  const attorneyEntries = useMemo(() => {
    return [...filteredBillableEntries, ...filteredOpsEntries];
  }, [filteredBillableEntries, filteredOpsEntries]);

  // Calculate targets based on active months
  const calculatedTargets = useMemo(() => {
    const { startDate, endDate, currentMonthKey } = dateRangeInfo;
    
    // Get unique months from entries
    const activeMonths = new Set();
    attorneyEntries.forEach(entry => {
      const entryDate = getEntryDate(entry);
      const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
      activeMonths.add(monthKey);
    });

    const defaultTarget = {
      billableTarget: attorneyTargets[currentMonthKey]?.billableHours ?? 100,
      opsTarget: attorneyTargets[currentMonthKey]?.opsHours ?? 50,
      totalTarget: attorneyTargets[currentMonthKey]?.totalHours ?? 150,
      oooDays: 0,
      holidayDays: 0,
    };

    if (activeMonths.size === 0) {
      return defaultTarget;
    }

    // Firm holidays for the range + this attorney's out-of-office days.
    const rangeHolidaySet = getHolidaySet(parsedTimeOff, startDate, endDate);
    const oooSet = getOooSetFor(parsedTimeOff, { name: attorneyName, email: attorneyEmail });

    let totalBillableTarget = 0;
    let totalOpsTarget = 0;
    let totalTarget = 0;
    let oooDays = 0;
    let holidayDays = 0;

    Array.from(activeMonths).forEach(monthKey => {
      const [year, month] = monthKey.split('-').map(Number);

      const monthTarget = attorneyTargets[monthKey];
      const billableTarget = monthTarget?.billableHours ?? defaultTarget.billableTarget;
      const opsTarget = monthTarget?.opsHours ?? defaultTarget.opsTarget;
      const monthTotalTarget = monthTarget?.totalHours ?? defaultTarget.totalTarget;

      // Capacity-model fraction — the attorney's OOO reduces the target for any
      // period (in-progress or completed); firm holidays only affect intra-month
      // pace (they cancel for a full month, leaving a full clean month at 1).
      const pm = proRateMonth(year, month, dateRangeInfo, rangeHolidaySet, oooSet);

      totalBillableTarget += billableTarget * pm.fraction;
      totalOpsTarget += opsTarget * pm.fraction;
      totalTarget += monthTotalTarget * pm.fraction;
      oooDays += pm.oooDays;        // OOO / holiday context (UI messaging only)
      holidayDays += pm.holidayDays;
    });

    return {
      billableTarget: Math.round(totalBillableTarget * 10) / 10,
      opsTarget: Math.round(totalOpsTarget * 10) / 10,
      totalTarget: Math.round(totalTarget * 10) / 10,
      oooDays,
      holidayDays,
    };
  }, [attorneyEntries, attorneyTargets, dateRangeInfo, parsedTimeOff, attorneyName, attorneyEmail]);

  // Process attorney statistics
  const attorneyStats = useMemo(() => {
    if (!attorneyEntries.length) {
      return {
        totalHours: 0,
        billableHours: 0,
        opsHours: 0,
        totalEarnings: 0,
        matterCount: 0,
        uniqueTransactionTypes: 0,
        uniqueClients: 0,
        avgHoursPerMatter: 0,
        lastActivity: null,
        firstActivity: null,
        utilization: calculatedTargets.totalTarget > 0 ? 0 : null,
        billableUtilization: calculatedTargets.billableTarget > 0 ? 0 : null,
        opsUtilization: calculatedTargets.opsTarget > 0 ? 0 : null,
      };
    }

    const stats = {
      totalHours: 0,
      billableHours: 0,
      opsHours: 0,
      totalEarnings: 0,
      matters: new Set(),
      transactionTypes: new Set(),
      clients: new Set(),
      lastActivity: null,
      firstActivity: null,
    };

    filteredBillableEntries.forEach(entry => {
      const billable = entry.billableHours || 0;
      stats.billableHours += billable;
      stats.totalHours += billable;
      stats.totalEarnings += entry.earnings || 0;

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

    filteredOpsEntries.forEach(entry => {
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

    const utilization = calculatedTargets.totalTarget > 0
      ? Math.round((stats.totalHours / calculatedTargets.totalTarget) * 100)
      : null;
    const billableUtilization = calculatedTargets.billableTarget > 0
      ? Math.round((stats.billableHours / calculatedTargets.billableTarget) * 100)
      : null;
    const opsUtilization = calculatedTargets.opsTarget > 0
      ? Math.round((stats.opsHours / calculatedTargets.opsTarget) * 100)
      : null;

    return {
      ...stats,
      matterCount: stats.matters.size,
      uniqueTransactionTypes: stats.transactionTypes.size,
      uniqueClients: stats.clients.size,
      avgHoursPerMatter: stats.matters.size > 0
        ? stats.billableHours / stats.matters.size
        : 0,
      utilization,
      billableUtilization,
      opsUtilization,
    };
  }, [attorneyEntries, filteredBillableEntries, filteredOpsEntries, calculatedTargets]);

  // Client breakdown data (billable entries only — ops entries have no client)
  const clientBreakdown = useMemo(() => {
    const breakdown = {};

    filteredBillableEntries.forEach(entry => {
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
  }, [filteredBillableEntries]);

  // Matter breakdown data (billable entries only)
  const matterBreakdown = useMemo(() => {
    const breakdown = {};

    filteredBillableEntries.forEach(entry => {
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
  }, [filteredBillableEntries]);

  // Transaction type breakdown data (billable entries only)
  const transactionBreakdown = useMemo(() => {
    const breakdown = {};

    filteredBillableEntries.forEach(entry => {
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

    return result.map(t => ({
      ...t,
      percentage: totalHours > 0 ? Math.round((t.hours / totalHours) * 100) : 0,
    }));
  }, [filteredBillableEntries]);

  // Ops category breakdown (ops entries only)
  const opsBreakdown = useMemo(() => {
    const breakdown = {};

    filteredOpsEntries.forEach(entry => {
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

    return result.map(t => ({
      ...t,
      percentage: totalHours > 0 ? Math.round((t.hours / totalHours) * 100) : 0,
    }));
  }, [filteredOpsEntries]);

  // Monthly trend data
  const monthlyTrend = useMemo(() => {
    const monthlyData = {};
    
    attorneyEntries.forEach(entry => {
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
  }, [attorneyEntries]);

  // Recent entries
  const recentEntries = useMemo(() => {
    return [...attorneyEntries]
      .sort((a, b) => {
        const dateA = getEntryDate(a);
        const dateB = getEntryDate(b);
        return dateB - dateA;
      })
      .slice(0, 50);
  }, [attorneyEntries]);

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);


  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading data...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center max-w-md">
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
                  <p className="text-sm text-gray-500">{personRole} Performance Analytics</p>
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
                        <table className="text-xs border-collapse">
                          <thead>
                            <tr className="text-amber-700">
                              <th className="pr-3 py-0.5 text-left font-medium">Row</th>
                              <th className="pr-3 py-0.5 text-left font-medium">Date</th>
                              <th className="pr-3 py-0.5 text-left font-medium">{w.collection === 'billables' ? 'Client' : 'Description'}</th>
                              <th className="pr-3 py-0.5 text-right font-medium">Hours</th>
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
              <div className="text-sm text-gray-500 mt-1">Overall Utilization</div>
              <div className="text-xs text-gray-400 mt-1">
                {formatHours(attorneyStats.totalHours)}h / {formatHours(calculatedTargets.totalTarget)}h target
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
              <div className="text-sm text-gray-500 mt-1">Billable Utilization</div>
              <div className="text-xs text-gray-400 mt-1">
                {formatHours(attorneyStats.billableHours)}h / {formatHours(calculatedTargets.billableTarget)}h target
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
              <div className="text-sm text-gray-500 mt-1">Ops Utilization</div>
              <div className="text-xs text-gray-400 mt-1">
                {formatHours(attorneyStats.opsHours)}h / {formatHours(calculatedTargets.opsTarget)}h target
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

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Total Hours</span>
              <Clock className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatHours(attorneyStats.totalHours)}h</div>
            <div className="text-xs text-gray-500 mt-1">
              {formatHours(attorneyStats.billableHours)}h bill / {formatHours(attorneyStats.opsHours)}h ops
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Earnings</span>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(attorneyStats.totalEarnings)}</div>
            <div className="text-xs text-gray-500 mt-1">From billable work</div>
          </div>

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
              <span className="text-gray-600 text-sm font-medium">Avg Hours/Matter</span>
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
              <div className="bg-white p-6 rounded-lg shadow">
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
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Clients by Hours</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={clientBreakdown.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar dataKey="billableHours" fill={CHART.ops} name="Hours" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Top Matters */}
            {matterBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Top Matters by Hours</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={matterBreakdown.slice(0, 8)} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis dataKey="name" type="category" width={120} tick={{ fontSize: 12 }} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar dataKey="hours" fill={CHART.ops} name="Hours" />
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
              <div className="bg-white p-6 rounded-lg shadow">
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
              <div className="bg-white p-6 rounded-lg shadow">
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
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Earnings</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">% of Total</th>
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
                        {client.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {client.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                        {formatHours(client.billableHours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
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
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Hours</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Earnings</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">% of Billable</th>
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
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
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
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Billable</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ops</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Earnings</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
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
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800 cursor-pointer"
                            onClick={() => router.push(`/clients/${encodeURIComponent(entry.client || 'Unknown')}`)}>
                          {entry.client || 'Unknown'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            {entry.billingCategory || entry.category || 'Other'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 text-right font-medium">
                          {entry.billableHours > 0 ? `${formatHours(entry.billableHours)}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                          {entry.opsHours > 0 ? `${formatHours(entry.opsHours)}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                          {entry.earnings > 0 ? formatCurrency(entry.earnings) : '-'}
                        </td>
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