import ProtectedRoute from '@/components/ProtectedRoute';
import AdminTimeOffDebug from '@/components/AdminTimeOffDebug';

export default function AdminTimeOffDebugPage() {
  return (
    <ProtectedRoute requireAdmin={true}>
      <AdminTimeOffDebug />
    </ProtectedRoute>
  );
}
