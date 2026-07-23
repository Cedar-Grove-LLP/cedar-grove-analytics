/**
 * Playwright "setup" project (see playwright.config.mjs): signs each persona
 * in against the Auth EMULATOR via the window.__testAuth hook exposed by
 * emulator builds (src/firebase/config.js, `npm run build:e2e`), then saves
 * per-role storage state (IndexedDB included — Firebase Auth persists its
 * session there, not in cookies/localStorage) for the chromium-admin /
 * chromium-attorney / chromium-partial projects.
 *
 * Personas + password come from tests/e2e/fixtures.mjs; the matching
 * Firestore data (admins doc, permissions doc, users docs) must already be
 * seeded by scripts/seed-e2e-data.mjs — test:e2e runs both in order.
 */

import { test as setup } from '@playwright/test';
import { PERSONAS, PASSWORD } from './fixtures.mjs';

for (const persona of Object.values(PERSONAS)) {
  setup(`authenticate ${persona.role} (${persona.email})`, async ({ page }) => {
    await page.goto('/login');

    // __testAuth only exists on emulator builds — fail loudly otherwise.
    await page.waitForFunction(() => Boolean(window.__testAuth), null, { timeout: 15000 })
      .catch(() => {
        throw new Error(
          'window.__testAuth is not present. The app under test must be built ' +
          'with `npm run build:e2e` (NEXT_PUBLIC_USE_FIREBASE_EMULATORS=1).'
        );
      });

    // First run creates the emulator user; reruns fall back to sign-in.
    await page.evaluate(async ({ email, password }) => {
      const { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword } = window.__testAuth;
      try {
        await createUserWithEmailAndPassword(auth, email, password);
      } catch (err) {
        if (err && err.code === 'auth/email-already-in-use') {
          await signInWithEmailAndPassword(auth, email, password);
        } else {
          throw err;
        }
      }
    }, { email: persona.email, password: PASSWORD });

    // The login page redirects authorized users away from /login (admins to
    // the dashboard, attorneys onward to their own page) — leaving /login is
    // the signal that authorization resolved against the seeded Firestore.
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), { timeout: 20000 });

    await page.context().storageState({ path: persona.storageState, indexedDB: true });
  });
}
