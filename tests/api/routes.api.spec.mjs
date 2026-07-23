/**
 * Request-level auth-gate tests for the API routes — the `api` Playwright
 * project (see playwright.config.mjs). Runs against the same running Next
 * server as the e2e suite (baseURL from config) using Playwright's `request`
 * fixture only; no browser page, no storageState.
 *
 * For each gated route we assert the auth gate's exact behavior:
 *   1. no Authorization header      -> 401 with the route's exact body shape
 *   2. garbage Bearer token         -> 401 with the same body
 *   3. verified non-admin domain user's ID token ->
 *        - 403 on the three admin-gated routes (no admins/{email} doc)
 *        - PAST the gate on /api/commit-history (requireAdminDoc: false):
 *          the downstream GitHub fetch may fail without a token, so we only
 *          assert the status is not 401/403.
 *
 * Token minting: the Auth EMULATOR accepts fake IdP credentials on
 * accounts:signInWithIdp — a plain-JSON `id_token` with `email_verified: true`
 * — which is the simplest way to get a VERIFIED domain user (password sign-ups
 * are unverified, and src/app/api/_lib/authGate.js rejects unverified emails
 * with 403 before the admin-doc check, which would make the commit-history
 * "past the gate" case untestable). The minted user is on the allowed
 * @cedargrovellp.com domain but is NOT in the seeded admins collection
 * (scripts/seed-e2e-data.mjs seeds only admin@cedargrovellp.com).
 */

import { test, expect } from '@playwright/test';

const AUTH_EMULATOR_HOST =
  process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';

// Domain user absent from the seeded admins/{email} docs — distinct from the
// e2e personas so IdP sign-in can never collide with their password accounts.
const NON_ADMIN_EMAIL = 'api-tests@cedargrovellp.com';

/**
 * Mint a verified @cedargrovellp.com ID token from the Auth emulator via the
 * fake-IdP REST flow. Idempotent — re-signing-in the same fake Google account
 * returns a fresh token for the same emulator user.
 */
async function mintVerifiedDomainToken(request) {
  const fakeIdpToken = JSON.stringify({
    sub: 'api-tests-non-admin',
    email: NON_ADMIN_EMAIL,
    email_verified: true,
  });
  const res = await request.post(
    `http://${AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key=fake-api-key`,
    {
      data: {
        postBody: `id_token=${encodeURIComponent(fakeIdpToken)}&providerId=google.com`,
        requestUri: 'http://localhost',
        returnIdpCredential: true,
        returnSecureToken: true,
      },
    }
  );
  expect(res.ok(), `auth emulator signInWithIdp failed: ${res.status()}`).toBe(true);
  const body = await res.json();
  expect(typeof body.idToken).toBe('string');
  return body.idToken;
}

// One entry per gated route. `unauthorizedBody`/`forbiddenBody` are the EXACT
// JSON bodies each route's buildError produces (invoices-workbook has no
// `success` field; the other three include it).
const ROUTES = [
  {
    path: '/api/sync-transactions',
    method: 'post',
    adminGated: true,
    unauthorizedBody: { success: false, error: 'Unauthorized' },
    forbiddenBody: { success: false, error: 'Forbidden' },
  },
  {
    path: '/api/check-reminder-sends',
    method: 'post',
    adminGated: true,
    unauthorizedBody: { success: false, error: 'Unauthorized' },
    forbiddenBody: { success: false, error: 'Forbidden' },
  },
  {
    path: '/api/invoices-workbook',
    method: 'get',
    adminGated: true,
    unauthorizedBody: { error: 'Unauthorized' },
    forbiddenBody: { error: 'Forbidden' },
  },
  {
    path: '/api/commit-history',
    method: 'get',
    adminGated: false, // requireAdminDoc: false — any verified domain user passes
    unauthorizedBody: { success: false, error: 'Unauthorized' },
  },
];

const call = (request, route, headers) =>
  request[route.method](route.path, { headers });

for (const route of ROUTES) {
  test.describe(`${route.method.toUpperCase()} ${route.path}`, () => {
    test('no auth header -> 401 with exact body', async ({ request }) => {
      const res = await call(request, route);
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual(route.unauthorizedBody);
    });

    test('garbage Bearer token -> 401 with exact body', async ({ request }) => {
      const res = await call(request, route, {
        Authorization: 'Bearer not-a-real-token',
      });
      expect(res.status()).toBe(401);
      expect(await res.json()).toEqual(route.unauthorizedBody);
    });

    if (route.adminGated) {
      test('verified non-admin domain token -> 403 with exact body', async ({ request }) => {
        const idToken = await mintVerifiedDomainToken(request);
        const res = await call(request, route, {
          Authorization: `Bearer ${idToken}`,
        });
        expect(res.status()).toBe(403);
        expect(await res.json()).toEqual(route.forbiddenBody);
      });
    } else {
      test('verified non-admin domain token gets past the gate', async ({ request }) => {
        const idToken = await mintVerifiedDomainToken(request);
        const res = await call(request, route, {
          Authorization: `Bearer ${idToken}`,
        });
        // The gate would have returned 401/403; anything else (200, or a
        // 5xx from the downstream GitHub fetch) proves the token was accepted.
        expect([401, 403]).not.toContain(res.status());
      });
    }
  });
}
