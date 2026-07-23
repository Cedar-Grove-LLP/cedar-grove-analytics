/**
 * Authorization matrix — (route, role) -> outcome.
 *
 * Runs under each persona project (chromium-admin / chromium-attorney /
 * chromium-partial, see playwright.config.mjs); every test looks up the
 * current persona from the project name and asserts that persona's expected
 * outcome for the route. Adding a route = one line in ROUTES.
 *
 * Outcomes (mirroring src/utils/authzLogic.mjs decideRoute + page flags):
 *   ALLOW           — page renders; URL settles on the route.
 *   ADMIN_REQUIRED  — requireAdmin gate: bounced via /login?error=admin_required
 *                     (attorney persona; partial admins pass requireAdmin).
 *   PARTIAL_DENIED  — denyPartialAdmin gate: partial admin redirected to /admin.
 *   ACCESS_DENIED   — attorney-page email mismatch: bounced via
 *                     /login?error=access_denied.
 *
 * Gate flags read from the source (do not trust this table blindly — re-read
 * src/app/**?/page.js when adding a route):
 *   - every /admin/* page + /billing-summaries, /clients/[name],
 *     /categories/[name]: requireAdmin (partial admins allowed through)
 *   - /admin/user-management: requireAdmin + denyPartialAdmin
 *   - /users/[userName]: allowedAttorneyName (email match or full admin)
 */

import { test, expect } from '@playwright/test';
import { E2E_TODAY, PERSONAS } from './fixtures.mjs';

const PROJECT_ROLES = {
  'chromium-admin': 'admin',
  'chromium-attorney': 'attorney',
  'chromium-partial': 'partial',
};

const ALLOW = 'allow';
const ADMIN_REQUIRED = 'admin-required';
const PARTIAL_DENIED = 'partial-denied';
const ACCESS_DENIED = 'access-denied';

const ADMIN_SLUG = encodeURIComponent(PERSONAS.admin.name); // Alex%20Adams
const ATTORNEY_SLUG = encodeURIComponent(PERSONAS.attorney.name); // Nick%20Nolan
const PARTIAL_SLUG = encodeURIComponent(PERSONAS.partial.name); // Valery%20Vaughn

// `marker` is the page's unique <h1> text — ProtectedRoute renders null until
// the gate allows, so the h1 doubles as the "content actually rendered" probe.
const ROUTES = [
  { path: '/admin',                  marker: 'Admin Panel',           expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/billing-kpis',     marker: 'Billing KPIs',          expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/invoices',         marker: 'Invoices',              expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/matters',          marker: 'Matter Management',     expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/timeoff-debug',    marker: 'Time-Off Debug',        expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/transactions',     marker: 'Transactions',          expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/users',            marker: 'Manage Admins',         expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/admin/user-management',  marker: 'User Management',       expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: PARTIAL_DENIED } },
  { path: '/billing-summaries',      marker: 'Billing Summaries',     expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/clients/Acme%20Corp',    marker: 'Acme Corp',             expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: '/categories/Admin',       marker: 'Admin',                 expected: { admin: ALLOW, attorney: ADMIN_REQUIRED, partial: ALLOW } },
  { path: `/users/${ATTORNEY_SLUG}`, marker: PERSONAS.attorney.name,  expected: { admin: ALLOW, attorney: ALLOW, partial: ACCESS_DENIED } },
  { path: `/users/${ADMIN_SLUG}`,    marker: PERSONAS.admin.name,     expected: { admin: ALLOW, attorney: ACCESS_DENIED, partial: ACCESS_DENIED } },
  // FIXED (was a race, not policy): a partial admin direct-loading their OWN
  // /users page now lands on it and renders their attorney detail view. The
  // race had two layers: ProtectedRoute treating a not-yet-loaded users cache
  // as an email mismatch (decideRoute usersLoading fix), and
  // FirestoreDataContext settling loading=false before auth had resolved
  // (authLoading guard in the fetch-on-auth effect). Only a definitive
  // mismatch (cache loaded, email differs) bounces to
  // /login?error=access_denied — which is why the attorney row here still
  // expects ACCESS_DENIED.
  { path: `/users/${PARTIAL_SLUG}`,  marker: PERSONAS.partial.name,   expected: { admin: ALLOW, attorney: ACCESS_DENIED, partial: ALLOW } },
];

// Record every main-frame navigation (full loads AND client-side history
// pushes) so transient ProtectedRoute redirects are observable even when the
// login page immediately bounces an authenticated user onward.
function trackNavigations(page) {
  const urls = [];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) urls.push(frame.url());
  });
  return urls;
}

const heading = (page, name) =>
  page.getByRole('heading', { level: 1, name, exact: true });

const OUTCOME_HANDLERS = {
  async [ALLOW](page, route) {
    const visited = trackNavigations(page);
    await page.goto(route.path);
    // A non-admin direct load of their own /users page shows the auth spinner
    // while the users cache loads (no transient /login bounce since the
    // decideRoute usersLoading + FirestoreDataContext authLoading fixes),
    // then renders the page in place.
    await expect(heading(page, route.marker)).toBeVisible({ timeout: 20_000 });
    expect(new URL(page.url()).pathname).toBe(route.path);
    // No transient access_denied bounce either — for plain attorneys the
    // home page used to silently redirect them back to their own page,
    // masking the race; assert the whole chain never happened.
    expect(visited.some((u) => u.includes('/login?error=access_denied'))).toBe(false);
  },

  async [ADMIN_REQUIRED](page, route) {
    const visited = trackNavigations(page);
    await page.goto(route.path);
    await expect
      .poll(() => visited.some((u) => u.includes('/login?error=admin_required')), { timeout: 20_000 })
      .toBe(true);
    // The guarded content never rendered (ProtectedRoute returns null pre-allow).
    await expect(heading(page, route.marker)).not.toBeVisible();
    expect(new URL(page.url()).pathname).not.toBe(route.path);
  },

  async [PARTIAL_DENIED](page, route) {
    await page.goto(route.path);
    // denyPartialAdmin redirects partial admins to the admin hub, not /login.
    await page.waitForURL((url) => url.pathname === '/admin', { timeout: 20_000 });
    await expect(heading(page, 'Admin Panel')).toBeVisible({ timeout: 20_000 });
    await expect(heading(page, route.marker)).not.toBeVisible();
  },

  async [ACCESS_DENIED](page, route) {
    const visited = trackNavigations(page);
    await page.goto(route.path);
    await expect
      .poll(() => visited.some((u) => u.includes('/login?error=access_denied')), { timeout: 20_000 })
      .toBe(true);
    await expect(heading(page, route.marker)).not.toBeVisible();
  },
};

// Persona for the current Playwright project; null under any other project.
const roleOf = (testInfo) => PROJECT_ROLES[testInfo.project.name] ?? null;

test.describe('authorization matrix', () => {
  for (const route of ROUTES) {
    test(`${route.path}`, async ({ page }) => {
      const role = roleOf(test.info());
      test.skip(!role, 'authz matrix only runs under the persona projects');

      // Seeded data is anchored to E2E_TODAY (mid-July 2026); the dashboard's
      // default current-month range needs the pinned clock to find entries.
      await page.clock.setFixedTime(new Date(E2E_TODAY));

      await OUTCOME_HANDLERS[route.expected[role]](page, route);
    });
  }
});

// ---------------------------------------------------------------------------
// "/" landing — each persona lands somewhere different (src/app/page.js).
// ---------------------------------------------------------------------------

const dashboardNav = (page) =>
  page.getByRole('navigation', { name: 'Dashboard sections' });

const FULL_TAB_SET = [
  'Overview', 'Team Members', 'Transactions', 'Ops', 'Clients', 'Targets',
  'Downloads', 'Practice Composition', 'Tech Team', 'Invoices (testing)',
  'Timesheets (testing)',
];
const RESTRICTED_TAB_SET = ['Transactions', 'Ops'];

test.describe('/ landing by role', () => {
  test('landing matches persona', async ({ page }) => {
    const role = roleOf(test.info());
    test.skip(!role, 'authz matrix only runs under the persona projects');
    await page.clock.setFixedTime(new Date(E2E_TODAY));
    await page.goto('/');

    if (role === 'admin') {
      // Full dashboard, every tab (including adminOnly ones), Overview active.
      await expect(dashboardNav(page).getByRole('button')).toHaveText(FULL_TAB_SET, { timeout: 20_000 });
      await expect(dashboardNav(page).getByRole('button', { name: 'Overview' }))
        .toHaveAttribute('aria-current', 'page');
      expect(new URL(page.url()).pathname).toBe('/');
    } else if (role === 'attorney') {
      // Plain attorneys are redirected to their own detail page.
      await page.waitForURL((url) => url.pathname === `/users/${ATTORNEY_SLUG}`, { timeout: 20_000 });
      await expect(heading(page, PERSONAS.attorney.name)).toBeVisible({ timeout: 20_000 });
    } else {
      // transactionsOpsAccess -> restricted dashboard: ONLY Transactions + Ops
      // tabs exist (blocked tabs are invisible), Transactions is the default.
      await expect(dashboardNav(page).getByRole('button')).toHaveText(RESTRICTED_TAB_SET, { timeout: 20_000 });
      await expect(dashboardNav(page).getByRole('button', { name: 'Transactions' }))
        .toHaveAttribute('aria-current', 'page');
      expect(new URL(page.url()).pathname).toBe('/');
    }
  });
});

// ---------------------------------------------------------------------------
// Restricted dashboard modes — ?tab= deep links (AnalyticsDashboard.jsx,
// resolveDashboardTab in src/utils/authzLogic.mjs). Allowlist-based: a
// transactions-ops user may deep-link ONLY transactions/ops; every other tab
// falls back to the restricted default (Transactions).
// ---------------------------------------------------------------------------

const BLOCKED_DEEP_LINK_TABS = ['tech-team', 'invoices-testing', 'timesheets-testing'];

test.describe('restricted dashboard deep links', () => {
  for (const tab of BLOCKED_DEEP_LINK_TABS) {
    test(`?tab=${tab} is ignored for transactions-ops users`, async ({ page }) => {
      const role = roleOf(test.info());
      test.skip(role !== 'partial', 'restricted mode only applies to the partial persona');
      await page.clock.setFixedTime(new Date(E2E_TODAY));

      await page.goto(`/?tab=${tab}`);
      const nav = dashboardNav(page);
      await expect(nav.getByRole('button')).toHaveText(RESTRICTED_TAB_SET, { timeout: 20_000 });
      // Deep link fell back to the restricted default tab.
      await expect(nav.getByRole('button', { name: 'Transactions' }))
        .toHaveAttribute('aria-current', 'page');
    });
  }

  // FIXED: restricted modes are allowlist-based (resolveDashboardTab in
  // src/utils/authzLogic.mjs) — a transactions-ops user deep-linking any tab
  // outside transactions/ops (?tab=overview, ?tab=clients, ...) falls back to
  // their default tab (Transactions), same as the blocked-tab deep links above.
  for (const tab of ['overview', 'clients', 'targets']) {
    test(`?tab=${tab} falls back to Transactions for transactions-ops users`, async ({ page }) => {
      const role = roleOf(test.info());
      test.skip(role !== 'partial', 'restricted mode only applies to the partial persona');
      await page.clock.setFixedTime(new Date(E2E_TODAY));

      await page.goto(`/?tab=${tab}`);
      const nav = dashboardNav(page);
      await expect(nav.getByRole('button')).toHaveText(RESTRICTED_TAB_SET, { timeout: 20_000 });
      // The deep link was ignored: the restricted default tab is active and
      // no out-of-allowlist view rendered (its button would not even exist).
      await expect(nav.getByRole('button', { name: 'Transactions' }))
        .toHaveAttribute('aria-current', 'page');
    });
  }

  // Control test proving ?tab= deep links work at all when permitted: admins
  // may deep-link an adminOnly tab directly.
  test('?tab=targets deep link works for admins', async ({ page }) => {
    const role = roleOf(test.info());
    test.skip(role !== 'admin', 'admin-only deep-link control test');
    await page.clock.setFixedTime(new Date(E2E_TODAY));

    await page.goto('/?tab=targets');
    await expect(dashboardNav(page).getByRole('button', { name: 'Targets' }))
      .toHaveAttribute('aria-current', 'page', { timeout: 20_000 });
  });
});
