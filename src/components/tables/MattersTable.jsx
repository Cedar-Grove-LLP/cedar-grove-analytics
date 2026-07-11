"use client";

import { formatCurrency, formatHours } from '../../utils/formatters';
import { MatterRowTooltip, useRowTooltip } from '../tooltips';
import SortableTh from './SortableTh';

const MattersTable = ({
  matters,
  sortConfig,
  onSort,
  totalHours
}) => {
  // Row-detail tooltip: hover + keyboard focus, Escape-dismissable (WCAG
  // 1.4.13/2.1.1) — shared wiring in tooltips/useRowTooltip.
  const rowTooltip = useRowTooltip();

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Matters" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Matter"
              sortKey="matter"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[24%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Client"
              sortKey="clientName"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[18%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Avg Hours"
              sortKey="avgHours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Count"
              sortKey="count"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[8%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Total Hours"
              sortKey="totalHours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[14%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Total Earnings"
              sortKey="totalEarnings"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[14%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="% of Total"
              sortKey="percentage"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {matters.map((m, idx) => {
            const percentage = totalHours > 0 ? ((m.totalHours / totalHours) * 100).toFixed(1) : 0;
            return (
              <tr
                key={idx}
                className="hover:bg-blue-50 transition-colors"
                {...rowTooltip.rowProps(m)}
              >
                <th scope="row" className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 text-left">
                  {m.matter}
                </th>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">
                  {m.clientName}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {m.avgHours}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                  {m.count}
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                  {formatHours(m.totalHours)}h
                </td>
                <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                  {formatCurrency(m.totalEarnings)}
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
        <MatterRowTooltip
          matter={rowTooltip.active}
          position={rowTooltip.position}
          {...rowTooltip.tooltipProps}
        />
      )}
    </div>
  );
};

export default MattersTable;
