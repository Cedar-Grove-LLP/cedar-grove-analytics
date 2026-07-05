"use client";

import CalcTooltip from './CalcTooltip';

const PracticeAreaCard = ({ area, percentage, matterCount, subAreaCount, color }) => {
  return (
    <div
      className="bg-cg-white rounded-lg shadow-sm p-4"
      style={{ borderLeft: `3px solid ${color}` }}
    >
      <span className="text-sm text-cg-dark font-medium inline-flex items-center gap-1">
        {area}
        <CalcTooltip calcKey="practiceAreaSharePct" position="bottom" align="left" />
      </span>
      <div className="text-2xl font-semibold mt-1" style={{ color }}>
        {percentage.toFixed(1)}%
      </div>
      <div className="text-xs text-cg-dark mt-1">
        {matterCount} matter{matterCount === 1 ? '' : 's'} · {subAreaCount} sub-area{subAreaCount === 1 ? '' : 's'}
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full mt-2 overflow-hidden">
        <div
          className="h-full rounded-full"
          style={{ width: `${Math.min(percentage, 100)}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
};

export default PracticeAreaCard;
