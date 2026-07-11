"use client";

import { useState } from 'react';
import { DateRangeIndicator } from '../shared';
import { OpsTable } from '../tables';
import { OpsZoomableSunburst } from '../charts';

const OpsView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  opsData,
}) => {
  const [sortConfig, setSortConfig] = useState({ key: 'hours', direction: 'desc' });

  const handleSort = (key) => {
    let direction = 'desc';
    if (key === 'category') direction = 'asc';
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedOps = () => {
    const ops = [...opsData];
    
    ops.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortConfig.key) {
        case 'category':
          aVal = a.category.toLowerCase();
          bVal = b.category.toLowerCase();
          break;
        case 'hours':
          aVal = a.hours;
          bVal = b.hours;
          break;
        case 'percentage':
          aVal = parseFloat(a.percentage);
          bVal = parseFloat(b.percentage);
          break;
        default:
          aVal = a.hours;
          bVal = b.hours;
      }
      
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });
    
    return ops;
  };

  if (opsData.length === 0) {
    return (
      <div className="space-y-6">
        <h2 className="sr-only">Ops</h2>
        <DateRangeIndicator
          dateRangeLabel={dateRangeLabel}
          entryCount={opsData?.length || 0}
          globalAttorneyFilter={globalAttorneyFilter}
          allAttorneyNames={allAttorneyNames}
        />
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="text-gray-500">No ops data available for the selected date range.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Ops</h2>
      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        entryCount={opsData?.length || 0}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Ops Table - Left side */}
        <OpsTable 
          opsData={getSortedOps()}
          sortConfig={sortConfig}
          onSort={handleSort}
        />

        {/* Zoomable Sunburst Chart - Right side */}
        <OpsZoomableSunburst data={opsData} />
      </div>
    </div>
  );
};

export default OpsView;