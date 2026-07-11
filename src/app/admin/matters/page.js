import ProtectedRoute from '@/components/ProtectedRoute';
import AdminMatterManagement from '@/components/AdminMatterManagement';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Matters' };

export default function AdminMattersPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminMatterManagement />
    </ProtectedRoute>
  );
}
