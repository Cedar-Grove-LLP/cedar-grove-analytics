#!/usr/bin/env node
/**
 * One-time migration: lower-case/trim users/{id}.email for any user doc
 * saved before RoleManagementTab.jsx's bulk "Save All Changes" path started
 * normalizing email on write (see the security-audit-fix PR that added the
 * scoped `where('email','==', ...)` query in FirestoreDataContext.js).
 *
 * FirestoreDataContext.js now looks up a plain (non-elevated) user's own
 * profile with an exact-match Firestore query on the lower-cased signed-in
 * email. A user doc saved with a mixed-case or untrimmed email by the old
 * (pre-fix) Role Management UI would silently match zero documents,
 * presenting as "No attorney profile found for your account" until an
 * admin happens to re-save that row.
 *
 * Usage:
 *   node scripts/normalize-user-emails.mjs          # dry run (default)
 *   node scripts/normalize-user-emails.mjs --apply  # write to Firestore
 *
 * Credentials (loaded from .env.local automatically; see scripts/lib/firestore.mjs):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{...service account JSON...}'
 *   or GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * Idempotent — a user whose email is already trimmed/lower-case is a no-op.
 */

import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';

const APPLY = process.argv.includes('--apply');

async function main() {
  loadEnvFile('.env.local');
  const db = getDb();

  const usersSnap = await db.collection('users').get();
  console.log(`Loaded ${usersSnap.size} users. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const rows = [];
  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    const name = user.name || userDoc.id;
    const email = user.email;

    if (!email) {
      rows.push({ name, status: 'skip (no email)', before: '', after: '' });
      continue;
    }

    const normalized = email.trim().toLowerCase();
    if (normalized === email) {
      rows.push({ name, status: 'skip (already normalized)', before: email, after: '' });
      continue;
    }

    rows.push({ name, status: APPLY ? 'WRITE' : 'would write', before: email, after: normalized });
    if (APPLY) {
      await userDoc.ref.update({ email: normalized });
    }
  }

  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('Attorney', 26)}${pad('Status', 26)}${pad('Before', 30)}After`);
  console.log('-'.repeat(100));
  for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${pad(r.name, 26)}${pad(r.status, 26)}${pad(r.before || '—', 30)}${r.after || '—'}`);
  }

  const changed = rows.filter((r) => r.status === 'WRITE' || r.status === 'would write').length;
  console.log(`\n${APPLY ? 'Normalized' : 'Would normalize'} email for ${changed} user(s).`);
  if (!APPLY && changed > 0) console.log('Re-run with --apply to persist.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
