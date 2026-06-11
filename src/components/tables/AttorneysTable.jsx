"use client";

import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { getUtilizationBgColor } from '@/utils/statusStyles';
import { CalcTooltip } from '../shared';

const AttorneysTable = ({
  attorneys,
  sortConfig,
  onSort,
  calculateUtilization,
  dataWarnings = {},
}) => {
  const router = useRouter();

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleAttorneyClick = (attorneyName) => {
    router.push(`/users/${encodeURIComponent(attorneyName)}`);
  };


  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <th 
              onClick={() => onSort('name')}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              Name {getSortIndicator('name')}
            </th>
            <th 
              onClick={() => onSort('billable')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                Billable {getSortIndicator('billable')}
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th 
              onClick={() => onSort('ops')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                Ops {getSortIndicator('ops')}
                <CalcTooltip calcKey="opsHours" position="bottom" />
              </span>
            </th>
            <th 
              onClick={() => onSort('total')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                Total {getSortIndicator('total')}
                <CalcTooltip calcKey="totalHours" position="bottom" />
              </span>
            </th>
            <th 
              onClick={() => onSort('earnings')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                Earnings {getSortIndicator('earnings')}
                <CalcTooltip calcKey="earnings" position="bottom" />
              </span>
            </th>
            <th 
              onClick={() => onSort('utilization')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
            >
              <span className="inline-flex items-center gap-1">
                Util. {getSortIndicator('utilization')}
                <CalcTooltip calcKey="utilizationPct" position="bottom" />
              </span>
            </th>
            <th className="w-[30%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
              Top Transactions
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {attorneys.map((attorney, idx) => {
            const utilization = calculateUtilization(attorney);
            const total = attorney.billable + attorney.ops;
            const warnings = dataWarnings[attorney.name];
            return (
              <tr
                key={idx}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                onClick={() => handleAttorneyClick(attorney.name)}
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  <div className="flex items-center gap-1.5">
                    <span className="font-medium text-gray-900 hover:underline">
                      {attorney.name}
                    </span>
                    {attorney.role && attorney.role !== 'Attorney' && (
                      <span className="text-xs text-gray-500 font-normal">
                        ({attorney.role})
                      </span>
                    )}
                    {warnings && warnings.length > 0 && (
                      <span className="relative group">
                        <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                        <span className="absolute bottom-full left-0 mb-2 hidden group-hover:block z-50 w-max max-w-xs sm:max-w-sm md:max-w-md p-2 bg-gray-900 text-white text-xs rounded shadow-lg whitespace-normal wrap-break-word">
                          {warnings.map((w, i) => (
                            <span key={i} className="block">{w.message}</span>
                          ))}
                        </span>
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatHours(attorney.billable)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatHours(attorney.ops)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatHours(total)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                  {formatCurrency(attorney.earnings)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {utilization === null ? (
                    <span
                      className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-500"
                      title={attorney.oooDays > 0 ? 'Out of office this period — no billable target' : 'No target for this period'}
                    >
                      N/A
                    </span>
                  ) : (
                    <span
                      className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getUtilizationBgColor(utilization)}`}
                    >
                      {utilization}%
                    </span>
                  )}
                </td>
                <td className="px-6 py-4 text-sm text-gray-900">
                  <div className="flex flex-wrap gap-1">
                    {attorney.topTransactions.slice(0, 3).map((txn, tIdx) => (
                      <span
                        key={tIdx}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs bg-gray-100 text-gray-700"
                      >
                        {tIdx + 1}. {txn}
                      </span>
                    ))}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default AttorneysTable;