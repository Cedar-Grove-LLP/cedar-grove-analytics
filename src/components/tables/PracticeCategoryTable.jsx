"use client";

import Link from 'next/link';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { TransactionRowTooltip, useRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';
import { PRACTICE_AREA_COLORS, GRAY } from '../../utils/colors';
import SortableTh from './SortableTh';

const PracticeCategoryTable = ({
  categories,
  sortConfig,
  onSort,
  totalHours,
}) => {
  // Row-detail tooltip: hover + keyboard focus, Escape-dismissable (WCAG
  // 1.4.13/2.1.1) — shared wiring in tooltips/useRowTooltip.
  const rowTooltip = useRowTooltip();

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Practice categories" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Billing Category"
              sortKey="type"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[24%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Practice Area"
              sortKey="practiceArea"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="practiceArea" position="bottom" />
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
          {categories.map((cat, idx) => {
            const percentage = totalHours > 0 ? ((cat.totalHours / totalHours) * 100).toFixed(1) : 0;
            const color = PRACTICE_AREA_COLORS[cat.practiceArea] || GRAY[500];
            return (
              <tr
                key={idx}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                {...rowTooltip.rowProps(cat)}
              >
                <th scope="row" className="px-6 py-4 whitespace-nowrap text-sm font-medium text-left">
                  <Link
                    href={`/categories/${encodeURIComponent(cat.type)}`}
                    className="text-gray-900 hover:underline"
                  >
                    {cat.type}
                  </Link>
                </th>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: color }} />
                    {cat.practiceArea}
                  </span>
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {cat.count}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatHours(cat.totalHours)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                  {formatCurrency(cat.totalEarnings)}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {percentage}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {rowTooltip.active && (
        <TransactionRowTooltip
          transaction={rowTooltip.active}
          position={rowTooltip.position}
          {...rowTooltip.tooltipProps}
        />
      )}
    </div>
  );
};

export default PracticeCategoryTable;
