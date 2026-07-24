// Pure authorization logic extracted from src/context/AuthContext.js and
// src/components/ProtectedRoute.js so it can be unit-tested without the
// Firebase client SDK or React (tests/authz-logic.test.mjs). The context and
// route guard import these back — behavior is unchanged.
//
// Firestore reads (admins/{email}, permissions/{email}) stay in AuthContext;
// this module only combines their results.

import { isPartialAdminEmail } from './partialAdminAccess.js';
import { hasDownloadsAccessEmail } from './downloadsAccess.js';
import { hasTransactionsOpsAccessEmail } from './transactionsOpsAccess.js';

// Allowed email domain
export const ALLOWED_DOMAIN = 'cedargrovellp.com';

// Check if email is from allowed domain
export function isAllowedDomain(email) {
  if (!email) return false;
  return email.toLowerCase().endsWith(`@${ALLOWED_DOMAIN}`);
}

// Restricted-mode flags derived from the permissions/{email} doc (or null
// when the doc doesn't exist). Mirrors the per-flag helpers used in the
// AuthContext provider value.
export function derivePermissionFlags(permissionsDoc) {
  return {
    isPartialAdmin: isPartialAdminEmail(permissionsDoc),
    hasDownloadsAccess: hasDownloadsAccessEmail(permissionsDoc),
    hasTransactionsOpsAccess: hasTransactionsOpsAccessEmail(permissionsDoc),
  };
}

// Pure core of AuthContext's checkAuthorization: combine the email-domain
// check with the fetched admins/{email} existence and permissions/{email}
// doc into the authorization state.
//   - adminDocExists: whether admins/{email} exists (=> full admin)
//   - permissionsDoc: data of permissions/{email}, or null when absent
// Authorized if from the allowed domain, or if manually granted admin
// (e.g. an external account added via Manage Admins).
export function deriveAuthorization(email, { adminDocExists = false, permissionsDoc = null } = {}) {
  if (!email) {
    return {
      isAuthorized: false,
      isAdmin: false,
      permissions: null,
      ...derivePermissionFlags(null),
    };
  }

  return {
    isAuthorized: isAllowedDomain(email) || adminDocExists,
    isAdmin: adminDocExists,
    permissions: permissionsDoc,
    ...derivePermissionFlags(permissionsDoc),
  };
}

// Check if the logged-in user's email matches the email on this attorney's
// user doc (successor to the old nickname mapping). Admins always pass;
// pages without an allowedAttorneyName are open to any authorized user.
// NOTE: userEmail is expected to be already lowercased (AuthContext exposes
// it that way); the attorney doc's email is lowercased before comparing.
export function canAccessAttorneyPage({ isAdmin, allowedAttorneyName, userEmail, users }) {
  if (isAdmin) return true;
  if (!allowedAttorneyName) return true;
  if (!userEmail) return false;

  // Find the user doc for this attorney page and compare emails
  const attorneyUser = users.find(u => (u.name || u.id) === allowedAttorneyName);
  if (!attorneyUser || !attorneyUser.email) return false;

  return attorneyUser.email.toLowerCase() === userEmail;
}

// Pure core of ProtectedRoute: given the auth state and the page's gate
// options, decide what the route should do. Returns one of:
//   { outcome: 'loading' }                    — a required input not resolved yet
//   { outcome: 'redirect', redirectTo: url }  — push url, render nothing
//   { outcome: 'allow' }                      — render children
// The checks run in the same order as the original effect/render guards.
//
// `usersLoading` is the FirestoreDataContext users-cache loading flag. The
// attorney-page email match reads that cache, so while it is still loading a
// FAILED match is indeterminate (the doc may simply not have arrived yet) and
// resolves to 'loading' instead of a redirect. This only ever DELAYS a deny —
// it never grants: a positive email match is definitive (the matching doc is
// already in the cache), and once usersLoading is false a mismatch redirects.
// Unauthenticated/unauthorized users and the admin gates redirect immediately
// regardless of usersLoading (those decisions don't depend on the cache).
export function decideRoute(
  { user, isAuthorized, isAdmin, isPartialAdmin, loading, userEmail, users, usersLoading = false },
  { requireAdmin = false, denyPartialAdmin = false, allowedAttorneyName = null } = {}
) {
  if (loading) {
    return { outcome: 'loading' };
  }

  // Redirect if: no user, anonymous user, or not authorized
  if (!user || user.isAnonymous || !isAuthorized) {
    return { outcome: 'redirect', redirectTo: '/login' };
  }

  // If admin is required but user is not admin (partial admins are allowed through)
  if (requireAdmin && !isAdmin && !isPartialAdmin) {
    return { outcome: 'redirect', redirectTo: '/login?error=admin_required' };
  }

  // If page denies partial admins and user is not a full admin
  if (denyPartialAdmin && isPartialAdmin && !isAdmin) {
    return { outcome: 'redirect', redirectTo: '/admin' };
  }

  // If trying to access another attorney's page
  if (allowedAttorneyName && !canAccessAttorneyPage({ isAdmin, allowedAttorneyName, userEmail, users })) {
    // Indeterminate, not a deny: the users cache hasn't finished loading, so
    // the email match may still succeed. Wait instead of bouncing (fixes the
    // direct-load race that sent partial admins to /login?error=access_denied
    // on their own page before the cache arrived).
    if (usersLoading) {
      return { outcome: 'loading' };
    }
    return { outcome: 'redirect', redirectTo: '/login?error=access_denied' };
  }

  return { outcome: 'allow' };
}

// ---------------------------------------------------------------------------
// Dashboard tab gating (AnalyticsDashboard restricted modes)
// ---------------------------------------------------------------------------

// The exact tab sets restricted-mode users may see. Allowlists, not
// blocklists: anything outside the set (including future tabs) is denied.
export const DOWNLOADS_ONLY_TABS = ['downloads'];
export const TRANSACTIONS_OPS_TABS = ['transactions', 'ops'];

// The tab a persona lands on when no (valid, allowed) ?tab= param is present.
export function defaultDashboardTab({ downloadsOnly = false, transactionsOpsOnly = false } = {}) {
  if (downloadsOnly) return 'downloads';
  if (transactionsOpsOnly) return 'transactions';
  return 'overview';
}

// Resolve the ?tab= deep-link param against the persona's allowed tab set.
// Restricted modes are allowlist-based: downloadsOnly users get exactly their
// downloads tab, transactionsOpsOnly exactly transactions + ops; any other
// requested tab (blocked, admin-only, unknown) falls back to the persona's
// default tab. Full-access users get any valid tab (adminOnly tab visibility
// for non-admin full-access users is handled by the tab bar, unchanged here).
export function resolveDashboardTab({
  requestedTab,
  downloadsOnly = false,
  transactionsOpsOnly = false,
  validTabs = [],
} = {}) {
  const fallback = defaultDashboardTab({ downloadsOnly, transactionsOpsOnly });
  if (!requestedTab || !validTabs.includes(requestedTab)) return fallback;

  if (downloadsOnly) {
    return DOWNLOADS_ONLY_TABS.includes(requestedTab) ? requestedTab : fallback;
  }
  if (transactionsOpsOnly) {
    return TRANSACTIONS_OPS_TABS.includes(requestedTab) ? requestedTab : fallback;
  }
  return requestedTab;
}
