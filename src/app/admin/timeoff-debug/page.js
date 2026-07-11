import ProtectedRoute from '@/components/ProtectedRoute';
import AdminTimeOffDebug from '@/components/AdminTimeOffDebug';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Time-Off Debug' };

export default function AdminTimeOffDebugPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      {/* Skip-link target (WCAG 2.4.1) + main landmark for this route. */}
      <main id="main-content">
        <AdminTimeOffDebug />
      </main>
    </ProtectedRoute>
  );
}
