import ProtectedRoute from '@/components/ProtectedRoute';
import AdminBillingKPIs from '@/components/AdminBillingKPIs';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Billing KPIs' };

export default function AdminBillingKPIsPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      {/* Skip-link target (WCAG 2.4.1) + main landmark for this route. */}
      <main id="main-content">
        <AdminBillingKPIs />
      </main>
    </ProtectedRoute>
  );
}
