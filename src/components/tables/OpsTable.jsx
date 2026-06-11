"use client";

import { useState } from 'react';
import { OpsRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';

const OpsTable = ({ 
  opsData, 
  sortConfig, 
  onSort 
}) => {
  const [hoveredOps, setHoveredOps] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th 
              onClick={() => onSort('category')}
              className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Ops Category {getSortIndicator('category')}
            </th>
            <th 
              onClick={() => onSort('hours')}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-24"
            >
              <span className="inline-flex items-center gap-1">
                Hours {getSortIndicator('hours')}
                <CalcTooltip calcKey="opsHours" position="bottom" align="right" />
              </span>
            </th>
            <th 
              onClick={() => onSort('percentage')}
              className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 w-20"
            >
              <span className="inline-flex items-center gap-1">
                % {getSortIndicator('percentage')}
                <CalcTooltip calcKey="pctOfTotalOps" position="bottom" align="right" />
              </span>
            </th>
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
              <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                {ops.category}
              </td>
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
