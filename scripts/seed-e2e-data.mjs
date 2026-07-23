#!/usr/bin/env node
/**
 * Seed the Firestore EMULATOR with the deterministic E2E dataset defined in
 * tests/e2e/fixtures.mjs (the single source of truth for both this seed and
 * the spec assertions in tests/e2e/*.spec.mjs).
 *
 * Runs inside `firebase emulators:exec` (see the test:e2e npm script), which
 * sets FIRESTORE_EMULATOR_HOST + GCLOUD_PROJECT for us:
 *   npx firebase emulators:exec --only auth,firestore --project demo-cedar-grove \
 *     'node scripts/seed-e2e-data.mjs'
 *
 * SAFETY: refuses to run without FIRESTORE_EMULATOR_HOST so it can never
 * touch production Firestore (the Admin SDK bypasses security rules).
 */

import { getDb } from './lib/firestore.mjs';
import { SEED, E2E_TODAY } from '../tests/e2e/fixtures.mjs';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error(
    'seed-e2e-data: FIRESTORE_EMULATOR_HOST is not set — refusing to run.\n' +
    'This script only seeds the Firestore emulator. Run it via:\n' +
    "  npx firebase emulators:exec --only auth,firestore --project demo-cedar-grove 'node scripts/seed-e2e-data.mjs'"
  );
  process.exit(1);
}

process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'demo-cedar-grove';

async function main() {
  const db = getDb();
  let writes = 0;
  const set = async (ref, data) => {
    await ref.set(data);
    writes += 1;
  };

  // users/{displayName} + billables/ops subcollections
  for (const u of SEED.users) {
    const userRef = db.collection('users').doc(u.id);
    await set(userRef, u.doc);
    for (const [monthKey, docData] of Object.entries(u.billablesDocs)) {
      await set(userRef.collection('billables').doc(monthKey), docData);
    }
    for (const [monthKey, docData] of Object.entries(u.opsDocs)) {
      await set(userRef.collection('ops').doc(monthKey), docData);
    }
    console.log(`seeded users/${u.id} (${Object.keys(u.billablesDocs).length} billables docs, ${Object.keys(u.opsDocs).length} ops docs)`);
  }

  // clients/all
  await set(db.collection('clients').doc('all'), {
    clients: SEED.clients,
    totalClients: SEED.clients.length,
    lastSyncedAt: E2E_TODAY,
  });

  // invoices/all
  await set(db.collection('invoices').doc('all'), {
    entries: SEED.invoices,
    entryCount: SEED.invoices.length,
    syncedAt: E2E_TODAY,
  });

  // monthlyMetrics/all
  await set(db.collection('monthlyMetrics').doc('all'), {
    entries: SEED.monthlyMetrics,
    entryCount: SEED.monthlyMetrics.length,
    lastSyncedAt: E2E_TODAY,
  });

  // rateCard/all
  await set(db.collection('rateCard').doc('all'), SEED.rateCard);

  // timeOff/all (empty holidays/OOO — present so the synced doc is authoritative)
  await set(db.collection('timeOff').doc('all'), SEED.timeOff);

  // admins/{email} — document existence = full admin
  for (const email of SEED.adminEmails) {
    await set(db.collection('admins').doc(email.toLowerCase()), {
      addedBy: 'scripts/seed-e2e-data.mjs',
      addedAt: E2E_TODAY,
    });
  }

  // permissions/{email} — partial-admin grant, mirroring scripts/seed-permissions.mjs
  for (const [email, flags] of Object.entries(SEED.permissions)) {
    await set(db.collection('permissions').doc(email.toLowerCase()), {
      ...flags,
      updatedAt: E2E_TODAY,
      updatedBy: 'scripts/seed-e2e-data.mjs',
    });
  }

  console.log(`seed-e2e-data: wrote ${writes} docs to ${process.env.FIRESTORE_EMULATOR_HOST} (project ${process.env.GCLOUD_PROJECT})`);
}

main().catch((err) => {
  console.error('seed-e2e-data failed:', err);
  process.exit(1);
});
