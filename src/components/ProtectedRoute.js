"use client";

import { useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useFirestoreCache } from '@/context/FirestoreDataContext';

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  denyPartialAdmin = false,
  allowedAttorneyName = null // If set, only this attorney (or admins) can access
}) {
  const { user, isAdmin, isPartialAdmin, isAuthorized, loading, userEmail } = useAuth();
  const { users } = useFirestoreCache();
  const router = useRouter();

  // Check if the logged-in user's email matches the email on this attorney's
  // user doc. Memoized so the useEffect dep array has a stable reference —
  // react-hooks/exhaustive-deps. Behavior unchanged: identity changes only
  // when [isAdmin, allowedAttorneyName, userEmail, users] change, which were
  // already direct deps of the effect.
  const canAccessAttorneyPage = useCallback(() => {
    if (isAdmin) return true;
    if (!allowedAttorneyName) return true;
    if (!userEmail) return false;

    // Find the user doc for this attorney page and compare emails
    const attorneyUser = users.find(u => (u.name || u.id) === allowedAttorneyName);
    if (!attorneyUser || !attorneyUser.email) return false;

    return attorneyUser.email.toLowerCase() === userEmail;
  }, [isAdmin, allowedAttorneyName, userEmail, users]);

  useEffect(() => {
    if (!loading) {
      // Redirect if: no user, anonymous user, or not authorized
      if (!user || user.isAnonymous || !isAuthorized) {
        router.push('/login');
        return;
      }

      // If admin is required but user is not admin (partial admins are allowed through)
      if (requireAdmin && !isAdmin && !isPartialAdmin) {
        router.push('/login?error=admin_required');
        return;
      }

      // If page denies partial admins and user is not a full admin
      if (denyPartialAdmin && isPartialAdmin && !isAdmin) {
        router.push('/admin');
        return;
      }

      // If trying to access another attorney's page
      if (allowedAttorneyName && !canAccessAttorneyPage()) {
        router.push('/login?error=access_denied');
      }
    }
  }, [user, isAdmin, isPartialAdmin, isAuthorized, loading, router, requireAdmin, denyPartialAdmin, allowedAttorneyName, canAccessAttorneyPage]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
          <div className="mt-4 text-xl text-gray-700">Checking authentication...</div>
        </div>
      </div>
    );
  }

  // Don't render children if not authenticated properly
  if (!user || user.isAnonymous || !isAuthorized) {
    return null;
  }

  // Don't render if admin is required but user is not admin or partial admin
  if (requireAdmin && !isAdmin && !isPartialAdmin) {
    return null;
  }

  // Don't render if page denies partial admins
  if (denyPartialAdmin && isPartialAdmin && !isAdmin) {
    return null;
  }

  // Don't render if trying to access another attorney's page
  if (allowedAttorneyName && !canAccessAttorneyPage()) {
    return null;
  }

  return children;
}
