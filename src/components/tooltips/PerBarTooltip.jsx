import { formatHours } from '../../utils/formatters';
import SourceNote from './SourceNote';

// Tooltip that shows total hours by default, or specific bar when directly hovered
const PerBarTooltip = ({ active, payload, label, hoveredDataKey, sourceNote }) => {
  if (active && payload && payload.length > 0) {
    // If hovering a specific bar, show only that bar's value
    if (hoveredDataKey) {
      const filteredPayload = payload.filter(p => p.dataKey === hoveredDataKey);
      if (filteredPayload.length === 0) return null;

      return (
        <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
          <p className="font-medium text-gray-900 mb-1">{label}</p>
          {filteredPayload.map((entry, index) => (
            <p key={index} style={{ color: entry.color }} className="text-sm">
              {entry.name}: {formatHours(entry.value)}h
            </p>
          ))}
          <SourceNote sourceNote={sourceNote} />
        </div>
      );
    }

    // Otherwise show total hours
    const totalHours = payload.reduce((sum, entry) => sum + (entry.value || 0), 0);
    return (
      <div className="bg-white p-3 border border-gray-200 rounded-lg shadow-lg">
        <p className="font-medium text-gray-900 mb-1">{label}</p>
        <p className="text-sm text-gray-700">
          Total Hours: <span className="font-semibold">{formatHours(totalHours)}h</span>
        </p>
        <SourceNote sourceNote={sourceNote} />
      </div>
    );
  }
  return null;
};

export default PerBarTooltip;
