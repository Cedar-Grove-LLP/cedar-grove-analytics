"use client";

import { useState } from 'react';
import Link from 'next/link';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { TransactionRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';
import { PRACTICE_AREA_COLORS, GRAY } from '../../utils/colors';

const PracticeCategoryTable = ({
  categories,
  sortConfig,
  onSort,
  totalHours,
}) => {
  const [hoveredCategory, setHoveredCategory] = useState(null);
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
              className="w-[24%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Billing Category {getSortIndicator('type')}
            </th>
            <th
              onClick={() => onSort('practiceArea')}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Practice Area {getSortIndicator('practiceArea')}
                <CalcTooltip calcKey="practiceArea" position="bottom" />
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
          {categories.map((cat, idx) => {
            const percentage = totalHours > 0 ? ((cat.totalHours / totalHours) * 100).toFixed(1) : 0;
            const color = PRACTICE_AREA_COLORS[cat.practiceArea] || GRAY[500];
            return (
              <tr
                key={idx}
                className="hover:bg-blue-50 cursor-pointer transition-colors"
                onMouseEnter={(e) => {
                  setHoveredCategory(cat);
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }}
                onMouseMove={(e) => {
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }}
                onMouseLeave={() => setHoveredCategory(null)}
              >
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium">
                  <Link
                    href={`/categories/${encodeURIComponent(cat.type)}`}
                    className="text-gray-900 hover:underline"
                  >
                    {cat.type}
                  </Link>
                </td>
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
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
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

      {hoveredCategory && (
        <TransactionRowTooltip
          transaction={hoveredCategory}
          position={tooltipPosition}
        />
      )}
    </div>
  );
};

export default PracticeCategoryTable;
