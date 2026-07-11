"use client";

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import AttorneyDetailView from '@/components/views/AttorneyDetailView';

export default function UserDetailPage() {
  const params = useParams();
  const userName = decodeURIComponent(params.userName);

  // Client components can't export static metadata — set the distinct page
  // title (WCAG 2.4.2) imperatively.
  useEffect(() => {
    document.title = `${userName} — Cedar Grove Analytics`;
  }, [userName]);

  return (
    <ProtectedRoute allowedAttorneyName={userName}>
      <AttorneyDetailView attorneyName={userName} />
    </ProtectedRoute>
  );
}
