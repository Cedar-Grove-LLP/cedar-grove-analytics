"use client";

import { useState, useMemo } from 'react';
import {
  FileText,
  Calendar,
  Building2,
  DollarSign,
  Clock,
  User,
  Download,
  AlertTriangle
} from 'lucide-react';
import { useAllBillableEntries, useUsers } from '@/hooks/useFirestoreData';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { formatCurrency, formatHours, formatDate } from '@/utils/formatters';
import { sortBySeniority } from '@/utils/seniority.mjs';
import { downloadCSV } from '@/utils/csv';
import {
  isBillableRow,
  entryMonthKey,
  buildBillingRows,
  selectionHasAdjustments,
  computeBillingTotals,
  buildBillingCsvRows,
  billingSummaryFilename,
} from '@/utils/billingSummaryRows.mjs';
import { CalcTooltip } from '../shared';
import MonthlyAttorneyBillables from './MonthlyAttorneyBillables';

const BillingSummariesView = () => {
  const { data: allEntries, loading: entriesLoading, error: entriesError } = useAllBillableEntries();
  const { users: firebaseUsers } = useUsers();
  const { getRateInfo, rates, loading: ratesLoading } = useAttorneyRates();

  // Build userId -> display name map
  const userMap = useMemo(() => {
    const map = {};
    (firebaseUsers || []).forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [firebaseUsers]);
  
  // Selected month and client state
  const [selectedMonth, setSelectedMonth] = useState(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  });
  const [selectedClient, setSelectedClient] = useState('');

  const loading = entriesLoading || ratesLoading;

  // Get all available months from entries
  const availableMonths = useMemo(() => {
    if (!allEntries) return [];

    const monthSet = new Set();
    allEntries.forEach(entry => {
      if (isBillableRow(entry)) {
        monthSet.add(entryMonthKey(entry));
      }
    });

    return Array.from(monthSet).sort().reverse();
  }, [allEntries]);

  // Get clients with billable entries in the selected month
  const clientsInMonth = useMemo(() => {
    if (!allEntries || !selectedMonth) return [];

    const clientSet = new Set();
    allEntries.forEach(entry => {
      if (isBillableRow(entry) && entryMonthKey(entry) === selectedMonth) {
        const clientName = entry.client || 'Unknown';
        clientSet.add(clientName);
      }
    });

    return Array.from(clientSet).sort();
  }, [allEntries, selectedMonth]);

  // Build invoice-prep rows for the selected month and client (pure logic in
  // utils/billingSummaryRows.mjs). rateMissing rows bill at $0 and must be
  // flagged, not hidden.
  const filteredEntries = useMemo(
    () => buildBillingRows(allEntries, {
      month: selectedMonth,
      client: selectedClient,
      userMap,
      getRateInfo,
    }),
    [allEntries, selectedMonth, selectedClient, getRateInfo, userMap]
  );

  // Only show the Adjustment column when the selection actually has one
  // (McClure months) — every other bill keeps the familiar layout.
  const hasAdjustments = useMemo(
    () => selectionHasAdjustments(filteredEntries),
    [filteredEntries]
  );

  // Attorneys in the rendered selection whose hours bill at $0 because no
  // usable rate covers the month — mirrors the Overview's admin banner so
  // invoice prep never relies on a silently understated Amount column.
  const missingRateAttorneys = useMemo(() => {
    const byName = new Map();
    filteredEntries.forEach(entry => {
      if (!entry.rateMissing) return;
      byName.set(entry.attorneyName, (byName.get(entry.attorneyName) || 0) + entry.billableHours);
    });
    return sortBySeniority(
      [...byName.entries()].map(([name, hours]) => ({ name, hours })),
      (a) => a.name,
    );
  }, [filteredEntries]);

  // Calculate totals
  const totals = useMemo(() => computeBillingTotals(filteredEntries), [filteredEntries]);

  // Format month for display
  const formatMonthDisplay = (monthKey) => {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Export to CSV (row assembly in utils/billingSummaryRows.mjs)
  const exportToCSV = () => {
    if (filteredEntries.length === 0) return;

    const { headers, rows } = buildBillingCsvRows(filteredEntries);
    downloadCSV(billingSummaryFilename(selectedClient, selectedMonth), headers, rows);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-cg-green" aria-hidden="true"></div>
          <div className="mt-4 text-xl text-cg-dark">Loading billing data...</div>
        </div>
      </div>
    );
  }

  if (entriesError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center" role="alert">
        <div className="text-red-600 text-xl mb-2">Error loading data</div>
        <div className="text-red-600">{entriesError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cg-green/10 rounded-lg">
            <FileText className="w-6 h-6 text-cg-green" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-cg-black">Billing Summaries</h1>
            <p className="text-sm text-cg-dark">Generate detailed billing breakdowns by month and client</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-lg shadow p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Month Selector */}
          <div>
            <label htmlFor="bs-month-select" className="block text-sm font-medium text-cg-dark mb-2">
              <Calendar className="w-4 h-4 inline mr-2" />
              Select Month
            </label>
            <select
              id="bs-month-select"
              value={selectedMonth}
              onChange={(e) => {
                setSelectedMonth(e.target.value);
                setSelectedClient(''); // Reset client when month changes
              }}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cg-green focus:border-transparent bg-white"
            >
              <option value="">Select a month...</option>
              {availableMonths.map(month => (
                <option key={month} value={month}>
                  {formatMonthDisplay(month)}
                </option>
              ))}
            </select>
          </div>

          {/* Client Selector */}
          <div>
            <label htmlFor="bs-client-select" className="block text-sm font-medium text-cg-dark mb-2">
              <Building2 className="w-4 h-4 inline mr-2" />
              Select Client
            </label>
            <select
              id="bs-client-select"
              value={selectedClient}
              onChange={(e) => setSelectedClient(e.target.value)}
              disabled={!selectedMonth}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cg-green focus:border-transparent bg-white disabled:bg-gray-100 disabled:cursor-not-allowed"
            >
              <option value="">
                {selectedMonth ? 'Select a client...' : 'Select a month first'}
              </option>
              {clientsInMonth.map(client => (
                <option key={client} value={client}>
                  {client}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Firm-wide monthly attorney billables */}
      <MonthlyAttorneyBillables />

      {/* Results */}
      {selectedMonth && selectedClient && (
        <>
          {/* Rows below bill at $0 when no usable rate covers the month —
              flag it where invoices are prepared (same styling as the
              Overview banner). */}
          {missingRateAttorneys.length > 0 && (
            <div className="px-4 py-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-800" role="status">
              <div className="flex items-center gap-2 font-medium">
                <AlertTriangle className="w-5 h-5 flex-shrink-0 text-amber-600" />
                <span>
                  No billing rate covers {formatMonthDisplay(selectedMonth)} for{' '}
                  {missingRateAttorneys.map((a) => `${a.name} (${formatHours(a.hours)}h)`).join(', ')} —
                  their Amounts below read $0 and the totals are understated.
                </span>
              </div>
            </div>
          )}

          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cg-dark text-sm font-medium">Total Entries</span>
                <FileText className="w-5 h-5 text-blue-500" />
              </div>
              <div className="text-2xl font-bold text-cg-black">{filteredEntries.length}</div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cg-dark text-sm font-medium inline-flex items-center gap-1">
                  Total Hours
                  <CalcTooltip calcKey="billableHours" position="bottom" />
                </span>
                <Clock className="w-5 h-5 text-purple-500" />
              </div>
              <div className="text-2xl font-bold text-cg-black">{formatHours(totals.hours)}h</div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cg-dark text-sm font-medium inline-flex items-center gap-1">
                  Total Billables
                  <CalcTooltip calcKey="billingSummaryAmount" position="bottom" />
                </span>
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              <div className="text-2xl font-bold text-green-700">{formatCurrency(totals.amount)}</div>
              {hasAdjustments && (
                <div className="text-xs text-gray-500 mt-1">
                  includes {formatCurrency(totals.adjustment)} in adjustments
                </div>
              )}
            </div>
          </div>

          {/* Export Button */}
          {filteredEntries.length > 0 && (
            <div className="flex justify-end">
              <button
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-cg-dark text-white rounded-lg hover:bg-gray-700 transition-colors"
              >
                <Download className="w-4 h-4" />
                Export to CSV
              </button>
            </div>
          )}

          {/* Entries Table */}
          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
              <h3 className="text-lg font-semibold text-cg-black">
                Billing Details: {selectedClient} - {formatMonthDisplay(selectedMonth)}
              </h3>
            </div>

            {filteredEntries.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                No billable entries found for this selection.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200" aria-label={`Billing details for ${selectedClient}, ${formatMonthDisplay(selectedMonth)}`}>
                  <thead className="bg-gray-50">
                    <tr>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Attorney
                      </th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1">
                          Rate
                          <CalcTooltip calcKey="billingRate" position="bottom" />
                        </span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1">
                          Hours
                          <CalcTooltip calcKey="billableHours" position="bottom" align="right" />
                        </span>
                      </th>
                      {hasAdjustments && (
                        <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                          <span className="inline-flex items-center gap-1">
                            Adjustment
                            <CalcTooltip calcKey="entryAdjustment" position="bottom" align="right" />
                          </span>
                        </th>
                      )}
                      <th scope="col" className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        <span className="inline-flex items-center gap-1">
                          Amount
                          <CalcTooltip calcKey="billingSummaryAmount" position="bottom" align="right" />
                        </span>
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredEntries.map((entry, idx) => (
                      <tr key={idx} className="hover:bg-gray-50">
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600">
                          {entry.date.toLocaleDateString('en-US', { 
                            month: 'short', 
                            day: 'numeric',
                            year: 'numeric'
                          })}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                          {entry.attorneyName}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-600 text-right">
                          {entry.rate > 0 ? `${formatCurrency(entry.rate)}/hr` : <span className="text-red-600">No rate set</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                          {formatHours(entry.billableHours)}h
                        </td>
                        {hasAdjustments && (
                          <td className={`px-6 py-4 whitespace-nowrap text-sm text-right font-medium ${entry.adjustment < 0 ? 'text-red-600' : entry.adjustment > 0 ? 'text-gray-900' : 'text-gray-400'}`}>
                            {entry.adjustment !== 0 ? formatCurrency(entry.adjustment) : '—'}
                          </td>
                        )}
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 text-right font-medium">
                          {formatCurrency(entry.amount)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          <span className="inline-flex px-2 py-1 text-xs rounded-full bg-blue-100 text-blue-800">
                            {entry.category}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-600 max-w-md">
                          <div className="truncate" title={entry.notes}>
                            {entry.notes || '-'}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 border-t-2 border-gray-300">
                    <tr>
                      <td colSpan={3} className="px-6 py-4 text-sm font-semibold text-gray-900">
                        Totals
                      </td>
                      <td className="px-6 py-4 text-sm font-bold text-gray-900 text-right">
                        {formatHours(totals.hours)}h
                      </td>
                      {hasAdjustments && (
                        <td className={`px-6 py-4 text-sm font-bold text-right ${totals.adjustment < 0 ? 'text-red-600' : 'text-gray-900'}`}>
                          {formatCurrency(totals.adjustment)}
                        </td>
                      )}
                      <td className="px-6 py-4 text-sm font-bold text-green-700 text-right">
                        {formatCurrency(totals.amount)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* Empty State */}
      {(!selectedMonth || !selectedClient) && (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <FileText className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Select a month and client</h3>
          <p className="text-gray-500">
            Choose a month and client above to view their billing summary.
          </p>
        </div>
      )}
    </div>
  );
};

export default BillingSummariesView;