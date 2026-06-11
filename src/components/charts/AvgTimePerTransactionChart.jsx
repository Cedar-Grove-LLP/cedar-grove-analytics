"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CustomTooltip } from '../tooltips';
import { CHART } from '@/utils/colors';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';

const AvgTimePerTransactionChart = ({ data, title = "Average Time per Transaction Type" }) => {
  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data.slice(0, 10)} layout="vertical">
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" />
          <YAxis dataKey="type" type="category" width={150} />
          <Tooltip content={<CustomTooltip sourceNote={getSourceNote('avgHoursPerTransaction')} />} />
          <Bar dataKey="avgHours" fill={CHART.ops} name="Avg Hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default AvgTimePerTransactionChart;
