import ProtectedRoute from '@/components/ProtectedRoute';
import BillingSummariesView from '@/components/views/BillingSummariesView';

// Distinct page title (WCAG 2.4.2) — rendered via the root layout's title.template.
export const metadata = { title: 'Billing Summaries' };

export default function BillingSummariesPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <div className="min-h-screen bg-cg-background p-6">
        <main id="main-content" className="max-w-7xl mx-auto">
          <BillingSummariesView />
        </main>
      </div>
    </ProtectedRoute>
  );
}