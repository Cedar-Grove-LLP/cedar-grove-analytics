"use client";

import { useMemo } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { filterHiddenAttorneys } from '@/utils/hiddenAttorneys';
import UtilizationTargetsTab from '@/components/admin/UtilizationTargetsTab';

const TargetsView = () => {
  const { users: allUsers, loading: usersLoading, refetch } = useFirestoreCache();

  const users = useMemo(() => {
    if (!allUsers || allUsers.length === 0) return [];
    const allNames = allUsers.map(u => u.name || u.id);
    const visibleNames = filterHiddenAttorneys(allNames);
    return allUsers
      .filter(u => visibleNames.includes(u.name || u.id))
      .sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id));
  }, [allUsers]);

  return (
    <div>
      <div className="mb-4">
        <h2 className="text-2xl font-bold text-cg-black">Utilization Targets</h2>
        <p className="text-sm text-cg-dark">Set monthly billable and ops hour targets for each team member</p>
      </div>
      <UtilizationTargetsTab users={users} usersLoading={usersLoading} refetch={refetch} />
    </div>
  );
};

export default TargetsView;
