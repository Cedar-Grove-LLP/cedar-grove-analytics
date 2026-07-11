import ProtectedRoute from '@/components/ProtectedRoute';
import AdminUserManagement from '@/components/AdminUserManagement';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'User Management' };

export default function AdminUserManagementPage() {
  return (
    <ProtectedRoute requireAdmin={true} denyPartialAdmin={true}>
      <AdminUserManagement />
    </ProtectedRoute>
  );
}
