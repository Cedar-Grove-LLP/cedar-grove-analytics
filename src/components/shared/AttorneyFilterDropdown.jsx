import { useRef, useEffect } from 'react';
import { Users, ChevronDown } from 'lucide-react';

const AttorneyFilterDropdown = ({
  allAttorneyNames = [],
  globalAttorneyFilter = [],
  setGlobalAttorneyFilter,
  showDropdown,
  setShowDropdown,
}) => {
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [setShowDropdown]);

  // Escape closes the panel and returns focus to the trigger (WCAG 2.1.1).
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      setShowDropdown(false);
      triggerRef.current?.focus();
    }
  };

  const getButtonLabel = () => {
    if (!globalAttorneyFilter || globalAttorneyFilter.length === 0) return 'No Team Members';
    if (globalAttorneyFilter.length === allAttorneyNames.length) return 'All Team Members';
    if (globalAttorneyFilter.length === 1) return globalAttorneyFilter[0];
    return `${globalAttorneyFilter.length} Team Members`;
  };

  const isFiltered = globalAttorneyFilter?.length > 0 && globalAttorneyFilter?.length < allAttorneyNames?.length;

  return (
    <div className="relative" ref={dropdownRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        onClick={() => setShowDropdown(!showDropdown)}
        aria-expanded={showDropdown}
        aria-haspopup="true"
        className={`flex items-center gap-2 px-4 py-2 border rounded-lg hover:bg-gray-50 transition-colors shadow-sm ${
          isFiltered
            ? 'bg-cg-green/10 border-cg-green'
            : 'bg-cg-white border-gray-300'
        }`}
      >
        <Users className="w-4 h-4 text-cg-dark" aria-hidden="true" />
        <span className="text-sm font-medium text-cg-dark">
          {getButtonLabel()}
        </span>
        <ChevronDown className={`w-4 h-4 text-cg-dark transition-transform ${showDropdown ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>

      {showDropdown && (
        <div className="absolute right-0 mt-2 w-64 bg-cg-white rounded-lg shadow-lg border border-gray-200 z-50 overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <button
              onClick={() => setGlobalAttorneyFilter([...allAttorneyNames])}
              className={`w-full text-left px-3 py-2 text-sm rounded-md transition-colors ${
                globalAttorneyFilter.length === allAttorneyNames.length
                  ? 'bg-cg-green/10 text-cg-green-text font-medium'
                  : 'text-cg-dark hover:bg-gray-100'
              }`}
            >
              All Team Members
            </button>
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {allAttorneyNames.map(name => (
              <label
                key={name}
                className="flex items-center px-3 py-2 hover:bg-gray-50 cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={globalAttorneyFilter.includes(name)}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setGlobalAttorneyFilter([...globalAttorneyFilter, name]);
                    } else {
                      setGlobalAttorneyFilter(globalAttorneyFilter.filter(n => n !== name));
                    }
                  }}
                  className="w-4 h-4 text-cg-green border-gray-300 rounded focus:ring-cg-green accent-cg-green"
                />
                <span className="ml-3 text-sm text-cg-dark">{name}</span>
              </label>
            ))}
          </div>
          <div className="p-2 border-t border-gray-100 bg-gray-50">
            <button
              onClick={() => setGlobalAttorneyFilter([])}
              className="w-full px-3 py-1.5 text-sm text-cg-dark hover:text-cg-black transition-colors"
            >
              Clear selection
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default AttorneyFilterDropdown;