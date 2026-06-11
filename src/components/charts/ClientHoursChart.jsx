"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CustomTooltip } from '../tooltips';
import { CHART } from '@/utils/colors';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';

const ClientHoursChart = ({ data, title = "Hours by Client" }) => {
  const activeClients = data.filter(c => c.totalHours > 0).slice(0, 10);

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={activeClients}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-15} textAnchor="end" height={100} />
          <YAxis />
          <Tooltip content={<CustomTooltip sourceNote={getSourceNote('billableHours')} />} />
          <Bar dataKey="totalHours" fill={CHART.billable} name="Total Hours" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ClientHoursChart;
