"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { 
  ArrowLeft, 
  Building2, 
  Clock, 
  DollarSign, 
  Users, 
  Briefcase,
  Calendar,
  Mail,
  Globe,
  TrendingUp,
  FileText,
  Ban
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
import { useAllBillableEntries, useClients, useUsers, usePaymentStatusIndex } from '@/hooks/useFirestoreData';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { getEntryDate, getPSTDate, getDateRangeLabel } from '@/utils/dateHelpers';
import { formatCurrency, formatHours, formatDate } from '@/utils/formatters';
import { DATE_RANGE_OPTIONS } from '@/utils/constants';
import { CHART_COLORS, CHART, GRAY, LABEL_LINE_COLOR, TOOLTIP_BORDER } from '@/utils/colors';
import { getStatusBadge } from '@/utils/statusStyles';
import {
  PAYMENT_STATUS_LABEL,
  HOLD_FLAG_MESSAGE,
  getClientPaymentStatus,
  getPaymentStatusBadge,
} from '@/utils/paymentStatus.mjs';
import { DateRangeDropdown, CalcTooltip } from '@/components/shared';

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

const ClientDetailView = ({ clientName }) => {
  const router = useRouter();
  const { data: allBillableEntries, loading: billableLoading, error: billableError } = useAllBillableEntries();
  const { clients: firebaseClients, loading: clientsLoading, error: clientsError } = useClients();
  const { users: firebaseUsers } = useUsers();
  const { rates: attorneyRates, loading: ratesLoading, error: ratesError, getRate } = useAttorneyRates();

  // Build userId -> display name map
  const userMap = useMemo(() => {
    const map = {};
    (firebaseUsers || []).forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [firebaseUsers]);
  
  // Date range state
  const [dateRange, setDateRange] = useState('all-time');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  const loading = billableLoading || clientsLoading || ratesLoading;
  const error = billableError || clientsError || ratesError;

  // Get client metadata from Firebase
  const clientMetadata = useMemo(() => {
    if (!firebaseClients) return null;
    return firebaseClients.find(c =>
      c.clientName === clientName
    );
  }, [firebaseClients, clientName]);

  // Trimmed per-client "General Note" for display. The raw Firestore value can
  // be a non-string (a numeric-only note cell syncs from Sheets as a number),
  // so coerce before trimming.
  const clientNote = String(clientMetadata?.notes || '').trim();

  // Payment status (On Target / Warning / Hold) — auto-calculated from the
  // synced invoice rows + this client's payment terms (utils/paymentStatus.mjs)
  const { index: paymentIndex } = usePaymentStatusIndex();
  const paymentStatus = useMemo(
    () => getClientPaymentStatus(paymentIndex, clientName),
    [paymentIndex, clientName]
  );

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
        startDate = null;
    }

    return { startDate, endDate };
  }, [dateRange, customDateStart, customDateEnd]);

  // Filter billable entries for this client (ops entries have no client association)
  const clientEntries = useMemo(() => {
    let entries = (allBillableEntries || []).filter(entry =>
      (entry.client || 'Unknown') === clientName
    );

    // Apply date filter
    if (dateRange !== 'all-time' && dateRangeInfo.startDate) {
      entries = entries.filter(entry => {
        const entryDate = getEntryDate(entry);
        return entryDate >= dateRangeInfo.startDate && entryDate <= dateRangeInfo.endDate;
      });
    }

    return entries;
  }, [allBillableEntries, clientName, dateRange, dateRangeInfo]);

  // Process client statistics
  const clientStats = useMemo(() => {
    if (!clientEntries.length) {
      return {
        totalHours: 0,
        billableHours: 0,
        opsHours: 0,
        grossBillables: 0,
        takeHomeEarnings: 0,
        transactionCount: 0,
        uniqueTransactionTypes: 0,
        uniqueAttorneys: 0,
        avgHoursPerTransaction: 0,
        lastActivity: null,
        firstActivity: null,
      };
    }

    const stats = {
      totalHours: 0,
      billableHours: 0,
      opsHours: 0,
      grossBillables: 0,
      takeHomeEarnings: 0,
      transactionCount: clientEntries.length,
      transactionTypes: new Set(),
      attorneys: new Set(),
      lastActivity: null,
      firstActivity: null,
    };

    clientEntries.forEach(entry => {
      const billable = entry.billableHours || 0;
      const ops = entry.opsHours || 0;
      
      stats.billableHours += billable;
      stats.opsHours += ops;
      stats.totalHours += billable + ops;
      stats.takeHomeEarnings += entry.earnings || 0;
      
      // Calculate gross billables using attorney rate * hours
      const entryDate = getEntryDate(entry);
      const attorneyName = userMap[entry.userId] || entry.userId;
      if (attorneyName && billable > 0) {
        const rate = getRate(attorneyName, entryDate);
        stats.grossBillables += rate * billable;
      }

      if (entry.billingCategory || entry.category) {
        stats.transactionTypes.add(entry.billingCategory || entry.category);
      }
      if (entry.userId) {
        stats.attorneys.add(userMap[entry.userId] || entry.userId);
      }

      const entryDate2 = getEntryDate(entry);
      if (!stats.lastActivity || entryDate2 > stats.lastActivity) {
        stats.lastActivity = entryDate2;
      }
      if (!stats.firstActivity || entryDate2 < stats.firstActivity) {
        stats.firstActivity = entryDate2;
      }
    });

    return {
      ...stats,
      uniqueTransactionTypes: stats.transactionTypes.size,
      uniqueAttorneys: stats.attorneys.size,
      avgHoursPerTransaction: stats.transactionCount > 0 
        ? stats.totalHours / stats.transactionCount 
        : 0,
    };
  }, [clientEntries, getRate, userMap]);

  // Attorney breakdown data
  const attorneyBreakdown = useMemo(() => {
    const breakdown = {};

    clientEntries.forEach(entry => {
      const attorney = userMap[entry.userId] || entry.userId || 'Unknown';
      if (!breakdown[attorney]) {
        breakdown[attorney] = {
          name: attorney,
          hours: 0,
          billableHours: 0,
          opsHours: 0,
          grossBillables: 0,
          takeHomeEarnings: 0,
          count: 0,
        };
      }
      const billableHours = entry.billableHours || 0;
      breakdown[attorney].billableHours += billableHours;
      breakdown[attorney].opsHours += entry.opsHours || 0;
      breakdown[attorney].hours += billableHours + (entry.opsHours || 0);
      breakdown[attorney].takeHomeEarnings += entry.earnings || 0;
      breakdown[attorney].count += 1;
      
      // Calculate gross billables using attorney rate * hours
      if (billableHours > 0) {
        const entryDate = getEntryDate(entry);
        const rate = getRate(attorney, entryDate);
        breakdown[attorney].grossBillables += rate * billableHours;
      }
    });

    return Object.values(breakdown).sort((a, b) => b.hours - a.hours);
  }, [clientEntries, getRate, userMap]);

  // Transaction type breakdown data
  const transactionBreakdown = useMemo(() => {
    const breakdown = {};

    clientEntries.forEach(entry => {
      const category = entry.billingCategory || entry.category || 'Other';
      const billable = entry.billableHours || 0;

      if (billable > 0) {
        if (!breakdown[category]) {
          breakdown[category] = {
            type: category,
            hours: 0,
            grossBillables: 0,
            takeHomeEarnings: 0,
            count: 0,
          };
        }
        breakdown[category].hours += billable;
        breakdown[category].takeHomeEarnings += entry.earnings || 0;
        breakdown[category].count += 1;

        // Calculate gross billables
        const attorney = userMap[entry.userId] || entry.userId;
        if (attorney) {
          const entryDate = getEntryDate(entry);
          const rate = getRate(attorney, entryDate);
          breakdown[category].grossBillables += rate * billable;
        }
      }
    });

    const result = Object.values(breakdown).sort((a, b) => b.hours - a.hours);
    const totalHours = result.reduce((sum, t) => sum + t.hours, 0);
    
    return result.map(t => ({
      ...t,
      percentage: totalHours > 0 ? Math.round((t.hours / totalHours) * 100) : 0,
    }));
  }, [clientEntries, getRate, userMap]);

  // Trend data — bucket weekly if span ≤ ~4 months, else monthly
  const trendData = useMemo(() => {
    if (clientEntries.length === 0) return [];

    let minDate = null;
    let maxDate = null;
    clientEntries.forEach(entry => {
      const d = getEntryDate(entry);
      if (!minDate || d < minDate) minDate = d;
      if (!maxDate || d > maxDate) maxDate = d;
    });

    const spanDays = (maxDate - minDate) / (1000 * 60 * 60 * 24);
    const useWeekly = spanDays <= 120;

    const buckets = {};
    clientEntries.forEach(entry => {
      const entryDate = getEntryDate(entry);
      let key;
      let label;

      if (useWeekly) {
        // Week starts Monday
        const dow = entryDate.getDay();
        const daysSinceMonday = (dow + 6) % 7;
        const weekStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), entryDate.getDate() - daysSinceMonday);
        key = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
        label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      } else {
        const monthStart = new Date(entryDate.getFullYear(), entryDate.getMonth(), 1);
        key = `${monthStart.getFullYear()}-${String(monthStart.getMonth() + 1).padStart(2, '0')}`;
        label = monthStart.toLocaleDateString('en-US', { month: 'short' });
      }

      if (!buckets[key]) {
        buckets[key] = {
          key,
          label,
          billableHours: 0,
          opsHours: 0,
          totalHours: 0,
          grossBillables: 0,
          takeHomeEarnings: 0,
          count: 0,
        };
      }

      const billableHours = entry.billableHours || 0;
      buckets[key].billableHours += billableHours;
      buckets[key].opsHours += entry.opsHours || 0;
      buckets[key].totalHours += billableHours + (entry.opsHours || 0);
      buckets[key].takeHomeEarnings += entry.earnings || 0;
      buckets[key].count += 1;

      const attorney = userMap[entry.userId] || entry.userId;
      if (attorney && billableHours > 0) {
        const rate = getRate(attorney, entryDate);
        buckets[key].grossBillables += rate * billableHours;
      }
    });

    const sorted = Object.values(buckets).sort((a, b) => a.key.localeCompare(b.key));

    // Projection for current (incomplete) period
    const today = new Date();
    let currentKey;
    let elapsedFraction;
    if (useWeekly) {
      const dow = today.getDay();
      const daysSinceMonday = (dow + 6) % 7;
      const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysSinceMonday);
      currentKey = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
      // Elapsed days including today, of 7
      elapsedFraction = Math.min(7, daysSinceMonday + 1) / 7;
    } else {
      currentKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;
      const daysInMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
      elapsedFraction = today.getDate() / daysInMonth;
    }

    const lastIdx = sorted.length - 1;
    if (lastIdx >= 0 && sorted[lastIdx].key === currentKey && elapsedFraction > 0 && elapsedFraction < 1) {
      const last = sorted[lastIdx];
      const projected = last.billableHours / elapsedFraction;
      last.projectedBillable = projected;
      // Anchor projection line on previous bucket so dotted segment connects
      if (lastIdx - 1 >= 0) {
        sorted[lastIdx - 1].projectedBillable = sorted[lastIdx - 1].billableHours;
      }
    }

    return sorted;
  }, [clientEntries, getRate, userMap]);

  // Recent entries (sorted by date, most recent first)
  const recentEntries = useMemo(() => {
    return [...clientEntries]
      .sort((a, b) => {
        const dateA = getEntryDate(a);
        const dateB = getEntryDate(b);
        return dateB - dateA;
      })
      .slice(0, 50);
  }, [clientEntries]);

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);

  // Status badge: Active/Quiet driven by billable hours in the selected range,
  // matching the Clients list view. A Terminated/Dissolved CRM status is kept
  // as-is since those clients are excluded from the list entirely (so we don't
  // want a terminated client with historical hours to read as "Active").
  const INACTIVE_CLIENT_STATUSES = ['Terminated', 'Dissolved'];
  const displayStatus = INACTIVE_CLIENT_STATUSES.includes(clientMetadata?.status)
    ? clientMetadata.status
    : (clientStats.billableHours > 0 ? 'Active' : 'Quiet');

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading client data...</div>
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
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{clientName}</h1>
                  <div className="flex items-center gap-3 mt-1">
                    {clientMetadata && (
                      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${
                        getStatusBadge(displayStatus)
                      }`}>
                        {displayStatus}
                      </span>
                    )}
                    {/* Only tag clients that exist in the book — an unknown
                        name would otherwise read as a misleading "On Target" */}
                    {clientMetadata && (
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full ${
                        getPaymentStatusBadge(paymentStatus.status)
                      }`}>
                        {PAYMENT_STATUS_LABEL[paymentStatus.status]}
                        <CalcTooltip calcKey="paymentStatusTag" position="bottom" />
                      </span>
                    )}
                    {clientMetadata && paymentStatus.holdFlag && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-status-danger">
                        <Ban className="w-3.5 h-3.5" />
                        {HOLD_FLAG_MESSAGE}
                      </span>
                    )}
                    {clientMetadata?.clientType && (
                      <span className="text-sm text-gray-500">{clientMetadata.clientType}</span>
                    )}
                  </div>
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
        <div className="bg-purple-50 border border-purple-200 rounded-lg px-4 py-2 flex items-center gap-2">
          <Calendar className="w-4 h-4 text-purple-600" />
          <span className="text-sm text-purple-700">
            Showing data for: <span className="font-semibold">{dateRangeLabel}</span>
            <span className="ml-2 text-purple-600">({clientEntries.length} entries)</span>
          </span>
        </div>

        {/* Client Metadata */}
        {clientMetadata && (clientMetadata.contactEmail || clientMetadata.website || clientMetadata.channel || clientNote) && (
          <div className="bg-white rounded-lg shadow p-4 space-y-3">
            {(clientMetadata.contactEmail || clientMetadata.website || clientMetadata.channel) && (
              <div className="flex flex-wrap gap-6 text-sm">
                {clientMetadata.contactEmail && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Mail className="w-4 h-4" />
                    <a href={`mailto:${clientMetadata.contactEmail}`} className="hover:text-blue-600">
                      {clientMetadata.contactEmail}
                    </a>
                  </div>
                )}
                {clientMetadata.website && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Globe className="w-4 h-4" />
                    <a href={clientMetadata.website} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">
                      {clientMetadata.website}
                    </a>
                  </div>
                )}
                {clientMetadata.channel && (
                  <div className="flex items-center gap-2 text-gray-600">
                    <Briefcase className="w-4 h-4" />
                    <span>Channel: {clientMetadata.channel}</span>
                  </div>
                )}
              </div>
            )}
            {/* Per-client "General Notes" synced from the finance sheet, tied to
                this client by name. */}
            {clientNote && (
              <div className="flex items-start gap-2 text-sm text-gray-600">
                <FileText className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
                <div>
                  <span className="font-medium text-gray-500">Notes: </span>
                  <span className="whitespace-pre-wrap">{clientNote}</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Billable Hours
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
              <Clock className="w-5 h-5 text-blue-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatHours(clientStats.billableHours)}h</div>
            <div className="text-xs text-gray-500 mt-1">
              {clientStats.transactionCount} entries
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Gross Billables
                <CalcTooltip calcKey="grossBillables" position="bottom" />
              </span>
              <DollarSign className="w-5 h-5 text-green-500" />
            </div>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(clientStats.grossBillables)}</div>
            <div className="text-xs text-gray-500 mt-1">Rate × Hours</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Transactions</span>
              <FileText className="w-5 h-5 text-purple-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{clientStats.transactionCount}</div>
            <div className="text-xs text-gray-500 mt-1">{clientStats.uniqueTransactionTypes} unique types</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium inline-flex items-center gap-1">
                Avg Hours/Txn
                <CalcTooltip calcKey="avgHoursPerTransaction" position="bottom" />
              </span>
              <TrendingUp className="w-5 h-5 text-orange-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{formatHours(clientStats.avgHoursPerTransaction)}h</div>
            <div className="text-xs text-gray-500 mt-1">Per transaction</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Attorneys</span>
              <Users className="w-5 h-5 text-indigo-500" />
            </div>
            <div className="text-2xl font-bold text-gray-900">{clientStats.uniqueAttorneys}</div>
            <div className="text-xs text-gray-500 mt-1">Have worked on this client</div>
          </div>

          <div className="bg-white p-4 rounded-lg shadow">
            <div className="flex items-center justify-between mb-2">
              <span className="text-gray-600 text-sm font-medium">Last Activity</span>
              <Calendar className="w-5 h-5 text-gray-500" />
            </div>
            <div className="text-lg font-bold text-gray-900">
              {clientStats.lastActivity 
                ? clientStats.lastActivity.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
                : 'No activity'}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {clientStats.firstActivity && `Since ${clientStats.firstActivity.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}`}
            </div>
          </div>
        </div>

        {/* Charts Row */}
        {clientEntries.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Monthly Trend */}
            {trendData.length > 1 && (
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Hours Trend Over Time</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={trendData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="label" interval={0} />
                    <YAxis />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="billableHours"
                      stroke={CHART.ops}
                      strokeWidth={2}
                      name="Billable Hours"
                      dot={{ r: 4 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="projectedBillable"
                      stroke={CHART.ops}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      name="Projected (current period)"
                      dot={{ r: 3, strokeDasharray: '' }}
                      connectNulls
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Attorney Breakdown */}
            {attorneyBreakdown.length > 0 && (
              <div className="bg-white p-6 rounded-lg shadow">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">Hours by Attorney</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={attorneyBreakdown.slice(0, 8)}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis allowDecimals={false} domain={[0, (dataMax) => Math.ceil(dataMax / 10) * 10]} ticks={Array.from({ length: Math.ceil(Math.max(...attorneyBreakdown.slice(0, 8).map(a => a.billableHours || 0)) / 10) + 1 }, (_, i) => i * 10)} />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Legend />
                    <Bar dataKey="billableHours" fill={CHART.ops} name="Billable Hours" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        )}

        {/* Transaction Type Breakdown */}
        {transactionBreakdown.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Pie Chart */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Time by Transaction Type</h3>
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
                  <Tooltip
                    formatter={(value) => [`${formatHours(value)}h`]}
                    contentStyle={{ borderRadius: '8px', border: `1px solid ${TOOLTIP_BORDER}` }}
                  />
                  <Legend
                    formatter={(value, entry) => `${value} (${formatHours(entry?.payload?.hours ?? 0)}h)`}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Table */}
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Transaction Type Details</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Count</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          Hours
                          <CalcTooltip calcKey="billableHours" position="bottom" />
                        </span>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          Gross Billables
                          <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
                        </span>
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        <span className="inline-flex items-center gap-1">
                          %
                          <CalcTooltip calcKey="shareOfTotalHours" position="bottom" align="right" />
                        </span>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {transactionBreakdown.map((txn, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-sm font-medium text-gray-900">{txn.type}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">{txn.count}</td>
                        <td className="px-4 py-3 text-sm text-gray-900 text-right font-medium">{formatHours(txn.hours)}h</td>
                        <td className="px-4 py-3 text-sm text-green-600 text-right font-medium">{formatCurrency(txn.grossBillables)}</td>
                        <td className="px-4 py-3 text-sm text-gray-600 text-right">{txn.percentage}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Attorney Details Table */}
        {attorneyBreakdown.length > 0 && (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-900">Attorney Breakdown</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attorney</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">Entries</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Billable Hours
                        <CalcTooltip calcKey="billableHours" position="bottom" />
                      </span>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Gross Billables
                        <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
                      </span>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        % of Total
                        <CalcTooltip calcKey="shareOfTotalHours" position="bottom" align="right" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {attorneyBreakdown.map((attorney, idx) => (
                    <tr key={idx} className="hover:bg-blue-50">
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {attorney.name}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {attorney.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 text-right font-medium">
                        {formatHours(attorney.billableHours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                        {formatCurrency(attorney.grossBillables)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                        {clientStats.billableHours > 0 
                          ? Math.round((attorney.billableHours / clientStats.billableHours) * 100)
                          : 0}%
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
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Attorney</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Hours
                        <CalcTooltip calcKey="billableHours" position="bottom" align="right" />
                      </span>
                    </th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                      <span className="inline-flex items-center gap-1">
                        Gross Billables
                        <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
                      </span>
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase">Notes</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {recentEntries.map((entry, idx) => {
                    const entryDate = getEntryDate(entry);
                    const billableHours = entry.billableHours || 0;
                    const entryUserName = userMap[entry.userId] || entry.userId;
                    const rate = entryUserName ? getRate(entryUserName, entryDate) : 0;
                    const grossBillables = rate * billableHours;
                    return (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {entryDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {entryUserName}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-900">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            {entry.billingCategory || entry.category || 'Other'}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-blue-600 text-right font-medium">
                          {billableHours > 0 ? `${formatHours(billableHours)}h` : '-'}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                          {grossBillables > 0 ? formatCurrency(grossBillables) : '-'}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 max-w-xs truncate" title={entry.notes || entry.description}>
                          {entry.notes || entry.description || '-'}
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
        {clientEntries.length === 0 && (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Building2 className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No entries found</h3>
            <p className="text-gray-500">
              No time entries found for {clientName} in the selected date range.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientDetailView;