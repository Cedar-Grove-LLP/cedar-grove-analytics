"use client";

import { useState, useMemo } from 'react';
import { DollarSign, Calendar } from 'lucide-react';
import { useMonthlyMetrics } from '@/hooks/useFirestoreData';
import { getMonthNumber } from '@/utils/dateHelpers';
import { formatCurrency } from '@/utils/formatters';
import { hasAttorneyBillables } from '@/utils/billingSummary';
import { CalcTooltip } from '../shared';

// Firm-wide Attorney Billables by month, pulled directly from the source
// sheet (monthlyMetrics/all). Self-contained: its own month selector,
// independent of the per-client selectors in BillingSummariesView.
const MonthlyAttorneyBillables = () => {
  const { data: monthlyMetrics, loading, error } = useMonthlyMetrics();

  // Months that have a synced Attorney Billables figure, most recent first.
  const months = useMemo(() => {
    return (monthlyMetrics || [])
      .filter(hasAttorneyBillables)
      .map((entry) => {
        const monthNumber = getMonthNumber(entry.month);
        return {
          ...entry,
          monthNumber,
          key: `${entry.year}-${String(monthNumber).padStart(2, '0')}`,
        };
      })
      .sort((a, b) => b.year - a.year || b.monthNumber - a.monthNumber);
  }, [monthlyMetrics]);

  const [selectedKey, setSelectedKey] = useState(null);

  // Default to the most recent month; fall back if the stored key no
  // longer matches the available months.
  const effectiveKey = useMemo(() => {
    if (selectedKey && months.some((m) => m.key === selectedKey)) return selectedKey;
    return months[0]?.key || null;
  }, [selectedKey, months]);

  const selectedEntry = useMemo(
    () => months.find((m) => m.key === effectiveKey) || null,
    [months, effectiveKey]
  );

  const periodLabel = selectedEntry ? `${selectedEntry.month} ${selectedEntry.year}` : '';

  return (
    <div className="space-y-4">
      {/* Section header + month selector */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-cg-green/10 rounded-lg">
            <DollarSign className="w-6 h-6 text-cg-green" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-cg-black">Attorney Billables</h2>
            <p className="text-sm text-cg-dark">Firm-wide monthly attorney billables (from the source sheet)</p>
          </div>
        </div>

        {months.length > 0 && (
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-cg-dark" />
            <select
              value={effectiveKey || ''}
              onChange={(e) => setSelectedKey(e.target.value)}
              className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cg-green focus:border-transparent bg-white"
            >
              {months.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.month} {m.year}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Body */}
      {loading ? (
        <div className="bg-white rounded-lg shadow p-12 flex items-center justify-center">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-10 w-10 border-b-2 border-cg-green"></div>
            <div className="mt-4 text-cg-dark">Loading billables...</div>
          </div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-600">
          Could not load monthly billables: {error}
        </div>
      ) : months.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-12 text-center">
          <DollarSign className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <h3 className="text-lg font-medium text-gray-900 mb-2">Attorney billables not available yet</h3>
          <p className="text-gray-500 max-w-md mx-auto">
            Once the monthly sheet sync runs, the firm-wide attorney billables
            figure will appear here automatically.
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow p-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium text-cg-dark inline-flex items-center gap-1">
                Attorney Billables
                <CalcTooltip calcKey="totalBillablesAttorney" position="bottom" />
              </div>
              <div className="text-xs text-gray-500">{periodLabel}</div>
            </div>
            <div className="text-3xl font-bold text-cg-green tabular-nums">
              {formatCurrency(selectedEntry.attorneyBillables)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MonthlyAttorneyBillables;
