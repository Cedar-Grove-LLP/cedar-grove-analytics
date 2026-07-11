"use client";

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import ProtectedRoute from '@/components/ProtectedRoute';
import CedarGroveAnalytics from '@/components/AnalyticsDashboard';

function DashboardContent() {
  const { isAdmin, loading, userEmail, isAuthorized, hasDownloadsAccess, hasTransactionsOpsAccess, signOut } = useAuth();
  const { users, loading: usersLoading } = useFirestoreCache();
  const router = useRouter();

  // matchedAttorneyName is purely derived state — find the user doc whose
  // email matches the logged-in user's email. useMemo (rather than
  // useEffect + useState) avoids the cascading-renders pattern flagged by
  // react-hooks/set-state-in-effect.
  const matchedAttorneyName = useMemo(() => {
    if (loading || usersLoading) return null;
    if (!isAuthorized || isAdmin || hasDownloadsAccess || hasTransactionsOpsAccess) return null;
    if (!userEmail || !users || users.length === 0) return null;

    const matchedUser = users.find(
      u => u.email && u.email.toLowerCase() === userEmail
    );

    return matchedUser ? (matchedUser.name || matchedUser.id) : null;
  }, [
    loading,
    usersLoading,
    isAuthorized,
    isAdmin,
    hasDownloadsAccess,
    hasTransactionsOpsAccess,
    userEmail,
    users,
  ]);

  useEffect(() => {
    // Redirect non-admins to their attorney page once we've found a match.
    // router.push is a genuine side effect (browser history mutation), so it
    // belongs in useEffect, not in derivation.
    if (
      !loading &&
      !usersLoading &&
      isAuthorized &&
      !isAdmin &&
      !hasDownloadsAccess &&
      !hasTransactionsOpsAccess &&
      matchedAttorneyName
    ) {
      router.push(`/users/${encodeURIComponent(matchedAttorneyName)}`);
    }
  }, [
    loading,
    usersLoading,
    isAuthorized,
    isAdmin,
    hasDownloadsAccess,
    hasTransactionsOpsAccess,
    matchedAttorneyName,
    router,
  ]);

  // Show loading while checking or redirecting
  if (loading || usersLoading || (!isAdmin && !hasDownloadsAccess && !hasTransactionsOpsAccess && matchedAttorneyName)) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
          <div className="mt-4 text-xl text-gray-700">Loading...</div>
        </div>
      </div>
    );
  }

  // Downloads-access users see the dashboard restricted to Downloads tab only
  if (!isAdmin && hasDownloadsAccess) {
    return <CedarGroveAnalytics downloadsOnly />;
  }

  // Transactions+Ops access users see the dashboard restricted to those tabs
  if (!isAdmin && hasTransactionsOpsAccess) {
    return <CedarGroveAnalytics transactionsOpsOnly />;
  }

  // Non-admins without a matched attorney page see a simple message
  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center" role="status">
          <div className="text-xl text-gray-700">No attorney profile found for your account.</div>
          <div className="mt-2 text-gray-500">Contact an administrator for assistance.</div>
          <button
            onClick={async () => { await signOut(); router.push('/login'); }}
            className="mt-6 px-6 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Logout
          </button>
        </div>
      </div>
    );
  }

  // Only admins see the full dashboard
  return <CedarGroveAnalytics />;
}

export default function Home() {
  return (
    <ProtectedRoute>
      <DashboardContent />
    </ProtectedRoute>
  );
}
