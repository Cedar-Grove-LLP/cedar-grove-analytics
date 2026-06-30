"use client";

import { useMemo, useState } from 'react';
import { Target, TrendingUp } from 'lucide-react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys.mjs';
import { sortBySeniority } from '@/utils/seniority.mjs';
import UtilizationTargetsTab from '@/components/admin/UtilizationTargetsTab';
import ProjectedEarningsTable from '@/components/admin/ProjectedEarningsTable';

const TABS = [
  { key: 'utilization', label: 'Utilization Targets', icon: Target },
  { key: 'earnings', label: 'Projected Earnings', icon: TrendingUp },
];

const TargetsView = () => {
  const { users: allUsers, loading: usersLoading, refetch } = useFirestoreCache();
  const [activeTab, setActiveTab] = useState('utilization');

  const users = useMemo(() => {
    if (!allUsers || allUsers.length === 0) return [];
    const allNames = allUsers.map(u => u.name || u.id);
    const visibleNames = filterHiddenAttorneys(allNames);
    return sortBySeniority(
      allUsers.filter(u => u.active !== false && visibleNames.includes(u.name || u.id)),
      u => u.name || u.id,
    );
  }, [allUsers]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-cg-black">Targets</h2>
        <p className="text-sm text-cg-dark">
          Set monthly billable and ops hour targets, track annual pacing, and review projected earnings
        </p>
      </div>

      <div className="flex gap-1 border-b border-gray-200">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
              activeTab === tab.key
                ? 'text-blue-600 border-blue-600'
                : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'utilization' && (
        <UtilizationTargetsTab users={users} usersLoading={usersLoading} refetch={refetch} />
      )}
      {activeTab === 'earnings' && <ProjectedEarningsTable />}
    </div>
  );
};

export default TargetsView;
