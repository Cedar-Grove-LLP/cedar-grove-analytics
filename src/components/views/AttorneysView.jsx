"use client";

import { useState } from 'react';
import { DateRangeIndicator } from '../shared';
import { AttorneysTable } from '../tables';
import { BillableVsOpsChart } from '../charts';
import { useDataWarnings } from '@/hooks/useFirestoreData';
import { compareBySeniority } from '@/utils/seniority.mjs';

const AttorneysView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  attorneyData,
  calculateUtilization,
}) => {
  const dataWarnings = useDataWarnings();
  const [sortConfig, setSortConfig] = useState({ key: 'name', direction: 'asc' });

  const handleSort = (key) => {
    let direction = 'desc';
    if (key === 'name') direction = 'asc';
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedAttorneys = () => {
    const attorneys = [...attorneyData];

    attorneys.sort((a, b) => {
      // The Name column lists staff in firm seniority order (asc = most senior
      // first); numeric columns rank purely by metric.
      if (sortConfig.key === 'name') {
        const cmp = compareBySeniority(a.name, b.name);
        return sortConfig.direction === 'asc' ? cmp : -cmp;
      }

      let aVal, bVal;

      switch (sortConfig.key) {
        case 'billable':
          aVal = a.billable;
          bVal = b.billable;
          break;
        case 'ops':
          aVal = a.ops;
          bVal = b.ops;
          break;
        case 'total':
          aVal = a.billable + a.ops;
          bVal = b.billable + b.ops;
          break;
        case 'earnings':
          aVal = a.earnings;
          bVal = b.earnings;
          break;
        case 'utilization':
          // Null utilization (no target this period) maps to -1 so it sorts as the
          // lowest value (last when descending, first when ascending).
          aVal = calculateUtilization(a) ?? -1;
          bVal = calculateUtilization(b) ?? -1;
          break;
        default: {
          const cmp = compareBySeniority(a.name, b.name);
          return sortConfig.direction === 'asc' ? cmp : -cmp;
        }
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return attorneys;
  };

  return (
    <div className="space-y-6">
      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        entryCount={attorneyData?.length || 0}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      <AttorneysTable
        attorneys={getSortedAttorneys()}
        sortConfig={sortConfig}
        onSort={handleSort}
        calculateUtilization={calculateUtilization}
        dataWarnings={dataWarnings}
      />

      <BillableVsOpsChart 
        data={attorneyData}
        title="Billable vs Ops Time by Attorney"
      />
    </div>
  );
};

export default AttorneysView;
