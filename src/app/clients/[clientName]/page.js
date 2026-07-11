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
    // Restore the default on unmount: the imperative write bypasses React's
    // virtual DOM, so a soft navigation to a route whose metadata title is
    // unchanged would otherwise keep this page's title.
    return () => { document.title = 'Cedar Grove Analytics'; };
  }, [clientName]);

  return (
    <ProtectedRoute requireAdmin={true}>
      {/* Skip-link target (WCAG 2.4.1) + main landmark for this route. */}
      <main id="main-content">
        <ClientDetailView clientName={clientName} />
      </main>
    </ProtectedRoute>
  );
}