"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { getUtilizationBgColor } from '@/utils/statusStyles';
import { CalcTooltip } from '../shared';
import SortableTh from './SortableTh';

const AttorneysTable = ({
  attorneys,
  sortConfig,
  onSort,
  calculateUtilization,
  dataWarnings = {},
}) => {
  const router = useRouter();

  const handleAttorneyClick = (attorneyName) => {
    router.push(`/users/${encodeURIComponent(attorneyName)}`);
  };


  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Team members" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Name"
              sortKey="name"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            />
            <SortableTh
              label="Billable"
              sortKey="billable"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              <CalcTooltip calcKey="billableHours" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Ops"
              sortKey="ops"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              <CalcTooltip calcKey="opsHours" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Total"
              sortKey="total"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              <CalcTooltip calcKey="totalHours" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Earnings"
              sortKey="earnings"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              <CalcTooltip calcKey="earnings" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Util."
              sortKey="utilization"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap"
            >
              <CalcTooltip calcKey="utilizationPct" position="bottom" />
            </SortableTh>
            <th scope="col" className="w-[30%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
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
                <th scope="row" className="px-6 py-4 whitespace-nowrap text-sm font-normal text-left">
                  <div className="flex items-center gap-1.5">
                    <Link
                      href={`/users/${encodeURIComponent(attorney.name)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-gray-900 hover:underline"
                    >
                      {attorney.name}
                    </Link>
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
                </th>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatHours(attorney.billable)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {formatHours(attorney.ops)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatHours(total)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                  {formatCurrency(attorney.earnings)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm">
                  {utilization === null ? (
                    <span
                      className="inline-flex px-2 py-1 text-xs font-semibold rounded-full bg-gray-100 text-gray-600"
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