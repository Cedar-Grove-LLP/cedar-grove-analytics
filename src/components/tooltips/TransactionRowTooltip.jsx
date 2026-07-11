import { formatCurrency, formatHours } from '../../utils/formatters';

const TransactionRowTooltip = ({ transaction, position }) => {
  if (!transaction) return null;

  const matterList = Object.values(transaction.matters || {})
    .sort((a, b) => b.totalHours - a.totalHours);

  return (
    <div
      className="fixed z-50 bg-white border border-gray-300 rounded-xl shadow-2xl p-5"
      style={{
        left: Math.min(position.x + 15, window.innerWidth - 650),
        top: Math.max(10, Math.min(position.y - 200, window.innerHeight - 450)),
        width: '620px',
      }}
    >
      {/* Header */}
      <div className="font-bold text-gray-900 text-xl mb-4 pb-3 border-b-2 border-blue-200">
        {transaction.type}
        <span className="text-sm font-normal text-gray-500 ml-3">
          {transaction.matterCount} matter{transaction.matterCount !== 1 ? 's' : ''} • {formatHours(transaction.totalHours)}h • {formatCurrency(transaction.totalEarnings)}
        </span>
      </div>

      {/* Matters Table */}
      {matterList.length > 0 ? (
        <div>
          <div className="text-sm font-semibold text-gray-700 mb-2">Matters:</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-100 text-gray-600 text-xs uppercase">
                <th className="px-3 py-2 text-left font-semibold">Matter</th>
                <th className="px-3 py-2 text-left font-semibold">Client</th>
                <th className="px-3 py-2 text-right font-semibold">Entries</th>
                <th className="px-3 py-2 text-right font-semibold">Hours</th>
                <th className="px-3 py-2 text-right font-semibold">Earnings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {matterList.slice(0, 10).map((m, idx) => (
                <tr key={idx} className="hover:bg-blue-50">
                  <td className="px-3 py-2 font-medium text-gray-800 truncate max-w-[200px]" title={m.matter}>{m.matter}</td>
                  <td className="px-3 py-2 text-gray-700 truncate max-w-[140px]" title={m.clientName}>{m.clientName}</td>
                  <td className="px-3 py-2 text-right text-gray-600">{m.count}</td>
                  <td className="px-3 py-2 text-right text-gray-900 font-medium">{formatHours(m.totalHours)}h</td>
                  <td className="px-3 py-2 text-right text-green-700 font-medium">{formatCurrency(m.totalEarnings)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {matterList.length > 10 && (
            <div className="text-xs text-gray-500 mt-2 text-center">
              Showing 10 of {matterList.length} matters
            </div>
          )}
        </div>
      ) : (
        <div className="text-sm text-gray-500">No matters recorded</div>
      )}
    </div>
  );
};

export default TransactionRowTooltip;
