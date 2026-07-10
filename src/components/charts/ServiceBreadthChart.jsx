"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CustomTooltip } from '../tooltips';
import { CHART } from '@/utils/colors';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';

const SOURCE_NOTE = getSourceNote('serviceBreadth');

const ServiceBreadthChart = ({ data, title = "Service Breadth (Unique Transaction Types)" }) => {
  const clientsWithTransactions = data.filter(c => c.uniqueTransactions > 0).slice(0, 10);

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={clientsWithTransactions}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="name" angle={-15} textAnchor="end" height={100} />
          <YAxis />
          <Tooltip content={<CustomTooltip sourceNote={SOURCE_NOTE} />} />
          <Bar dataKey="uniqueTransactions" fill={CHART.accent} name="Unique Transaction Types" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default ServiceBreadthChart;
