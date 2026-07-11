"use client";

import { useState } from 'react';
import { OpsRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';
import SortableTh from './SortableTh';

const OpsTable = ({ 
  opsData, 
  sortConfig, 
  onSort 
}) => {
  const [hoveredOps, setHoveredOps] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Ops entries" className="w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Ops Category"
              sortKey="category"
              sortConfig={sortConfig}
              onSort={onSort}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Hours"
              sortKey="hours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-24"
            >
              <CalcTooltip calcKey="opsHours" position="bottom" align="right" />
            </SortableTh>
            <SortableTh
              label="%"
              sortKey="percentage"
              sortConfig={sortConfig}
              onSort={onSort}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider w-20"
            >
              <CalcTooltip calcKey="pctOfTotalOps" position="bottom" align="right" />
            </SortableTh>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {opsData.map((ops, idx) => (
            <tr 
              key={idx} 
              className="hover:bg-green-50 cursor-pointer transition-colors"
              onMouseEnter={(e) => {
                setHoveredOps(ops);
                setTooltipPosition({ x: e.clientX, y: e.clientY });
              }}
              onMouseMove={(e) => {
                setTooltipPosition({ x: e.clientX, y: e.clientY });
              }}
              onMouseLeave={() => setHoveredOps(null)}
            >
              <th scope="row" className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 text-left">
                {ops.category}
              </th>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                {ops.hours}h
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 text-right">
                {ops.percentage}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {hoveredOps && (
        <OpsRowTooltip 
          ops={hoveredOps} 
          position={tooltipPosition}
        />
      )}
    </div>
  );
};

export default OpsTable;
