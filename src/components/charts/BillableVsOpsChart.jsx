"use client";

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PerBarTooltip } from '../tooltips';
import { CHART } from '@/utils/colors';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';

const SOURCE_NOTES = {
  billable: getSourceNote('billableHours'),
  ops: getSourceNote('opsHours'),
};

const BillableVsOpsChart = ({ data, title = "Billable vs Ops Time by Attorney" }) => {
  const [hoveredBarKey, setHoveredBarKey] = useState(null);

  // Bars run left→right in firm seniority order.
  const sortedData = sortBySeniority(data, (d) => d.name);

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={350}>
        <BarChart data={sortedData} barGap={0} barCategoryGap="20%">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-15} textAnchor="end" height={100} />
          <YAxis />
          <Tooltip 
            content={
              <PerBarTooltip
                hoveredDataKey={hoveredBarKey}
                sourceNote={SOURCE_NOTES[hoveredBarKey] || getSourceNote('totalHours')}
              />
            }
            cursor={{ fill: 'rgba(0,0,0,0.05)' }}
          />
          <Legend />
          <Bar 
            dataKey="billable" 
            fill={CHART.billable}
            name="Billable Hours"
            onMouseEnter={() => setHoveredBarKey('billable')}
            onMouseLeave={() => setHoveredBarKey(null)}
          />
          <Bar 
            dataKey="ops" 
            fill={CHART.ops}
            name="Ops Hours"
            onMouseEnter={() => setHoveredBarKey('ops')}
            onMouseLeave={() => setHoveredBarKey(null)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BillableVsOpsChart;
