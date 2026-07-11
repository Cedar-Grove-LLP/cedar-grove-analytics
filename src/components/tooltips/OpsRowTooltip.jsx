import { formatHours, formatDate } from '../../utils/formatters';

const OpsRowTooltip = ({ ops, position }) => {
  if (!ops) return null;

  const attorneyBreakdown = Object.entries(ops.byAttorney || {})
    .sort((a, b) => b[1].hours - a[1].hours);

  return (
    <div 
      className="fixed z-50 bg-white border border-gray-300 rounded-xl shadow-2xl p-5"
      style={{ 
        left: Math.min(position.x + 15, window.innerWidth - 650),
        top: Math.max(10, Math.min(position.y - 200, window.innerHeight - 550)),
        width: '600px',
      }}
    >
      {/* Header */}
      <div className="font-bold text-gray-900 text-xl mb-4 pb-3 border-b-2 border-green-200">
        {ops.category}
        <span className="text-sm font-normal text-gray-500 ml-3">
          {ops.count} entries • {formatHours(ops.hours)}h • {ops.percentage}% of total
        </span>
      </div>
      
      {/* Attorney Breakdown - Horizontal */}
      <div className="mb-4">
        <div className="text-sm font-semibold text-gray-700 mb-2">By Attorney:</div>
        <div className="flex flex-wrap gap-2">
          {attorneyBreakdown.map(([attorney, stats]) => (
            <div key={attorney} className="inline-flex items-center bg-green-50 px-3 py-1.5 rounded-full text-sm">
              <span className="font-medium text-gray-800">{attorney}</span>
              <span className="text-gray-500 ml-2">({stats.count})</span>
              <span className="text-green-700 font-semibold ml-2">{formatHours(stats.hours)}h</span>
            </div>
          ))}
        </div>
      </div>

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
              <th className="px-3 py-2 text-left font-semibold">Notes</th>
              <th className="px-3 py-2 text-right font-semibold">Hours</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(ops.entries || []).slice(0, 10).map((entry, idx) => (
              <tr key={idx} className="hover:bg-green-50">
                <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(entry.date)}</td>
                <td className="px-3 py-2 font-medium text-gray-800">{entry.attorney}</td>
                <td className="px-3 py-2 text-gray-700 truncate max-w-[250px]" title={entry.notes}>{entry.notes || '-'}</td>
                <td className="px-3 py-2 text-right text-gray-900 font-medium">{formatHours(entry.hours)}h</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ops.count > 10 && (
          <div className="text-xs text-gray-500 mt-2 text-center">
            Showing 10 of {ops.count} entries
          </div>
        )}
      </div>
    </div>
  );
};

export default OpsRowTooltip;
