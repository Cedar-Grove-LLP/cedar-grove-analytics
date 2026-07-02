#!/usr/bin/env node
/**
 * One-time migration: seed permissions/{email} docs from the hardcoded
 * email allowlists that used to live in src/utils/{partialAdminAccess,
 * downloadsAccess,transactionsOpsAccess}.js (see SEC-016 in the security
 * audit). Run this once after deploying the updated firestore.rules and
 * app code so the two people who currently have elevated access don't
 * lose it on cutover.
 *
 * Usage:
 *   node scripts/seed-permissions.mjs          # dry run (default)
 *   node scripts/seed-permissions.mjs --apply  # write to Firestore
 *
 * Credentials (loaded from .env.local automatically; see scripts/lib/firestore.mjs):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{...service account JSON...}'
 *   or GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * Idempotent — re-running after --apply just overwrites the same flags.
 */

import { FieldValue } from 'firebase-admin/firestore';
import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';

const APPLY = process.argv.includes('--apply');

// Mirrors the allowlists removed from src/utils/*Access.js. Update this
// list (and re-run with --apply) instead of editing source going forward
// — grants are now managed via Admin -> User Management -> Permissions.
const GRANTS = [
  { email: 'valery@cedargrovellp.com', partialAdmin: true, transactionsOpsAccess: true },
  { email: 'michael@cedargrovellp.com', downloadsAccess: true },
];

async function main() {
  loadEnvFile('.env.local');
  const db = getDb();

  console.log(`Seeding ${GRANTS.length} permission grant(s). Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  for (const grant of GRANTS) {
    const email = grant.email.toLowerCase();
    const { email: _email, ...flags } = grant;
    console.log(`${APPLY ? 'WRITE' : 'would write'} permissions/${email}:`, flags);

    if (APPLY) {
      await db.collection('permissions').doc(email).set({
        ...flags,
        updatedAt: FieldValue.serverTimestamp(),
        updatedBy: 'scripts/seed-permissions.mjs',
      }, { merge: true });
    }
  }

  if (!APPLY) console.log('\nRe-run with --apply to persist.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
