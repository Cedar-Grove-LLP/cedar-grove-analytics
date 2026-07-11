import ProtectedRoute from '@/components/ProtectedRoute';
import AdminBillingKPIs from '@/components/AdminBillingKPIs';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Billing KPIs' };

export default function AdminBillingKPIsPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminBillingKPIs />
    </ProtectedRoute>
  );
}
