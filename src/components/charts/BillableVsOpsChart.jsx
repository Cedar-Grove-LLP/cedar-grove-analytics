"use client";

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PerBarTooltip } from '../tooltips';
import { CHART } from '@/utils/colors';
import { CHART_ANIMATIONS_DISABLED } from '@/utils/constants';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';

const SOURCE_NOTES = {
  billable: getSourceNote('billableHours'),
  ops: getSourceNote('opsHours'),
};

// Recharts spreads each data row's props onto the rendered SVG elements, so
// non-plotted metadata must be stripped before the rows reach <BarChart>.
// The attorney aggregation rows carry `role` ('Attorney'/'Partner' — cohort
// logic, see cohortFilter.mjs), which would otherwise render as an invalid
// ARIA role attribute on the bar <path>s (axe-core critical "aria-roles").
// Exported for unit tests.
export const toPlottedRows = (data) =>
  (data || []).map(({ name, billable, ops }) => ({ name, billable, ops }));

const BillableVsOpsChart = ({ data, title = "Billable vs Ops Time by Attorney" }) => {
  const [hoveredBarKey, setHoveredBarKey] = useState(null);

  // Bars run left→right in firm seniority order, carrying only plotted fields.
  const sortedData = sortBySeniority(toPlottedRows(data), (d) => d.name);

  return (
    <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label={title}>
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
            isAnimationActive={!CHART_ANIMATIONS_DISABLED}
            onMouseEnter={() => setHoveredBarKey('billable')}
            onMouseLeave={() => setHoveredBarKey(null)}
          />
          <Bar 
            dataKey="ops"
            fill={CHART.ops}
            name="Ops Hours"
            isAnimationActive={!CHART_ANIMATIONS_DISABLED}
            onMouseEnter={() => setHoveredBarKey('ops')}
            onMouseLeave={() => setHoveredBarKey(null)}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default BillableVsOpsChart;
