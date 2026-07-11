"use client";

import { formatCurrency, formatHours, formatDate } from '../../utils/formatters';

const ClientRowTooltip = ({ client, position }) => {
  if (!client || client.entryCount === 0) return null;

  const attorneyBreakdown = Object.entries(client.byAttorney || {})
    .sort((a, b) => b[1].hours - a[1].hours);
  
  const categoryBreakdown = Object.entries(client.byCategory || {})
    .sort((a, b) => b[1].hours - a[1].hours);

  return (
    <div 
      className="fixed z-50 bg-white border border-gray-300 rounded-xl shadow-2xl p-5"
      style={{ 
        left: Math.min(position.x + 15, window.innerWidth - 750),
        top: Math.max(10, Math.min(position.y - 200, window.innerHeight - 550)),
        width: '700px',
      }}
    >
      {/* Header */}
      <div className="font-bold text-gray-900 text-xl mb-4 pb-3 border-b-2 border-purple-200">
        {client.name}
        <span className="text-sm font-normal text-gray-500 ml-3">
          {client.entryCount} entries • {formatHours(client.billableHours || client.totalHours)}h • {formatCurrency(client.grossBillables || 0)}
        </span>
      </div>
      
      {/* Attorney Breakdown - Horizontal */}
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">By Attorney:</div>
        <div className="flex flex-wrap gap-2">
          {attorneyBreakdown.map(([attorney, stats]) => (
            <div key={attorney} className="inline-flex items-center bg-purple-50 px-3 py-1.5 rounded-full text-sm">
              <span className="font-medium text-gray-800">{attorney}</span>
              <span className="text-gray-500 ml-2">({stats.count})</span>
              <span className="text-purple-600 font-semibold ml-2">{formatHours(stats.hours)}h</span>
            </div>
          ))}
        </div>
      </div>
      
      {/* Category Breakdown - Horizontal */}
      {categoryBreakdown.length > 0 && (
        <div className="mb-4">
          <div className="text-sm font-semibold text-gray-700 mb-2">By Transaction Type:</div>
          <div className="flex flex-wrap gap-2">
            {categoryBreakdown.slice(0, 8).map(([category, stats]) => (
              <div key={category} className="inline-flex items-center bg-blue-50 px-3 py-1.5 rounded-full text-sm">
                <span className="font-medium text-gray-800">{category}</span>
                <span className="text-blue-600 font-semibold ml-2">{formatHours(stats.hours)}h</span>
              </div>
            ))}
            {categoryBreakdown.length > 8 && (
              <div className="inline-flex items-center bg-gray-100 px-3 py-1.5 rounded-full text-sm text-gray-500">
                +{categoryBreakdown.length - 8} more
              </div>
            )}
          </div>
        </div>
      )}

      {/* Recent Entries Table */}
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">
          Recent Transactions:
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Attorney</th>
              <th className="px-3 py-2 text-left font-semibold">Type</th>
              <th className="px-3 py-2 text-right font-semibold">Hours</th>
              <th className="px-3 py-2 text-right font-semibold">Billables</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(client.entries || []).slice(0, 10).map((entry, idx) => (
              <tr key={idx} className="hover:bg-purple-50">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(entry.date)}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{entry.attorney}</td>
                <td className="px-3 py-2 text-gray-700 truncate max-w-[150px]" title={entry.category}>{entry.category}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-medium">{formatHours(entry.billableHours || entry.totalHours)}h</td>
                <td className="px-3 py-2 text-right text-green-700 font-medium">{formatCurrency(entry.grossBillables || 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {client.entryCount > 10 && (
          <div className="text-xs text-gray-500 mt-2 text-center">
            Showing 10 of {client.entryCount} entries
          </div>
        )}
      </div>
    </div>
  );
};

export default ClientRowTooltip;