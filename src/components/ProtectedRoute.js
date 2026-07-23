"use client";

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { decideRoute } from '@/utils/authzLogic.mjs';

export default function ProtectedRoute({
  children,
  requireAdmin = false,
  denyPartialAdmin = false,
  allowedAttorneyName = null // If set, only this attorney (or admins) can access
}) {
  const { user, isAdmin, isPartialAdmin, isAuthorized, loading, userEmail } = useAuth();
  const { users, loading: usersLoading } = useFirestoreCache();
  const router = useRouter();

  // The allow/redirect decision (including the attorney-page email match) is
  // the pure decideRoute helper in src/utils/authzLogic.mjs — evaluated once
  // in the redirect effect and once for the render gate below, with the same
  // inputs. `usersLoading` makes the attorney-page email match wait for the
  // users cache instead of bouncing on a not-yet-loaded cache (a direct load
  // of one's own page used to race to /login?error=access_denied); a
  // definitive mismatch still redirects once the cache has loaded, and
  // unauthenticated/unauthorized users redirect immediately.
  useEffect(() => {
    const decision = decideRoute(
      { user, isAuthorized, isAdmin, isPartialAdmin, loading, userEmail, users, usersLoading },
      { requireAdmin, denyPartialAdmin, allowedAttorneyName }
    );
    if (decision.outcome === 'redirect') {
      router.push(decision.redirectTo);
    }
  }, [user, isAdmin, isPartialAdmin, isAuthorized, loading, router, requireAdmin, denyPartialAdmin, allowedAttorneyName, userEmail, users, usersLoading]);

  const decision = decideRoute(
    { user, isAuthorized, isAdmin, isPartialAdmin, loading, userEmail, users, usersLoading },
    { requireAdmin, denyPartialAdmin, allowedAttorneyName }
  );

  if (decision.outcome === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center" role="status">
          <div className="inline-block animate-spin motion-reduce:animate-none rounded-full h-12 w-12 border-b-2 border-blue-600" aria-hidden="true"></div>
          <div className="mt-4 text-xl text-gray-700">Checking authentication...</div>
        </div>
      </div>
    );
  }

  // Don't render children unless every gate passes (the effect above handles
  // the matching redirect)
  if (decision.outcome !== 'allow') {
    return null;
  }

  return children;
}
