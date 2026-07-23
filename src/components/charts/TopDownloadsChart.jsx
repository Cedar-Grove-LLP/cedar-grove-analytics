"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { CHART } from '@/utils/colors';
import { CHART_ANIMATIONS_DISABLED } from '@/utils/constants';
import { getSourceNote } from '@/utils/calcDefinitions.mjs';
import { SourceNote } from '../tooltips';

const SOURCE_NOTE = getSourceNote('downloads');

const DownloadTooltip = ({ active, payload, label }) => {
  if (active && payload && payload.length) {
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-1 text-sm max-w-[300px] break-words">{label}</p>
        <p className="text-sm text-blue-600">{payload[0].value} downloads</p>
        <SourceNote sourceNote={SOURCE_NOTE} />
      </div>
    );
  }
  return null;
};

const TopDownloadsChart = ({ data, mode = 'files', title }) => {
  const nameKey = mode === 'folders' ? 'folderName' : 'file';
  const displayTitle = title || (mode === 'folders' ? 'Top Folders by Downloads' : 'Top Documents by Downloads');

  const chartData = data
    .slice(0, 15)
    .map(d => {
      const name = d[nameKey] || '';
      return {
        name: name.length > 40 ? name.slice(0, 37) + '...' : name,
        fullName: name,
        downloads: d.downloads,
      };
    });

  if (chartData.length === 0) return null;

  return (
    <div className="bg-white p-6 rounded-lg shadow" role="figure" aria-label={displayTitle}>
      <h3 className="text-lg font-semibold text-gray-900 mb-4">{displayTitle}</h3>
      <ResponsiveContainer width="100%" height={Math.max(300, chartData.length * 36)}>
        <BarChart data={chartData} layout="vertical" margin={{ left: 10, right: 30 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis type="number" allowDecimals={false} />
          <YAxis
            dataKey="name"
            type="category"
            width={260}
            tick={{ fontSize: 12 }}
          />
          <Tooltip content={<DownloadTooltip />} />
          <Bar dataKey="downloads" fill={CHART.accent} name="Downloads" radius={[0, 4, 4, 0]} isAnimationActive={!CHART_ANIMATIONS_DISABLED} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
};

export default TopDownloadsChart;
