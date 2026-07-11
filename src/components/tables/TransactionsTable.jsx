"use client";

import { useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { TransactionRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';
import SortableTh from './SortableTh';

const TransactionsTable = ({
  transactions,
  sortConfig,
  onSort,
  totalHours
}) => {
  const [hoveredTransaction, setHoveredTransaction] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Transaction types" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Billing Category"
              sortKey="type"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[28%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Avg Hours"
              sortKey="avgHours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="avgHoursPerTransaction" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Matters"
              sortKey="count"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Total Hours"
              sortKey="totalHours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[14%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="billableHours" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Total Earnings"
              sortKey="totalEarnings"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[18%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="earnings" position="bottom" align="right" />
            </SortableTh>
            <SortableTh
              label="% of Total"
              sortKey="percentage"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="pctOfTotalTransactions" position="bottom" align="right" />
            </SortableTh>
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
                <th scope="row" className="px-6 py-4 whitespace-nowrap text-sm font-medium text-left">
                  <Link
                    href={`/categories/${encodeURIComponent(txn.type)}`}
                    className="text-gray-900 hover:underline"
                  >
                    {txn.type}
                  </Link>
                </th>
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
