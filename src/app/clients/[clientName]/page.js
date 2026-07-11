"use client";

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import ClientDetailView from '@/components/views/ClientDetailView';

export default function ClientDetailPage() {
  const params = useParams();
  const clientName = decodeURIComponent(params.clientName);

  // Client components can't export static metadata — set the distinct page
  // title (WCAG 2.4.2) imperatively.
  useEffect(() => {
    document.title = `${clientName} — Cedar Grove Analytics`;
  }, [clientName]);

  return (
    <ProtectedRoute requireAdmin={true}>
      <ClientDetailView clientName={clientName} />
    </ProtectedRoute>
  );
}