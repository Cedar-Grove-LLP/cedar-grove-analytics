import ProtectedRoute from '@/components/ProtectedRoute';
import TechTeamDashboard from '@/components/TechTeamDashboard';

export default function TechTeamPage() {
  return (
    <ProtectedRoute>
      <TechTeamDashboard />
    </ProtectedRoute>
  );
}
