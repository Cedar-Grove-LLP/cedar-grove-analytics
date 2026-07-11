"use client";

// Accessible sortable column header shared by every sortable table.
//
// Replaces the old `<th onClick>` pattern, which was mouse-only: the sort
// control here is a real <button> (keyboard-operable, WCAG 2.1.1) and the
// <th> carries aria-sort for the active column (WCAG 1.3.1/4.1.2). Tailwind's
// preflight makes the button inherit the th's font/color, so the existing
// header styling passes through unchanged via `className`.
//
// Usage:
//   <SortableTh
//     label="Hours"
//     sortKey="hours"
//     sortConfig={sortConfig}          // { key, direction: 'asc'|'desc' }
//     onSort={handleSort}
//     className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
//   >
//     <CalcTooltip calcKey="billableHours" />   {/* optional extras */}
//   </SortableTh>

const DIRECTION_TO_ARIA = { asc: 'ascending', desc: 'descending' };

const SortableTh = ({
  label,
  sortKey,
  sortConfig,
  onSort,
  className = '',
  buttonClassName = '',
  children,
}) => {
  const active = sortConfig?.key === sortKey;
  return (
    <th
      scope="col"
      aria-sort={active ? DIRECTION_TO_ARIA[sortConfig.direction] : undefined}
      className={className}
    >
      <span className="inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className={`inline-flex items-center gap-1 hover:text-gray-700 ${buttonClassName}`}
        >
          {label}
          {active && <span aria-hidden="true">{sortConfig.direction === 'asc' ? '↑' : '↓'}</span>}
        </button>
        {/* Extras (e.g. a focusable CalcTooltip) render as SIBLINGS of the
            button, not inside it — a button must not contain focusable
            descendants, and tooltip text must not pollute its accessible
            name. */}
        {children}
      </span>
    </th>
  );
};

export default SortableTh;
