"use client";

import { useState, useMemo } from 'react';
import { 
  FileText, 
  Calendar, 
  Building2, 
  DollarSign,
  Clock,
  User,
  Download
} from 'lucide-react';
import { useAllBillableEntries, useUsers } from '@/hooks/useFirestoreData';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { getEntryDate } from '@/utils/dateHelpers';
import { formatCurrency, formatHours, formatDate } from '@/utils/formatters';
import MonthlyAttorneyBillables from './MonthlyAttorneyBillables';

const BillingSummariesView = () => {
  const { data: allEntries, loading: entriesLoading, error: entriesError } = useAllBillableEntries();
  const { users: firebaseUsers } = useUsers();
  const { getRate, rates, loading: ratesLoading } = useAttorneyRates();

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
      if (entry.billableHours > 0) {
        const entryDate = getEntryDate(entry);
        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
        monthSet.add(monthKey);
      }
    });
    
    return Array.from(monthSet).sort().reverse();
  }, [allEntries]);

  // Get clients with billable entries in the selected month
  const clientsInMonth = useMemo(() => {
    if (!allEntries || !selectedMonth) return [];
    
    const clientSet = new Set();
    allEntries.forEach(entry => {
      if (entry.billableHours > 0) {
        const entryDate = getEntryDate(entry);
        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
        if (monthKey === selectedMonth) {
          const clientName = entry.client || 'Unknown';
          clientSet.add(clientName);
        }
      }
    });
    
    return Array.from(clientSet).sort();
  }, [allEntries, selectedMonth]);

  // Filter entries for selected month and client
  const filteredEntries = useMemo(() => {
    if (!allEntries || !selectedMonth || !selectedClient) return [];
    
    return allEntries
      .filter(entry => {
        if (entry.billableHours <= 0) return false;
        
        const entryDate = getEntryDate(entry);
        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
        if (monthKey !== selectedMonth) return false;
        
        const clientName = entry.client || 'Unknown';
        if (clientName !== selectedClient) return false;
        
        return true;
      })
      .map(entry => {
        const entryDate = getEntryDate(entry);
        const attorneyName = userMap[entry.userId] || entry.userId;
        const billableHours = entry.billableHours || 0;
        
        // Get the rate for this attorney and month
        const rate = getRate(attorneyName, entryDate);
        
        return {
          ...entry,
          attorneyName,
          rate,
          billableHours,
          grossBillables: rate * billableHours,
          date: entryDate,
          category: entry.billingCategory || entry.category || 'Other',
          notes: entry.notes || '',
        };
      })
      .sort((a, b) => a.date - b.date);
  }, [allEntries, selectedMonth, selectedClient, getRate, userMap]);

  // Calculate totals
  const totals = useMemo(() => {
    return filteredEntries.reduce(
      (acc, entry) => ({
        hours: acc.hours + entry.billableHours,
        grossBillables: acc.grossBillables + entry.grossBillables,
      }),
      { hours: 0, grossBillables: 0 }
    );
  }, [filteredEntries]);

  // Format month for display
  const formatMonthDisplay = (monthKey) => {
    if (!monthKey) return '';
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  };

  // Export to CSV
  const exportToCSV = () => {
    if (filteredEntries.length === 0) return;

    const headers = ['Date', 'Attorney', 'Rate', 'Hours', 'Amount', 'Category', 'Notes'];
    const rows = filteredEntries.map(entry => [
      entry.date.toLocaleDateString(),
      entry.attorneyName,
      entry.rate,
      entry.billableHours,
      entry.grossBillables.toFixed(2),
      entry.category,
      `"${(entry.notes || '').replace(/"/g, '""')}"`,
    ]);

    // Add totals row
    rows.push(['', '', '', totals.hours.toFixed(1), totals.grossBillables.toFixed(2), '', '']);

    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `billing-summary-${selectedClient.replace(/\s+/g, '-')}-${selectedMonth}.csv`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-cg-green"></div>
          <div className="mt-4 text-xl text-cg-dark">Loading billing data...</div>
        </div>
      </div>
    );
  }

  if (entriesError) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
        <div className="text-red-600 text-xl mb-2">Error loading data</div>
        <div className="text-red-500">{entriesError}</div>
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
            <label className="block text-sm font-medium text-cg-dark mb-2">
              <Calendar className="w-4 h-4 inline mr-2" />
              Select Month
            </label>
            <select
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
            <label className="block text-sm font-medium text-cg-dark mb-2">
              <Building2 className="w-4 h-4 inline mr-2" />
              Select Client
            </label>
            <select
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
                <span className="text-cg-dark text-sm font-medium">Total Hours</span>
                <Clock className="w-5 h-5 text-purple-500" />
              </div>
              <div className="text-2xl font-bold text-cg-black">{formatHours(totals.hours)}h</div>
            </div>

            <div className="bg-white p-4 rounded-lg shadow">
              <div className="flex items-center justify-between mb-2">
                <span className="text-cg-dark text-sm font-medium">Total Billables</span>
                <DollarSign className="w-5 h-5 text-green-500" />
              </div>
              <div className="text-2xl font-bold text-green-600">{formatCurrency(totals.grossBillables)}</div>
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
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Date
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Attorney
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Rate
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Hours
                      </th>
                      <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Amount
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        Category
                      </th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
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
                          {entry.rate > 0 ? `${formatCurrency(entry.rate)}/hr` : <span className="text-red-500">No rate set</span>}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 text-right font-medium">
                          {formatHours(entry.billableHours)}h
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 text-right font-medium">
                          {formatCurrency(entry.grossBillables)}
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
                      <td className="px-6 py-4 text-sm font-bold text-green-600 text-right">
                        {formatCurrency(totals.grossBillables)}
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