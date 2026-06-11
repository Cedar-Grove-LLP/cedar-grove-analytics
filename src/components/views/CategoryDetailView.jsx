"use client";

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Layers } from 'lucide-react';
import { useAllBillableEntries, useUsers } from '@/hooks/useFirestoreData';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { getEntryDate, getPSTDate, getDateRangeLabel } from '@/utils/dateHelpers';
import { formatCurrency, formatHours } from '@/utils/formatters';
import { DateRangeDropdown, CalcTooltip } from '@/components/shared';
import { MatterRowTooltip } from '@/components/tooltips';

const CategoryDetailView = ({ categoryName }) => {
  const router = useRouter();
  const { data: allBillableEntries, loading: billableLoading, error: billableError } = useAllBillableEntries();
  const { users: firebaseUsers } = useUsers();
  const { loading: ratesLoading, error: ratesError, getRate } = useAttorneyRates();

  const [dateRange, setDateRange] = useState('all-time');
  const [customDateStart, setCustomDateStart] = useState('');
  const [customDateEnd, setCustomDateEnd] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [sortConfig, setSortConfig] = useState({ key: 'totalHours', direction: 'desc' });
  const [hoveredMatter, setHoveredMatter] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const loading = billableLoading || ratesLoading;
  const error = billableError || ratesError;

  const userMap = useMemo(() => {
    const map = {};
    (firebaseUsers || []).forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [firebaseUsers]);

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

  const categoryEntries = useMemo(() => {
    let entries = (allBillableEntries || []).filter(entry => {
      const cat = entry.billingCategory || 'Other';
      return cat === categoryName;
    });

    entries = entries.filter(entry => (entry.billableHours || 0) > 0);

    if (dateRange !== 'all-time' && dateRangeInfo.startDate) {
      entries = entries.filter(entry => {
        const entryDate = getEntryDate(entry);
        return entryDate >= dateRangeInfo.startDate && entryDate <= dateRangeInfo.endDate;
      });
    }

    return entries;
  }, [allBillableEntries, categoryName, dateRange, dateRangeInfo]);

  const matterBreakdown = useMemo(() => {
    const breakdown = {};

    categoryEntries.forEach(entry => {
      const matter = entry.matter || 'No Matter';
      const billable = entry.billableHours || 0;
      const earnings = entry.earnings || 0;
      const attorney = userMap[entry.userId] || entry.userId;

      if (!breakdown[matter]) {
        breakdown[matter] = {
          matter,
          clientName: entry.client || 'Unknown',
          totalHours: 0,
          totalEarnings: 0,
          grossBillables: 0,
          count: 0,
          byAttorney: {},
          entries: [],
        };
      }
      breakdown[matter].totalHours += billable;
      breakdown[matter].totalEarnings += earnings;
      breakdown[matter].count += 1;

      if (attorney) {
        if (!breakdown[matter].byAttorney[attorney]) {
          breakdown[matter].byAttorney[attorney] = { count: 0, hours: 0, earnings: 0 };
        }
        breakdown[matter].byAttorney[attorney].count += 1;
        breakdown[matter].byAttorney[attorney].hours += billable;
        breakdown[matter].byAttorney[attorney].earnings += earnings;
      }

      if (breakdown[matter].entries.length < 50) {
        breakdown[matter].entries.push({
          attorney: attorney || 'Unknown',
          client: entry.client || 'Unknown',
          hours: billable,
          earnings,
          date: entry.date || '',
          notes: entry.notes || entry.description || '',
        });
      }

      if (attorney && billable > 0) {
        const rate = getRate(attorney, getEntryDate(entry));
        breakdown[matter].grossBillables += rate * billable;
      }
    });

    const result = Object.values(breakdown);
    const totalHours = result.reduce((sum, m) => sum + m.totalHours, 0);

    return result.map(m => ({
      ...m,
      avgHours: m.count > 0 ? m.totalHours / m.count : 0,
      percentage: totalHours > 0 ? (m.totalHours / totalHours) * 100 : 0,
      entries: m.entries.sort((a, b) => {
        if (!a.date || !b.date) return 0;
        const dateA = a.date.seconds ? new Date(a.date.seconds * 1000) : new Date(a.date);
        const dateB = b.date.seconds ? new Date(b.date.seconds * 1000) : new Date(b.date);
        return dateB - dateA;
      }),
    })).sort((a, b) => b.totalHours - a.totalHours);
  }, [categoryEntries, getRate, userMap]);

  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const sortedMatters = useMemo(() => {
    const items = [...matterBreakdown];
    const { key, direction } = sortConfig;

    items.sort((a, b) => {
      let aVal, bVal;
      switch (key) {
        case 'matter':
          aVal = a.matter.toLowerCase();
          bVal = b.matter.toLowerCase();
          break;
        case 'clientName':
          aVal = a.clientName.toLowerCase();
          bVal = b.clientName.toLowerCase();
          break;
        case 'count':
          aVal = a.count; bVal = b.count; break;
        case 'totalHours':
          aVal = a.totalHours; bVal = b.totalHours; break;
        case 'avgHours':
          aVal = a.avgHours; bVal = b.avgHours; break;
        case 'grossBillables':
          aVal = a.grossBillables; bVal = b.grossBillables; break;
        case 'percentage':
          aVal = a.percentage; bVal = b.percentage; break;
        default:
          aVal = a.totalHours; bVal = b.totalHours;
      }
      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  }, [matterBreakdown, sortConfig]);

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const totalHours = matterBreakdown.reduce((sum, m) => sum + m.totalHours, 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading category data...</div>
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
                  <Layers className="w-6 h-6 text-blue-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">{categoryName}</h1>
                  <p className="text-sm text-gray-500">
                    {matterBreakdown.length} matter{matterBreakdown.length !== 1 ? 's' : ''} &middot;{' '}
                    <CalcTooltip calcKey="billableHours" variant="underline" position="bottom">
                      {formatHours(totalHours)}h total
                    </CalcTooltip>
                  </p>
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

      {/* Matters Table */}
      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {sortedMatters.length > 0 ? (
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th
                      onClick={() => handleSort('matter')}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      Matter{getSortIndicator('matter')}
                    </th>
                    <th
                      onClick={() => handleSort('clientName')}
                      className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      Client{getSortIndicator('clientName')}
                    </th>
                    <th
                      onClick={() => handleSort('avgHours')}
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        Avg Hours{getSortIndicator('avgHours')}
                        <CalcTooltip calcKey="avgHoursPerTransaction" position="bottom" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('count')}
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      Count{getSortIndicator('count')}
                    </th>
                    <th
                      onClick={() => handleSort('totalHours')}
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        Total Hours{getSortIndicator('totalHours')}
                        <CalcTooltip calcKey="billableHours" position="bottom" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('grossBillables')}
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        Total Earnings{getSortIndicator('grossBillables')}
                        <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
                      </span>
                    </th>
                    <th
                      onClick={() => handleSort('percentage')}
                      className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
                    >
                      <span className="inline-flex items-center gap-1">
                        % of Total{getSortIndicator('percentage')}
                        <CalcTooltip calcKey="pctOfTotalTransactions" position="bottom" align="right" />
                      </span>
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {sortedMatters.map((matter, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-blue-50 transition-colors"
                      onMouseEnter={(e) => {
                        setHoveredMatter(matter);
                        setTooltipPosition({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseMove={(e) => {
                        setTooltipPosition({ x: e.clientX, y: e.clientY });
                      }}
                      onMouseLeave={() => setHoveredMatter(null)}
                    >
                      <td className="px-6 py-4 text-sm font-medium text-gray-900 max-w-[300px] truncate" title={matter.matter}>
                        {matter.matter}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <Link
                          href={`/clients/${encodeURIComponent(matter.clientName)}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {matter.clientName}
                        </Link>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {formatHours(matter.avgHours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {matter.count}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900 text-right">
                        {formatHours(matter.totalHours)}h
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium text-right">
                        {formatCurrency(matter.grossBillables)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right">
                        {matter.percentage.toFixed(1)}%
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hoveredMatter && (
              <MatterRowTooltip
                matter={hoveredMatter}
                position={tooltipPosition}
              />
            )}
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow p-12 text-center">
            <Layers className="w-16 h-16 text-gray-300 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900 mb-2">No matters found</h3>
            <p className="text-gray-500">
              No time entries found for {categoryName} in the selected date range.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default CategoryDetailView;
