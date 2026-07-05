"use client";

import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { PRACTICE_AREA_COLORS } from '@/utils/colors';
import { PRACTICE_AREAS } from '@/utils/practiceArea.mjs';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';
import { SourceNote } from '../tooltips';

const SOURCE_NOTE = getSourceNote('practiceAreaSharePct');

const PracticeAreaTrendTooltip = ({ active, payload, label }) => {
  if (!active || !payload || payload.length === 0) return null;
  const sorted = [...payload].sort((a, b) => b.value - a.value);
  return (
    <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
      <p className="font-medium text-gray-900 mb-1">{label}</p>
      {sorted.map((entry, idx) => (
        <p key={idx} style={{ color: entry.color }} className="text-sm">
          {entry.name}: {entry.value.toFixed(1)}%
        </p>
      ))}
      <SourceNote sourceNote={SOURCE_NOTE} />
    </div>
  );
};

const PracticeAreaTrendChart = ({ data, title = "Practice Area Composition Over Time" }) => {
  if (!data || data.length === 0) {
    return (
      <div className="bg-white p-6 rounded-lg shadow">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">{title}</h3>
        <div className="flex items-center justify-center h-64 text-gray-500">
          No monthly data available
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-lg shadow">
      <h3 className="text-lg font-semibold text-gray-900 mb-1">{title}</h3>
      <p className="text-sm text-gray-500 mb-4">
        Share of billable hours by practice area, month over month — a growing slice signals where to hire next.
      </p>
      <ResponsiveContainer width="100%" height={320}>
        <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="label" />
          <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} />
          <Tooltip content={<PracticeAreaTrendTooltip />} />
          <Legend />
          {PRACTICE_AREAS.map((area) => (
            <Area
              key={area}
              type="monotone"
              dataKey={area}
              stackId="practice-area"
              stroke={PRACTICE_AREA_COLORS[area]}
              fill={PRACTICE_AREA_COLORS[area]}
              name={area}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
};

export default PracticeAreaTrendChart;
