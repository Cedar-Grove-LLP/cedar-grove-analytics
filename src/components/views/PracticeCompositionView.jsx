"use client";

import { useMemo, useState } from 'react';
import { useAllBillableEntries } from '@/hooks/useFirestoreData';
import { getEntryDate } from '@/utils/dateHelpers';
import { MONTH_NAMES_ABBR } from '@/utils/constants';
import { classifyPracticeArea, rollUpByPracticeArea, PRACTICE_AREAS } from '@/utils/practiceArea.mjs';
import { PRACTICE_AREA_COLORS } from '@/utils/colors';
import { DateRangeIndicator, PracticeAreaCard } from '../shared';
import { PracticeCategoryTable } from '../tables';
import { PracticeAreaTrendChart } from '../charts';

const PracticeCompositionView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  transactionData,
}) => {
  const { data: allEntries } = useAllBillableEntries();

  const [sortConfig, setSortConfig] = useState({ key: 'totalHours', direction: 'desc' });

  const handleSort = (key) => {
    let direction = 'desc';
    if (key === 'type' || key === 'practiceArea') direction = 'asc';
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  // Same per-category rollup the Transactions tab uses, tagged with its
  // practice area for the new column + card rollup.
  const categoriesWithArea = useMemo(() => {
    return (transactionData || []).map((cat) => ({
      ...cat,
      practiceArea: classifyPracticeArea(cat.type),
    }));
  }, [transactionData]);

  const totalHours = useMemo(
    () => categoriesWithArea.reduce((sum, cat) => sum + cat.totalHours, 0),
    [categoriesWithArea],
  );

  const composition = useMemo(() => {
    return rollUpByPracticeArea(
      categoriesWithArea.map((cat) => ({
        category: cat.type,
        totalHours: cat.totalHours,
        totalEarnings: cat.totalEarnings,
        matterCount: cat.count,
      })),
    );
  }, [categoriesWithArea]);

  const sortedCategories = useMemo(() => {
    const items = [...categoriesWithArea];
    const { key, direction } = sortConfig;

    items.sort((a, b) => {
      let aVal, bVal;
      switch (key) {
        case 'type':
          aVal = a.type.toLowerCase();
          bVal = b.type.toLowerCase();
          break;
        case 'practiceArea':
          aVal = a.practiceArea.toLowerCase();
          bVal = b.practiceArea.toLowerCase();
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
          aVal = totalHours > 0 ? a.totalHours / totalHours : 0;
          bVal = totalHours > 0 ? b.totalHours / totalHours : 0;
          break;
        default:
          aVal = a.totalHours;
          bVal = b.totalHours;
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  }, [categoriesWithArea, sortConfig, totalHours]);

  // Full-history monthly composition shift, independent of the dashboard's
  // date-range filter — the point is to see the trend across many months.
  const monthlyTrend = useMemo(() => {
    const byMonth = {};

    (allEntries || []).forEach((entry) => {
      const hours = entry.billableHours || 0;
      if (hours <= 0) return;
      const date = getEntryDate(entry);
      if (!date || Number.isNaN(date.getTime())) return;

      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[monthKey]) {
        const row = { monthKey };
        PRACTICE_AREAS.forEach((area) => { row[area] = 0; });
        byMonth[monthKey] = row;
      }

      const area = classifyPracticeArea(entry.billingCategory);
      byMonth[monthKey][area] += hours;
    });

    return Object.values(byMonth)
      .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
      .map((row) => {
        const total = PRACTICE_AREAS.reduce((sum, area) => sum + row[area], 0);
        const [year, month] = row.monthKey.split('-').map(Number);
        const label = `${MONTH_NAMES_ABBR[month - 1]} '${String(year).slice(2)}`;
        const pctRow = { monthKey: row.monthKey, label };
        PRACTICE_AREAS.forEach((area) => {
          pctRow[area] = total > 0 ? Math.round((row[area] / total) * 1000) / 10 : 0;
        });
        return pctRow;
      });
  }, [allEntries]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-cg-black">Practice Composition</h2>
        <p className="text-sm text-cg-dark">
          Billable hours grouped into Commercial, Corporate, M&amp;A, and Non-profit practice areas — see where time goes today and how the mix shifts over time to plan hiring for growth.
        </p>
      </div>

      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      <div>
        <p className="text-xs text-cg-dark tracking-wide uppercase mb-2">Practice Composition</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {composition.map((c) => (
            <PracticeAreaCard
              key={c.area}
              area={c.area}
              percentage={c.percentage}
              matterCount={c.matterCount}
              subAreaCount={c.subAreaCount}
              color={PRACTICE_AREA_COLORS[c.area]}
            />
          ))}
        </div>
      </div>

      <PracticeCategoryTable
        categories={sortedCategories}
        sortConfig={sortConfig}
        onSort={handleSort}
        totalHours={totalHours}
      />

      <PracticeAreaTrendChart data={monthlyTrend} />
    </div>
  );
};

export default PracticeCompositionView;
