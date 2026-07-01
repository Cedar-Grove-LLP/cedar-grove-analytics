/**
 * One-time backfill: set users/{id}.activationDate from each attorney's
 * first month of logged activity (earliest billable OR ops entry).
 *
 * Policy (agreed):
 *   - Only fills users whose activationDate is currently blank/null — never
 *     overwrites a manually-set value.
 *   - "First activity" = earliest parent-doc month/year across the user's
 *     billables + ops subcollections (see deriveActivationMonth). Per-entry
 *     dates are ignored because they can drift outside their month.
 *   - Writes a "YYYY-MM" string, matching the <input type="month"> admin UI.
 *
 * Usage:
 *   node scripts/backfill-activation-dates.mjs          # dry run (default)
 *   node scripts/backfill-activation-dates.mjs --apply  # write to Firestore
 *
 * Credentials: reads FIREBASE_SERVICE_ACCOUNT_KEY from .env.local (admin SDK,
 * bypasses security rules). Idempotent — re-running after --apply is a no-op
 * because every filled user now has a value.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import admin from 'firebase-admin';
import { deriveActivationMonth } from '../src/utils/userActivation.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const APPLY = process.argv.includes('--apply');

function loadServiceAccount() {
  const envPath = path.join(repoRoot, '.env.local');
  const raw = readFileSync(envPath, 'utf8');
  // Grab the JSON value on the FIREBASE_SERVICE_ACCOUNT_KEY line (single line).
  const line = raw.split('\n').find((l) => l.startsWith('FIREBASE_SERVICE_ACCOUNT_KEY='));
  if (!line) throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY not found in .env.local');
  const json = line.slice('FIREBASE_SERVICE_ACCOUNT_KEY='.length).trim();
  return JSON.parse(json);
}

async function collectPeriods(db, userId, subcollection) {
  // We only need each month-doc's period (month/year), and only when the doc
  // actually holds entries — an empty month doc is not "activity".
  const snap = await db.collection('users').doc(userId).collection(subcollection).get();
  const periods = [];
  snap.forEach((doc) => {
    const data = doc.data();
    if (Array.isArray(data.entries) && data.entries.length > 0) {
      periods.push({ month: data.month, year: data.year });
    }
  });
  return periods;
}

async function main() {
  admin.initializeApp({ credential: admin.credential.cert(loadServiceAccount()) });
  const db = admin.firestore();

  const usersSnap = await db.collection('users').get();
  console.log(`Loaded ${usersSnap.size} users. Mode: ${APPLY ? 'APPLY' : 'DRY RUN'}\n`);

  const rows = [];
  for (const userDoc of usersSnap.docs) {
    const user = userDoc.data();
    const name = user.name || userDoc.id;
    const existing = user.activationDate;

    if (existing) {
      rows.push({ name, status: 'skip (already set)', existing, derived: '' });
      continue;
    }

    const [billables, ops] = await Promise.all([
      collectPeriods(db, userDoc.id, 'billables'),
      collectPeriods(db, userDoc.id, 'ops'),
    ]);
    const derived = deriveActivationMonth([...billables, ...ops]);

    if (!derived) {
      rows.push({ name, status: 'skip (no activity)', existing: '', derived: '' });
      continue;
    }

    rows.push({ name, status: APPLY ? 'WRITE' : 'would write', existing: '', derived });
    if (APPLY) {
      await userDoc.ref.update({ activationDate: derived });
    }
  }

  // Report
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad('Attorney', 26)}${pad('Status', 22)}${pad('Existing', 12)}Derived`);
  console.log('-'.repeat(72));
  for (const r of rows.sort((a, b) => a.name.localeCompare(b.name))) {
    console.log(`${pad(r.name, 26)}${pad(r.status, 22)}${pad(r.existing || '—', 12)}${r.derived || '—'}`);
  }

  const wrote = rows.filter((r) => r.derived && (r.status === 'WRITE' || r.status === 'would write')).length;
  console.log(`\n${APPLY ? 'Wrote' : 'Would write'} activationDate for ${wrote} user(s).`);
  if (!APPLY && wrote > 0) console.log('Re-run with --apply to persist.');

  await admin.app().delete();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
