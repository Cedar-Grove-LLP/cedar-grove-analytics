import ProtectedRoute from '@/components/ProtectedRoute';
import AdminInvoices from '@/components/AdminInvoices';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Invoices' };

export default function AdminInvoicesPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminInvoices />
    </ProtectedRoute>
  );
}
