"use client";

import { useState, useMemo, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { LogOut, Shield, User } from 'lucide-react';
import { getDateRangeLabel } from '@/utils/dateHelpers';
import { useAnalyticsData } from '@/hooks/useAnalyticsData';
import { useAuth } from '@/context/AuthContext';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { DateRangeDropdown, AttorneyFilterDropdown } from './shared';
import { OverviewView, AttorneysView, TransactionsView, OpsView, ClientsView, DownloadsView, TargetsView } from './views';

const TRANSACTIONS_OPS_TABS = ['transactions', 'ops'];
const DEFAULT_DASHBOARD_DATE_RANGE = 'current-month';
const VALID_DATE_RANGES = new Set([
  'current-week',
  'last-week',
  'current-month',
  'last-month',
  'trailing-60',
  'all-time',
  'custom',
]);

const isValidDateInput = (value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;

  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return (
    date.getFullYear() === year &&
    date.getMonth() === month - 1 &&
    date.getDate() === day
  );
};

const getInitialDashboardDateRange = (searchParams) => {
  const dateRange = searchParams.get('dateRange');
  const customDateStart = searchParams.get('start') || '';
  const customDateEnd = searchParams.get('end') || '';

  if (!dateRange || !VALID_DATE_RANGES.has(dateRange)) {
    return {
      dateRange: DEFAULT_DASHBOARD_DATE_RANGE,
      customDateStart: '',
      customDateEnd: '',
    };
  }

  if (dateRange === 'custom') {
    const hasValidCustomRange =
      isValidDateInput(customDateStart) &&
      isValidDateInput(customDateEnd) &&
      customDateStart <= customDateEnd;

    return hasValidCustomRange
      ? { dateRange, customDateStart, customDateEnd }
      : {
          dateRange: DEFAULT_DASHBOARD_DATE_RANGE,
          customDateStart: '',
          customDateEnd: '',
        };
  }

  return {
    dateRange,
    customDateStart: '',
    customDateEnd: '',
  };
};

const AnalyticsDashboard = ({ downloadsOnly = false, transactionsOpsOnly = false }) => {
  const { user, isAdmin, signOut, userEmail } = useAuth();
  const { users } = useFirestoreCache();
  const router = useRouter();
  const searchParams = useSearchParams();

  const restrictedMode = downloadsOnly || transactionsOpsOnly;
  const initialDateRangeState = getInitialDashboardDateRange(searchParams);

  // For restricted-access users, find their attorney page name for the "My Analytics" link
  const matchedUserName = useMemo(() => {
    if (!restrictedMode || !userEmail || !users) return null;
    const matched = users.find(u => u.email && u.email.toLowerCase() === userEmail);
    return matched ? (matched.name || matched.id) : null;
  }, [restrictedMode, userEmail, users]);

  // Date range state
  const [dateRange, setDateRange] = useState(initialDateRangeState.dateRange);
  const [customDateStart, setCustomDateStart] = useState(initialDateRangeState.customDateStart);
  const [customDateEnd, setCustomDateEnd] = useState(initialDateRangeState.customDateEnd);
  const [showDateDropdown, setShowDateDropdown] = useState(false);

  // Attorney filter state - start with empty array, will default to all attorneys
  const [globalAttorneyFilter, setGlobalAttorneyFilter] = useState([]);
  const [showAttorneyDropdown, setShowAttorneyDropdown] = useState(false);

  // Transaction filter state
  const [transactionAttorneyFilter, setTransactionAttorneyFilter] = useState('all');

  // View state — read initial tab from URL query param (?tab=clients)
  const VALID_TABS = ['overview', 'attorneys', 'transactions', 'ops', 'clients', 'downloads', 'targets'];
  const defaultTab = downloadsOnly ? 'downloads' : transactionsOpsOnly ? 'transactions' : 'overview';
  const tabFromUrl = searchParams.get('tab');
  const initialTab = tabFromUrl && VALID_TABS.includes(tabFromUrl) ? tabFromUrl : defaultTab;
  const [selectedView, setSelectedView] = useState(initialTab);

  const updateDashboardUrl = useCallback((overrides = {}) => {
    if (typeof window === 'undefined') return;

    const nextTab = overrides.selectedView ?? selectedView;
    const nextDateRange = overrides.dateRange ?? dateRange;
    const nextCustomDateStart = overrides.customDateStart ?? customDateStart;
    const nextCustomDateEnd = overrides.customDateEnd ?? customDateEnd;
    const params = new URLSearchParams(window.location.search);

    if (nextTab === defaultTab) {
      params.delete('tab');
    } else {
      params.set('tab', nextTab);
    }

    if (nextDateRange === DEFAULT_DASHBOARD_DATE_RANGE) {
      params.delete('dateRange');
      params.delete('start');
      params.delete('end');
    } else {
      params.set('dateRange', nextDateRange);

      if (nextDateRange === 'custom') {
        params.set('start', nextCustomDateStart);
        params.set('end', nextCustomDateEnd);
      } else {
        params.delete('start');
        params.delete('end');
      }
    }

    const queryString = params.toString();
    const nextUrl = queryString
      ? `${window.location.pathname}?${queryString}`
      : window.location.pathname;

    window.history.replaceState(null, '', nextUrl);
  }, [customDateEnd, customDateStart, dateRange, defaultTab, selectedView]);

  const handleDateRangeChange = useCallback((nextDateRange) => {
    setDateRange(nextDateRange);
    updateDashboardUrl({ dateRange: nextDateRange });
  }, [updateDashboardUrl]);

  const handleCustomDateStartChange = useCallback((nextCustomDateStart) => {
    setCustomDateStart(nextCustomDateStart);

    if (dateRange === 'custom') {
      updateDashboardUrl({ customDateStart: nextCustomDateStart });
    }
  }, [dateRange, updateDashboardUrl]);

  const handleCustomDateEndChange = useCallback((nextCustomDateEnd) => {
    setCustomDateEnd(nextCustomDateEnd);

    if (dateRange === 'custom') {
      updateDashboardUrl({ customDateEnd: nextCustomDateEnd });
    }
  }, [dateRange, updateDashboardUrl]);

  const switchTab = useCallback((tab) => {
    setSelectedView(tab);
    updateDashboardUrl({ selectedView: tab });
  }, [updateDashboardUrl]);

  // Fetch and process data
  const {
    loading,
    error,
    allAttorneyNames,
    filteredBillableEntries,
    filteredOpsEntries,
    attorneyData,
    transactionData,
    matterData,
    downloadData,
    attorneyDownloadData,
    opsData,
    clientData,
    clientCounts,
    calculateUtilization,
    priorPeriodBillableEntries,
    hasPriorPeriod,
    periodRevenueAccrued,
    periodAttorneyBillables,
  } = useAnalyticsData({
    dateRange,
    customDateStart,
    customDateEnd,
    globalAttorneyFilter,
    transactionAttorneyFilter,
  });

  // Effective attorney filter - defaults to all attorneys when empty
  const effectiveAttorneyFilter = useMemo(() => {
    if (globalAttorneyFilter.length === 0 && allAttorneyNames.length > 0) {
      return [...allAttorneyNames];
    }
    return globalAttorneyFilter;
  }, [globalAttorneyFilter, allAttorneyNames]);

  const handleLogout = async () => {
    await signOut();
    router.refresh();
  };

  const dateRangeLabel = getDateRangeLabel(dateRange, customDateStart, customDateEnd);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-cg-background">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-cg-green"></div>
          <div className="mt-4 text-xl text-cg-dark">Loading analytics data...</div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="flex items-center justify-center h-screen bg-cg-background">
        <div className="text-center max-w-md">
          <div className="text-red-600 text-xl mb-4">Error loading data</div>
          <div className="text-cg-dark mb-4">{error}</div>
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-cg-green text-white rounded hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  // No data state (skip for downloads-only users who don't need billable/ops entries)
  if (!downloadsOnly && !transactionsOpsOnly && (!filteredBillableEntries || filteredBillableEntries.length === 0) && (!filteredOpsEntries || filteredOpsEntries.length === 0)) {
    return (
      <div className="min-h-screen bg-cg-background px-4 py-6">
        <div className="max-w-[88rem] mx-auto">
          <Header
            showDateDropdown={showDateDropdown}
            setShowDateDropdown={setShowDateDropdown}
            dateRange={dateRange}
            setDateRange={handleDateRangeChange}
            customDateStart={customDateStart}
            setCustomDateStart={handleCustomDateStartChange}
            customDateEnd={customDateEnd}
            setCustomDateEnd={handleCustomDateEndChange}
            showAttorneyDropdown={showAttorneyDropdown}
            setShowAttorneyDropdown={setShowAttorneyDropdown}
            allAttorneyNames={allAttorneyNames || []}
            globalAttorneyFilter={effectiveAttorneyFilter}
            setGlobalAttorneyFilter={setGlobalAttorneyFilter}
            isAdmin={isAdmin}
            user={user}
            onLogout={handleLogout}
          />

          <div className="flex items-center justify-center py-20">
            <div className="text-center max-w-md">
              <div className="text-cg-dark text-xl mb-4">No data available</div>
              <div className="text-gray-500">
                No time entries found for the selected date range. Try selecting a different time period above.
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cg-background px-4 py-6">
      <div className="max-w-[88rem] mx-auto">
        <Header
          showDateDropdown={showDateDropdown}
          setShowDateDropdown={setShowDateDropdown}
          dateRange={dateRange}
          setDateRange={handleDateRangeChange}
          customDateStart={customDateStart}
          setCustomDateStart={handleCustomDateStartChange}
          customDateEnd={customDateEnd}
          setCustomDateEnd={handleCustomDateEndChange}
          showAttorneyDropdown={showAttorneyDropdown}
          setShowAttorneyDropdown={setShowAttorneyDropdown}
          allAttorneyNames={allAttorneyNames || []}
          globalAttorneyFilter={effectiveAttorneyFilter}
          setGlobalAttorneyFilter={setGlobalAttorneyFilter}
          isAdmin={isAdmin}
          user={user}
          onLogout={handleLogout}
          downloadsOnly={downloadsOnly}
          transactionsOpsOnly={transactionsOpsOnly}
          matchedUserName={matchedUserName}
        />

        {/* Navigation Tabs */}
        <div className="mb-6 flex gap-2 border-b border-gray-300">
          {[
            { key: 'overview', label: 'Overview' },
            { key: 'attorneys', label: 'Team Members' },
            { key: 'transactions', label: 'Transactions' },
            { key: 'ops', label: 'Ops' },
            { key: 'clients', label: 'Clients' },
            { key: 'downloads', label: 'Downloads' },
            { key: 'targets', label: 'Targets', adminOnly: true },
          ].filter(tab => {
            if (downloadsOnly) return tab.key === 'downloads';
            if (transactionsOpsOnly) return TRANSACTIONS_OPS_TABS.includes(tab.key);
            if (tab.adminOnly && !isAdmin) return false;
            return true;
          }).map((tab) => (
            <button
              key={tab.key}
              onClick={() => switchTab(tab.key)}
              className={`px-4 py-2 font-medium transition-colors ${
                selectedView === tab.key
                  ? 'text-cg-green border-b-2 border-cg-green'
                  : 'text-cg-dark hover:text-cg-black'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Views */}
        {selectedView === 'overview' && (
          <OverviewView
            dateRange={dateRange}
            dateRangeLabel={dateRangeLabel}
            filteredEntriesCount={(filteredBillableEntries?.length || 0) + (filteredOpsEntries?.length || 0)}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            periodRevenueAccrued={periodRevenueAccrued}
            periodAttorneyBillables={periodAttorneyBillables}
            attorneyData={attorneyData}
            transactionData={transactionData}
          />
        )}

        {selectedView === 'attorneys' && (
          <AttorneysView
            dateRangeLabel={dateRangeLabel}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            attorneyData={attorneyData}
            calculateUtilization={calculateUtilization}
          />
        )}

        {selectedView === 'transactions' && (
          <TransactionsView
            dateRangeLabel={dateRangeLabel}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            transactionData={transactionData}
            matterData={matterData}
          />
        )}

        {selectedView === 'ops' && (
          <OpsView
            dateRangeLabel={dateRangeLabel}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            opsData={opsData}
          />
        )}

        {selectedView === 'clients' && (
          <ClientsView
            dateRangeLabel={dateRangeLabel}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            clientData={clientData}
            clientCounts={clientCounts}
            filteredBillableEntries={filteredBillableEntries}
            priorPeriodBillableEntries={priorPeriodBillableEntries}
            hasPriorPeriod={hasPriorPeriod}
          />
        )}

        {selectedView === 'downloads' && (
          <DownloadsView
            dateRangeLabel={dateRangeLabel}
            globalAttorneyFilter={effectiveAttorneyFilter}
            allAttorneyNames={allAttorneyNames}
            downloadData={downloadData}
            attorneyDownloadData={attorneyDownloadData}
          />
        )}

        {selectedView === 'targets' && isAdmin && <TargetsView />}
      </div>
    </div>
  );
};

// Header component
const Header = ({
  showDateDropdown,
  setShowDateDropdown,
  dateRange,
  setDateRange,
  customDateStart,
  setCustomDateStart,
  customDateEnd,
  setCustomDateEnd,
  showAttorneyDropdown,
  setShowAttorneyDropdown,
  allAttorneyNames,
  globalAttorneyFilter,
  setGlobalAttorneyFilter,
  isAdmin,
  user,
  onLogout,
  downloadsOnly = false,
  transactionsOpsOnly = false,
  matchedUserName = null,
}) => {
  const restrictedMode = downloadsOnly || transactionsOpsOnly;

  return (
    <div className="mb-8 flex justify-between items-start">
      <div>
        <h1 className="text-3xl font-bold text-cg-black">Cedar Grove Analytics</h1>
      </div>

      <div className="flex items-center gap-4">
        {!downloadsOnly && (
          <AttorneyFilterDropdown
            allAttorneyNames={allAttorneyNames}
            globalAttorneyFilter={globalAttorneyFilter}
            setGlobalAttorneyFilter={setGlobalAttorneyFilter}
            showDropdown={showAttorneyDropdown}
            setShowDropdown={setShowAttorneyDropdown}
          />
        )}

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

        {restrictedMode ? (
          matchedUserName && (
            <Link
              href={`/users/${encodeURIComponent(matchedUserName)}`}
              className="flex items-center gap-2 px-4 py-2 bg-cg-dark text-white hover:bg-gray-700 rounded-lg transition-colors"
            >
              <User className="w-4 h-4" />
              <span className="text-sm font-medium">My Analytics</span>
            </Link>
          )
        ) : (
          <Link
            href="/admin"
            className="flex items-center gap-2 px-4 py-2 bg-cg-dark text-white hover:bg-gray-700 rounded-lg transition-colors"
          >
            <Shield className="w-4 h-4" />
            <span className="text-sm font-medium">Admin</span>
          </Link>
        )}

        {/* User status / Logout */}
        {user && !user.isAnonymous && (
          <div className="flex items-center gap-3">
            {user.photoURL && (
              <img
                src={user.photoURL}
                alt={user.displayName || 'User'}
                className="w-8 h-8 rounded-full"
              />
            )}
            <button
              onClick={onLogout}
              className="flex items-center gap-2 px-3 py-2 text-cg-dark hover:text-cg-black hover:bg-gray-200 rounded-lg transition-colors"
              title={`Logged in as ${user.email}`}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
};

export default AnalyticsDashboard;
