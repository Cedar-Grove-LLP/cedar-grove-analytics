import ProtectedRoute from '@/components/ProtectedRoute';
import AdminUsers from '@/components/AdminUsers';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Users' };

export default function AdminUsersPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      {/* Skip-link target (WCAG 2.4.1) + main landmark for this route. */}
      <main id="main-content">
        <AdminUsers />
      </main>
    </ProtectedRoute>
  );
}