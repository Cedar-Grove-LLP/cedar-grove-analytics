import ProtectedRoute from '@/components/ProtectedRoute';
import AdminTransactions from '@/components/AdminTransactions';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Transactions' };

export default function AdminTransactionsPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminTransactions />
    </ProtectedRoute>
  );
}
