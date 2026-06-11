"use client";

import CalcTooltip from './CalcTooltip';

const KPICard = ({
  title,
  value,
  subtitle,
  icon: Icon,
  iconColor = "text-cg-green",
  // Optional calculation tooltip: { calcKey, dynamic? } per calcDefinitions.mjs
  info,
}) => {
  return (
    <div className="bg-cg-white p-4 rounded-lg shadow-sm border border-gray-200 aspect-square flex flex-col justify-between">
      <div className="flex items-center justify-between mb-1">
        <span className="text-cg-dark text-sm font-medium inline-flex items-center gap-1">
          {title}
          {info && <CalcTooltip {...info} variant="icon" position="bottom" align="left" />}
        </span>
        {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="text-3xl font-bold text-cg-black">{value}</div>
      </div>
      {subtitle && (
        <div className="text-sm text-cg-dark text-center">{subtitle}</div>
      )}
    </div>
  );
};

export default KPICard;
