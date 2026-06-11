"use client";

import { useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { TransactionRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';

const TransactionsTable = ({
  transactions,
  sortConfig,
  onSort,
  totalHours
}) => {
  const [hoveredTransaction, setHoveredTransaction] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <th
              onClick={() => onSort('type')}
              className="w-[28%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Billing Category {getSortIndicator('type')}
            </th>
            <th
              onClick={() => onSort('avgHours')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Avg Hours {getSortIndicator('avgHours')}
                <CalcTooltip calcKey="avgHoursPerTransaction" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('count')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Matters {getSortIndicator('count')}
            </th>
            <th
              onClick={() => onSort('totalHours')}
              className="w-[14%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Total Hours {getSortIndicator('totalHours')}
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('totalEarnings')}
              className="w-[18%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Total Earnings {getSortIndicator('totalEarnings')}
                <CalcTooltip calcKey="earnings" position="bottom" align="right" />
              </span>
            </th>
            <th
              onClick={() => onSort('percentage')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                % of Total {getSortIndicator('percentage')}
                <CalcTooltip calcKey="pctOfTotalTransactions" position="bottom" align="right" />
              </span>
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {transactions.map((txn, idx) => {
            const percentage = totalHours > 0 ? ((txn.totalHours / totalHours) * 100).toFixed(1) : 0;
            return (
              <tr
                key={idx}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                onMouseEnter={(e) => {
                  setHoveredTransaction(txn);
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => setHoveredTransaction(null)}
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    href={`/categories/${encodeURIComponent(txn.type)}`}
                    className="text-gray-900 hover:underline"
                  >
                    {txn.type}
                  </Link>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {txn.avgHours}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {txn.count}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatHours(txn.totalHours)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                  {formatCurrency(txn.totalEarnings)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {percentage}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {hoveredTransaction && (
        <TransactionRowTooltip
          transaction={hoveredTransaction}
          position={tooltipPosition}
        />
      )}
    </div>
  );
};

export default TransactionsTable;
