import { formatCurrency, formatHours, formatDate } from '../../utils/formatters';

const MatterRowTooltip = ({ matter, position, id, onMouseEnter, onMouseLeave }) => {
  if (!matter) return null;

  const attorneyBreakdown = Object.entries(matter.byAttorney || {})
    .sort((a, b) => b[1].hours - a[1].hours);

  return (
    <div
      role="tooltip"
      id={id}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className="fixed z-50 bg-white border border-gray-300 rounded-xl shadow-2xl p-5"
      style={{
        left: Math.max(10, Math.min(position.x + 15, window.innerWidth - 750)),
        top: Math.max(10, Math.min(position.y - 200, window.innerHeight - 550)),
        width: '700px',
      }}
    >
      {/* Header */}
      <div className="font-bold text-gray-900 text-xl mb-1 pb-3 border-b-2 border-blue-200">
        {matter.matter}
        <div className="text-sm font-normal text-gray-500 mt-1">
          {matter.clientName}
          <span className="ml-3">
            {matter.count} entries • {formatHours(matter.totalHours)}h • {formatCurrency(matter.totalEarnings)}
          </span>
        </div>
      </div>

      {/* Attorney Breakdown - Horizontal */}
      {attorneyBreakdown.length > 0 && (
        <div className="mb-4 mt-3">
          <div className="text-sm font-semibold text-gray-700 mb-2">By Attorney:</div>
          <div className="flex flex-wrap gap-2">
            {attorneyBreakdown.map(([attorney, stats]) => (
              <div key={attorney} className="inline-flex items-center bg-gray-100 px-3 py-1.5 rounded-full text-sm">
                <span className="font-medium text-gray-800">{attorney}</span>
                <span className="text-gray-500 ml-2">({stats.count})</span>
                <span className="text-blue-600 font-semibold ml-2">{formatHours(stats.hours)}h</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recent Entries Table */}
      <div>
        <div className="text-sm font-semibold text-gray-700 mb-2">
          Recent Entries:
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
              <th className="px-3 py-2 text-left font-semibold">Date</th>
              <th className="px-3 py-2 text-left font-semibold">Attorney</th>
              <th className="px-3 py-2 text-right font-semibold">Hours</th>
              <th className="px-3 py-2 text-right font-semibold">Earnings</th>
              <th className="px-3 py-2 text-left font-semibold">Notes</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(matter.entries || []).slice(0, 10).map((entry, idx) => (
              <tr key={idx} className="hover:bg-blue-50">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(entry.date)}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{entry.attorney}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-medium">{formatHours(entry.hours)}h</td>
                <td className="px-3 py-2 text-right text-green-700 font-medium">{formatCurrency(entry.earnings)}</td>
                <td className="px-3 py-2 text-gray-600 truncate max-w-[200px]" title={entry.notes}>{entry.notes || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {matter.count > 10 && (
          <div className="text-xs text-gray-500 mt-2 text-center">
            Showing 10 of {matter.count} entries
          </div>
        )}
      </div>
    </div>
  );
};

export default MatterRowTooltip;
