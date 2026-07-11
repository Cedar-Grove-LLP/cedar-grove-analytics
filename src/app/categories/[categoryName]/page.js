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
  }, [categoryName]);

  return (
    <ProtectedRoute requireAdmin={true}>
      <CategoryDetailView categoryName={categoryName} />
    </ProtectedRoute>
  );
}
