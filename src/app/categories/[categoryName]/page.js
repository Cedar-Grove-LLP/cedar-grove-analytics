"use client";

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import ProtectedRoute from '@/components/ProtectedRoute';
import CategoryDetailView from '@/components/views/CategoryDetailView';

export default function CategoryDetailPage() {
  const params = useParams();
  const categoryName = decodeURIComponent(params.categoryName);

  // Client components can't export static metadata — set the distinct page
  // title (WCAG 2.4.2) imperatively.
  useEffect(() => {
    document.title = `${categoryName} — Cedar Grove Analytics`;
    // Restore the default on unmount: the imperative write bypasses React's
    // virtual DOM, so a soft navigation to a route whose metadata title is
    // unchanged would otherwise keep this page's title.
    return () => { document.title = 'Cedar Grove Analytics'; };
  }, [categoryName]);

  return (
    <ProtectedRoute requireAdmin={true}>
      {/* Skip-link target (WCAG 2.4.1) + main landmark for this route. */}
      <main id="main-content">
        <CategoryDetailView categoryName={categoryName} />
      </main>
    </ProtectedRoute>
  );
}
