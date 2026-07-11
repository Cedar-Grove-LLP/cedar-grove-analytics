"use client";

import { useState } from 'react';
import { DateRangeIndicator } from '../shared';
import { TransactionsTable } from '../tables';
import { MatterCategorySunburst } from '../charts';

const TransactionsView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  transactionData,
  matterData,
}) => {
  const [sortConfig, setSortConfig] = useState({ key: 'totalHours', direction: 'desc' });

  const handleSort = (key) => {
    let direction = 'desc';
    if (key === 'type') direction = 'asc';
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedTransactions = () => {
    const items = [...transactionData];
    const totalHours = items.reduce((sum, t) => sum + t.totalHours, 0);

    items.sort((a, b) => {
      let aVal, bVal;

      switch (sortConfig.key) {
        case 'type':
          aVal = a.type.toLowerCase();
          bVal = b.type.toLowerCase();
          break;
        case 'avgHours':
          aVal = parseFloat(a.avgHours);
          bVal = parseFloat(b.avgHours);
          break;
        case 'count':
          aVal = a.count;
          bVal = b.count;
          break;
        case 'totalHours':
          aVal = a.totalHours;
          bVal = b.totalHours;
          break;
        case 'totalEarnings':
          aVal = a.totalEarnings;
          bVal = b.totalEarnings;
          break;
        case 'percentage':
          aVal = totalHours > 0 ? (a.totalHours / totalHours) : 0;
          bVal = totalHours > 0 ? (b.totalHours / totalHours) : 0;
          break;
        default:
          aVal = a.totalHours;
          bVal = b.totalHours;
      }

      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  };

  const totalHours = transactionData.reduce((sum, t) => sum + t.totalHours, 0);

  return (
    <div className="space-y-6">
      <h2 className="sr-only">Transactions</h2>
      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        entryCount={transactionData?.length || 0}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      <TransactionsTable
        transactions={getSortedTransactions()}
        sortConfig={sortConfig}
        onSort={handleSort}
        totalHours={totalHours}
      />

      <MatterCategorySunburst data={matterData} />
    </div>
  );
};

export default TransactionsView;
