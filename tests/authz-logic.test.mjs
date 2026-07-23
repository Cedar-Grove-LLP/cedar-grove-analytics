import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_DOMAIN,
  isAllowedDomain,
  derivePermissionFlags,
  deriveAuthorization,
  canAccessAttorneyPage,
  decideRoute,
  DOWNLOADS_ONLY_TABS,
  TRANSACTIONS_OPS_TABS,
  defaultDashboardTab,
  resolveDashboardTab,
} from '../src/utils/authzLogic.mjs';

// ---------------------------------------------------------------------------
// isAllowedDomain
// ---------------------------------------------------------------------------

test('isAllowedDomain accepts the firm domain case-insensitively', () => {
  assert.equal(ALLOWED_DOMAIN, 'cedargrovellp.com');
  assert.equal(isAllowedDomain('jane@cedargrovellp.com'), true);
  assert.equal(isAllowedDomain('JANE@CEDARGROVELLP.COM'), true);
  assert.equal(isAllowedDomain('Jane.Doe@CedarGroveLLP.com'), true);
});

test('isAllowedDomain rejects missing, empty, and outside emails', () => {
  assert.equal(isAllowedDomain(null), false);
  assert.equal(isAllowedDomain(undefined), false);
  assert.equal(isAllowedDomain(''), false);
  assert.equal(isAllowedDomain('jane@gmail.com'), false);
});

test('isAllowedDomain is not fooled by a suffix-spoof domain', () => {
  // The "@" in the endsWith needle means evilcedargrovellp.com does not match
  assert.equal(isAllowedDomain('attacker@evilcedargrovellp.com'), false);
  // A bare domain with no "@" is not an email from the domain
  assert.equal(isAllowedDomain('cedargrovellp.com'), false);
});

// ---------------------------------------------------------------------------
// derivePermissionFlags — permissions/{email} doc -> restricted-mode flags
// ---------------------------------------------------------------------------

test('derivePermissionFlags maps each permissions-doc flag independently', () => {
  assert.deepEqual(derivePermissionFlags(null), {
    isPartialAdmin: false,
    hasDownloadsAccess: false,
    hasTransactionsOpsAccess: false,
  });
  assert.deepEqual(derivePermissionFlags({ partialAdmin: true }), {
    isPartialAdmin: true,
    hasDownloadsAccess: false,
    hasTransactionsOpsAccess: false,
  });
  assert.deepEqual(derivePermissionFlags({ downloadsAccess: true }), {
    isPartialAdmin: false,
    hasDownloadsAccess: true,
    hasTransactionsOpsAccess: false,
  });
  assert.deepEqual(derivePermissionFlags({ transactionsOpsAccess: true }), {
    isPartialAdmin: false,
    hasDownloadsAccess: false,
    hasTransactionsOpsAccess: true,
  });
});

test('derivePermissionFlags requires strict boolean true', () => {
  // The helpers use `=== true`, so truthy-but-not-true values do not grant
  assert.equal(derivePermissionFlags({ partialAdmin: 'yes' }).isPartialAdmin, false);
  assert.equal(derivePermissionFlags({ partialAdmin: 1 }).isPartialAdmin, false);
  assert.equal(derivePermissionFlags({ partialAdmin: false }).isPartialAdmin, false);
});

// ---------------------------------------------------------------------------
// deriveAuthorization — domain check + admin doc + permissions doc
// ---------------------------------------------------------------------------

test('deriveAuthorization with no email denies everything', () => {
  assert.deepEqual(deriveAuthorization(null), {
    isAuthorized: false,
    isAdmin: false,
    permissions: null,
    isPartialAdmin: false,
    hasDownloadsAccess: false,
    hasTransactionsOpsAccess: false,
  });
  // Even if stale fetch results are passed alongside a missing email
  const denied = deriveAuthorization('', { adminDocExists: true, permissionsDoc: { partialAdmin: true } });
  assert.equal(denied.isAuthorized, false);
  assert.equal(denied.isAdmin, false);
  assert.equal(denied.isPartialAdmin, false);
});

test('deriveAuthorization authorizes domain emails without an admin doc', () => {
  const result = deriveAuthorization('jane@cedargrovellp.com');
  assert.equal(result.isAuthorized, true);
  assert.equal(result.isAdmin, false);
  assert.equal(result.permissions, null);
  assert.equal(result.isPartialAdmin, false);
});

test('deriveAuthorization authorizes an external email only via the admin doc', () => {
  // e.g. an external account added via Manage Admins
  const external = deriveAuthorization('consultant@gmail.com', { adminDocExists: true });
  assert.equal(external.isAuthorized, true);
  assert.equal(external.isAdmin, true);

  const outsider = deriveAuthorization('rando@gmail.com', { adminDocExists: false });
  assert.equal(outsider.isAuthorized, false);
  assert.equal(outsider.isAdmin, false);
});

test('deriveAuthorization threads the permissions doc into restricted-mode flags', () => {
  const partial = deriveAuthorization('paralegal@cedargrovellp.com', {
    permissionsDoc: { partialAdmin: true },
  });
  assert.equal(partial.isAuthorized, true);
  assert.equal(partial.isAdmin, false);
  assert.equal(partial.isPartialAdmin, true);
  assert.deepEqual(partial.permissions, { partialAdmin: true });

  const downloads = deriveAuthorization('office@cedargrovellp.com', {
    permissionsDoc: { downloadsAccess: true },
  });
  assert.equal(downloads.hasDownloadsAccess, true);
  assert.equal(downloads.isPartialAdmin, false);

  const txOps = deriveAuthorization('books@cedargrovellp.com', {
    permissionsDoc: { transactionsOpsAccess: true },
  });
  assert.equal(txOps.hasTransactionsOpsAccess, true);
  assert.equal(txOps.isPartialAdmin, false);
});

// ---------------------------------------------------------------------------
// canAccessAttorneyPage — email/name matching (nickname-mapping successor)
// ---------------------------------------------------------------------------

const USERS = [
  { id: 'u-jane', name: 'Jane Doe', email: 'Jane.Doe@cedargrovellp.com' },
  { id: 'u-john', name: 'John Smith', email: 'john.smith@cedargrovellp.com' },
  { id: 'u-paula', name: 'Paula Paralegal', email: 'paralegal@cedargrovellp.com' }, // the partial admin's own doc
  { id: 'Nameless Nate', email: 'nate@cedargrovellp.com' }, // no name — matched by doc id
  { id: 'u-noemail', name: 'No Email' }, // user doc missing the email field
];

test('canAccessAttorneyPage: admins always pass, even before their email resolves', () => {
  assert.equal(
    canAccessAttorneyPage({ isAdmin: true, allowedAttorneyName: 'Jane Doe', userEmail: null, users: [] }),
    true
  );
});

test('canAccessAttorneyPage: pages without an attorney restriction are open', () => {
  assert.equal(
    canAccessAttorneyPage({ isAdmin: false, allowedAttorneyName: null, userEmail: null, users: [] }),
    true
  );
});

test('canAccessAttorneyPage: loading race — no userEmail yet denies access', () => {
  // While auth/user email hasn't resolved, a restricted page is denied
  assert.equal(
    canAccessAttorneyPage({ isAdmin: false, allowedAttorneyName: 'Jane Doe', userEmail: null, users: USERS }),
    false
  );
});

test('canAccessAttorneyPage: own page matches case-insensitively on the doc email', () => {
  // Doc email has caps; userEmail arrives lowercased from AuthContext
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'Jane Doe',
      userEmail: 'jane.doe@cedargrovellp.com',
      users: USERS,
    }),
    true
  );
});

test('canAccessAttorneyPage: userEmail must be pre-lowercased (pins current behavior)', () => {
  // Only the attorney doc's email is lowercased before comparing — a
  // mixed-case userEmail never matches. AuthContext always lowercases
  // userEmail, so this is fine in practice; documented here as the contract.
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'Jane Doe',
      userEmail: 'Jane.Doe@cedargrovellp.com',
      users: USERS,
    }),
    false
  );
});

test('canAccessAttorneyPage: another attorney\'s page is denied', () => {
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'John Smith',
      userEmail: 'jane.doe@cedargrovellp.com',
      users: USERS,
    }),
    false
  );
});

test('canAccessAttorneyPage: falls back to the doc id when name is absent', () => {
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'Nameless Nate',
      userEmail: 'nate@cedargrovellp.com',
      users: USERS,
    }),
    true
  );
});

test('canAccessAttorneyPage: unknown attorney or doc without email denies', () => {
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'Ghost Attorney',
      userEmail: 'jane.doe@cedargrovellp.com',
      users: USERS,
    }),
    false
  );
  assert.equal(
    canAccessAttorneyPage({
      isAdmin: false,
      allowedAttorneyName: 'No Email',
      userEmail: 'jane.doe@cedargrovellp.com',
      users: USERS,
    }),
    false
  );
});

// ---------------------------------------------------------------------------
// decideRoute — full user-type x page-flag decision matrix
// ---------------------------------------------------------------------------

// Auth states as exposed by AuthContext (userEmail already lowercased)
const AUTH_STATES = {
  unauthenticated: {
    user: null, isAuthorized: false, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: null, users: USERS,
  },
  anonymous: {
    user: { isAnonymous: true }, isAuthorized: false, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: null, users: USERS,
  },
  outsider: { // signed in with a non-firm Google account, no admin doc
    user: { email: 'rando@gmail.com' }, isAuthorized: false, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: 'rando@gmail.com', users: USERS,
  },
  admin: {
    user: { email: 'sam@cedargrovellp.com' }, isAuthorized: true, isAdmin: true, isPartialAdmin: false,
    loading: false, userEmail: 'sam@cedargrovellp.com', users: USERS,
  },
  attorneyJane: {
    user: { email: 'jane.doe@cedargrovellp.com' }, isAuthorized: true, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: 'jane.doe@cedargrovellp.com', users: USERS,
  },
  partialAdmin: {
    user: { email: 'paralegal@cedargrovellp.com' }, isAuthorized: true, isAdmin: false, isPartialAdmin: true,
    loading: false, userEmail: 'paralegal@cedargrovellp.com', users: USERS,
  },
  // downloads-only and transactions+ops-only users carry no routing
  // privileges — ProtectedRoute treats them like a plain attorney (their
  // flags gate views, not routes)
  downloadsOnly: {
    user: { email: 'office@cedargrovellp.com' }, isAuthorized: true, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: 'office@cedargrovellp.com', users: USERS,
  },
  transactionsOpsOnly: {
    user: { email: 'books@cedargrovellp.com' }, isAuthorized: true, isAdmin: false, isPartialAdmin: false,
    loading: false, userEmail: 'books@cedargrovellp.com', users: USERS,
  },
};

// Page gate configurations as used across the app
const PAGES = {
  dashboard: {},
  adminSection: { requireAdmin: true },
  fullAdminOnly: { requireAdmin: true, denyPartialAdmin: true },
  janePage: { allowedAttorneyName: 'Jane Doe' },
  johnPage: { allowedAttorneyName: 'John Smith' },
  paulaPage: { allowedAttorneyName: 'Paula Paralegal' }, // the partial admin's own page
};

const ALLOW = { outcome: 'allow' };
const LOGIN = { outcome: 'redirect', redirectTo: '/login' };
const ADMIN_REQUIRED = { outcome: 'redirect', redirectTo: '/login?error=admin_required' };
const PARTIAL_DENIED = { outcome: 'redirect', redirectTo: '/admin' };
const ACCESS_DENIED = { outcome: 'redirect', redirectTo: '/login?error=access_denied' };

// The matrix: [auth state, page, expected decision]
const MATRIX = [
  ['unauthenticated', 'dashboard', LOGIN],
  ['unauthenticated', 'adminSection', LOGIN],
  ['unauthenticated', 'fullAdminOnly', LOGIN],
  ['unauthenticated', 'janePage', LOGIN],
  ['unauthenticated', 'johnPage', LOGIN],

  ['anonymous', 'dashboard', LOGIN],
  ['anonymous', 'adminSection', LOGIN],
  ['anonymous', 'fullAdminOnly', LOGIN],
  ['anonymous', 'janePage', LOGIN],
  ['anonymous', 'johnPage', LOGIN],

  ['outsider', 'dashboard', LOGIN],
  ['outsider', 'adminSection', LOGIN],
  ['outsider', 'fullAdminOnly', LOGIN],
  ['outsider', 'janePage', LOGIN],
  ['outsider', 'johnPage', LOGIN],

  ['admin', 'dashboard', ALLOW],
  ['admin', 'adminSection', ALLOW],
  ['admin', 'fullAdminOnly', ALLOW],
  ['admin', 'janePage', ALLOW], // admins can view any attorney page
  ['admin', 'johnPage', ALLOW],

  ['attorneyJane', 'dashboard', ALLOW],
  ['attorneyJane', 'adminSection', ADMIN_REQUIRED],
  ['attorneyJane', 'fullAdminOnly', ADMIN_REQUIRED],
  ['attorneyJane', 'janePage', ALLOW], // own page
  ['attorneyJane', 'johnPage', ACCESS_DENIED], // someone else's page

  ['partialAdmin', 'dashboard', ALLOW],
  ['partialAdmin', 'adminSection', ALLOW], // partial admins pass requireAdmin
  ['partialAdmin', 'fullAdminOnly', PARTIAL_DENIED], // ...but not denyPartialAdmin
  ['partialAdmin', 'janePage', ACCESS_DENIED], // someone else's page — no attorney-page privileges
  ['partialAdmin', 'johnPage', ACCESS_DENIED],
  ['partialAdmin', 'paulaPage', ALLOW], // own page: the email match grants it like any attorney

  ['downloadsOnly', 'dashboard', ALLOW],
  ['downloadsOnly', 'adminSection', ADMIN_REQUIRED],
  ['downloadsOnly', 'fullAdminOnly', ADMIN_REQUIRED],
  ['downloadsOnly', 'janePage', ACCESS_DENIED],
  ['downloadsOnly', 'johnPage', ACCESS_DENIED],

  ['transactionsOpsOnly', 'dashboard', ALLOW],
  ['transactionsOpsOnly', 'adminSection', ADMIN_REQUIRED],
  ['transactionsOpsOnly', 'fullAdminOnly', ADMIN_REQUIRED],
  ['transactionsOpsOnly', 'janePage', ACCESS_DENIED],
  ['transactionsOpsOnly', 'johnPage', ACCESS_DENIED],
];

for (const [who, page, expected] of MATRIX) {
  test(`decideRoute: ${who} on ${page} -> ${expected.redirectTo ?? 'allow'}`, () => {
    assert.deepEqual(decideRoute(AUTH_STATES[who], PAGES[page]), expected);
  });
}

test('decideRoute: loading wins over everything', () => {
  for (const [who, page] of [['admin', 'dashboard'], ['unauthenticated', 'fullAdminOnly']]) {
    assert.deepEqual(
      decideRoute({ ...AUTH_STATES[who], loading: true }, PAGES[page]),
      { outcome: 'loading' }
    );
  }
});

test('decideRoute: check order — unauthenticated beats admin gates, admin gate beats attorney match', () => {
  // Not authorized + admin page: redirected to /login, not admin_required
  assert.deepEqual(
    decideRoute(AUTH_STATES.outsider, { requireAdmin: true, allowedAttorneyName: 'Jane Doe' }),
    LOGIN
  );
  // Plain attorney on an admin page that is also attorney-restricted:
  // admin_required fires before the attorney-email match
  assert.deepEqual(
    decideRoute(AUTH_STATES.attorneyJane, { requireAdmin: true, allowedAttorneyName: 'John Smith' }),
    ADMIN_REQUIRED
  );
});

test('decideRoute: page options default to an unrestricted page', () => {
  assert.deepEqual(decideRoute(AUTH_STATES.attorneyJane), ALLOW);
  assert.deepEqual(decideRoute(AUTH_STATES.unauthenticated), LOGIN);
});

// ---------------------------------------------------------------------------
// decideRoute + usersLoading — the attorney-page match must WAIT for the users
// cache instead of bouncing (fixed race: direct-loading one's own /users page
// used to hit /login?error=access_denied before the cache arrived)
// ---------------------------------------------------------------------------

test('decideRoute: attorney page while the users cache loads -> loading, not access_denied', () => {
  // The cache is empty and still loading: the email match cannot resolve yet
  const state = { ...AUTH_STATES.partialAdmin, users: [], usersLoading: true };
  assert.deepEqual(decideRoute(state, PAGES.paulaPage), { outcome: 'loading' });
  // Same for a plain attorney direct-loading their own page
  const jane = { ...AUTH_STATES.attorneyJane, users: [], usersLoading: true };
  assert.deepEqual(decideRoute(jane, PAGES.janePage), { outcome: 'loading' });
});

test('decideRoute: definitive deny still redirects once the cache has loaded', () => {
  // Cache fully loaded (usersLoading false) and the email does not match
  const state = { ...AUTH_STATES.partialAdmin, usersLoading: false };
  assert.deepEqual(decideRoute(state, PAGES.janePage), ACCESS_DENIED);
  // usersLoading omitted defaults to false — same definitive deny
  assert.deepEqual(decideRoute(AUTH_STATES.attorneyJane, PAGES.johnPage), ACCESS_DENIED);
});

test('decideRoute: a positive email match allows even while the cache is still loading', () => {
  // The matching doc is already in the (partially loaded) cache — a positive
  // grant is definitive; more docs arriving cannot revoke it
  const state = { ...AUTH_STATES.attorneyJane, usersLoading: true };
  assert.deepEqual(decideRoute(state, PAGES.janePage), ALLOW);
});

test('decideRoute: usersLoading never delays the cache-independent gates', () => {
  // Unauthenticated users redirect immediately — no spinner-forever hole
  assert.deepEqual(
    decideRoute({ ...AUTH_STATES.unauthenticated, users: [], usersLoading: true }, PAGES.janePage),
    LOGIN
  );
  assert.deepEqual(
    decideRoute({ ...AUTH_STATES.outsider, users: [], usersLoading: true }, PAGES.janePage),
    LOGIN
  );
  // Admin gates don't read the users cache either
  assert.deepEqual(
    decideRoute({ ...AUTH_STATES.attorneyJane, users: [], usersLoading: true }, PAGES.adminSection),
    ADMIN_REQUIRED
  );
  assert.deepEqual(
    decideRoute({ ...AUTH_STATES.partialAdmin, users: [], usersLoading: true }, PAGES.fullAdminOnly),
    PARTIAL_DENIED
  );
  // Full admins bypass the attorney match entirely — allowed while loading
  assert.deepEqual(
    decideRoute({ ...AUTH_STATES.admin, users: [], usersLoading: true }, PAGES.janePage),
    ALLOW
  );
});

// ---------------------------------------------------------------------------
// resolveDashboardTab — restricted-mode ?tab= deep links are allowlist-based
// ---------------------------------------------------------------------------

// Mirrors AnalyticsDashboard's VALID_TABS
const VALID_TABS = [
  'overview', 'attorneys', 'transactions', 'ops', 'clients', 'downloads',
  'targets', 'practice-composition', 'tech-team', 'invoices-testing',
  'timesheets-testing',
];

test('defaultDashboardTab per persona', () => {
  assert.equal(defaultDashboardTab({}), 'overview');
  assert.equal(defaultDashboardTab({ downloadsOnly: true }), 'downloads');
  assert.equal(defaultDashboardTab({ transactionsOpsOnly: true }), 'transactions');
  assert.equal(defaultDashboardTab(), 'overview');
});

test('restricted allowlists are exactly the modes\' tab sets', () => {
  assert.deepEqual(DOWNLOADS_ONLY_TABS, ['downloads']);
  assert.deepEqual(TRANSACTIONS_OPS_TABS, ['transactions', 'ops']);
});

test('resolveDashboardTab: transactions-ops users get exactly transactions + ops', () => {
  const mode = { transactionsOpsOnly: true, validTabs: VALID_TABS };
  assert.equal(resolveDashboardTab({ requestedTab: 'transactions', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'ops', ...mode }), 'ops');
  // The fixed gap: ?tab=overview (any tab outside the allowlist) falls back
  // to the restricted default instead of rendering
  assert.equal(resolveDashboardTab({ requestedTab: 'overview', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'clients', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'targets', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'tech-team', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'invoices-testing', ...mode }), 'transactions');
  assert.equal(resolveDashboardTab({ requestedTab: 'timesheets-testing', ...mode }), 'transactions');
});

test('resolveDashboardTab: downloads-only users get exactly their downloads tab', () => {
  const mode = { downloadsOnly: true, validTabs: VALID_TABS };
  assert.equal(resolveDashboardTab({ requestedTab: 'downloads', ...mode }), 'downloads');
  assert.equal(resolveDashboardTab({ requestedTab: 'overview', ...mode }), 'downloads');
  assert.equal(resolveDashboardTab({ requestedTab: 'transactions', ...mode }), 'downloads');
  assert.equal(resolveDashboardTab({ requestedTab: 'tech-team', ...mode }), 'downloads');
});

test('resolveDashboardTab: full-access users are unchanged (any valid tab)', () => {
  const mode = { validTabs: VALID_TABS };
  assert.equal(resolveDashboardTab({ requestedTab: 'overview', ...mode }), 'overview');
  assert.equal(resolveDashboardTab({ requestedTab: 'targets', ...mode }), 'targets');
  assert.equal(resolveDashboardTab({ requestedTab: 'tech-team', ...mode }), 'tech-team');
});

test('resolveDashboardTab: missing or unknown tabs fall back to the persona default', () => {
  assert.equal(resolveDashboardTab({ requestedTab: null, validTabs: VALID_TABS }), 'overview');
  assert.equal(resolveDashboardTab({ requestedTab: '', validTabs: VALID_TABS }), 'overview');
  assert.equal(resolveDashboardTab({ requestedTab: 'nope', validTabs: VALID_TABS }), 'overview');
  assert.equal(
    resolveDashboardTab({ requestedTab: 'nope', transactionsOpsOnly: true, validTabs: VALID_TABS }),
    'transactions'
  );
  assert.equal(
    resolveDashboardTab({ requestedTab: 'nope', downloadsOnly: true, validTabs: VALID_TABS }),
    'downloads'
  );
});
