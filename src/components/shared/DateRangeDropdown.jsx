import { useRef, useEffect } from 'react';
import { Calendar, ChevronDown } from 'lucide-react';

const DateRangeDropdown = ({
  dateRange,
  setDateRange,
  customDateStart,
  setCustomDateStart,
  customDateEnd,
  setCustomDateEnd,
  showDropdown,
  setShowDropdown,
  minDate = undefined,
}) => {
  const dropdownRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowDropdown]);

  const dateRangeOptions = [
    { value: 'current-week', label: 'Current Week' },
    { value: 'last-week', label: 'Last Week' },
    { value: 'current-month', label: 'Current Month' },
    { value: 'last-month', label: 'Last Month' },
    { value: 'trailing-60', label: 'Trailing 60 Days' },
    { value: 'all-time', label: 'All Time' },
    { value: 'custom', label: 'Custom Range' },
  ];

  const getButtonLabel = () => {
    const option = dateRangeOptions.find(opt => opt.value === dateRange);
    return option ? option.label : 'Select Range';
  };

  const isCustomRangeValid = () =>
    customDateStart && customDateEnd && (!minDate || (customDateStart >= minDate && customDateEnd >= minDate));

  const handleApplyCustomRange = () => {
    if (isCustomRangeValid()) {
      setDateRange('custom');
      setShowDropdown(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-2 px-4 py-2 bg-cg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm"
      >
        <Calendar className="w-4 h-4 text-cg-dark" />
        <span className="text-sm font-medium text-cg-dark">
          {getButtonLabel()}
        </span>
        <ChevronDown className={`w-4 h-4 text-cg-dark transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-80 bg-cg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          <div className="py-1">
            {dateRangeOptions.filter(opt => opt.value !== 'custom').map(option => (
              <button
                key={option.value}
                onClick={() => {
                  setDateRange(option.value);
                  setShowDropdown(false);
                }}
                className={`w-full text-left px-4 py-2 text-sm transition-colors ${
                  dateRange === option.value 
                    ? 'bg-cg-green/10 text-cg-green font-medium' 
                    : 'text-cg-dark hover:bg-gray-100'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          
          <div className="border-t border-gray-200 p-3">
            <div className="text-sm font-medium text-cg-dark mb-2">Custom Range</div>
            {minDate && <p className="text-[11px] text-cg-dark/60 -mt-1 mb-2">No data before {minDate}</p>}
            <div className="flex flex-col gap-2 mb-2">
              <div className="flex flex-col gap-1">
                <label className="text-xs text-cg-dark/70">Start</label>
                <input
                  type="date"
                  value={customDateStart}
                  onChange={(e) => setCustomDateStart(e.target.value)}
                  min={minDate}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-cg-green focus:border-transparent"
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-xs text-cg-dark/70">End</label>
                <input
                  type="date"
                  value={customDateEnd}
                  onChange={(e) => setCustomDateEnd(e.target.value)}
                  min={minDate}
                  className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-cg-green focus:border-transparent"
                />
              </div>
            </div>
            <button
              onClick={handleApplyCustomRange}
              disabled={!isCustomRangeValid()}
              className={`w-full py-1.5 text-sm rounded transition-colors ${
                isCustomRangeValid()
                  ? 'bg-cg-green text-white hover:opacity-90'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              Apply Custom Range
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DateRangeDropdown;