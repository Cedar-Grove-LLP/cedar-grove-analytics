import ProtectedRoute from '@/components/ProtectedRoute';
import AdminDashboard from '@/components/AdminDashboard';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Admin' };

export default function AdminPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminDashboard />
    </ProtectedRoute>
  );
}