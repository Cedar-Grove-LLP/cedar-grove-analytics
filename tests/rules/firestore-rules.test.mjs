// Emulator test suite for firestore.rules — the authoritative security
// boundary of the app (browser-to-Firestore SPA, no REST layer).
//
// Run via `npm run test:rules`:
//   firebase emulators:exec --only firestore --project demo-cedar-grove \
//     'node --test tests/rules/'
//
// Deliberately OUTSIDE the flat `npm test` glob (tests/*.test.mjs) because it
// needs a running Firestore emulator.
//
// The value of this suite is the DENY cases: every collection's read AND
// write surface is pinned, per principal:
//   unauth      — no auth at all
//   noEmail     — signed in but token has no email (signedIn() must reject)
//   alice/bob   — plain domain users (own users/{userId} doc seeded)
//   noflags     — domain user whose permissions doc has only false flags
//   partial     — permissions/{email}.partialAdmin == true
//   downloads   — permissions/{email}.downloadsAccess == true
//   txops       — permissions/{email}.transactionsOpsAccess == true
//   admin       — admins/{email} doc exists
//   outsider    — signed in with a NON-@cedargrovellp.com email

import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} from '@firebase/rules-unit-testing';

const rulesPath = fileURLToPath(new URL('../../firestore.rules', import.meta.url));

const testEnv = await initializeTestEnvironment({
  projectId: 'demo-cedar-grove',
  firestore: { rules: readFileSync(rulesPath, 'utf8') },
});

await testEnv.clearFirestore();

// ---------------------------------------------------------------------------
// Seed (rules disabled — mimics the service-account sync pipelines, which
// bypass rules entirely).
// ---------------------------------------------------------------------------
await testEnv.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  const seeds = [
    ['admins/admin@cedargrovellp.com', { grantedBy: 'seed' }],
    ['permissions/partial@cedargrovellp.com', { partialAdmin: true }],
    ['permissions/downloads@cedargrovellp.com', { downloadsAccess: true }],
    ['permissions/txops@cedargrovellp.com', { transactionsOpsAccess: true }],
    ['permissions/noflags@cedargrovellp.com', { partialAdmin: false, downloadsAccess: false, transactionsOpsAccess: false }],
    ['permissions/stringflag@cedargrovellp.com', { partialAdmin: 'true' }], // wrong type, must NOT grant
    // users/{userId} doc ids are display names; ownership is matched by the
    // profile's email field (isOwnUserDoc / isOwnUserId).
    ['users/Alice', { name: 'Alice', email: 'alice@cedargrovellp.com', role: 'Attorney', rates: [{ rate: 300, month: 1, year: 2026 }], targets: [{ month: 1, year: 2026, billableHours: 100 }] }],
    ['users/Bob', { name: 'Bob', email: 'bob@cedargrovellp.com', rates: [], targets: [] }],
    ['users/NoFlags', { name: 'No Flags', email: 'noflags@cedargrovellp.com' }],
    ['users/NoEmail', { name: 'Profile Without Email Field' }],
    ['users/Alice/billables/2026-01', { month: 1, year: 2026, entries: [] }],
    ['users/Alice/ops/2026-01', { month: 1, year: 2026, entries: [] }],
    ['users/Alice/eightThreeB/2026-01', { month: 1, year: 2026, entries: [] }],
    ['users/Alice/opsManual/e1', { date: '2026-01-05', hours: 1, category: 'Admin' }],
    ['users/Alice/billablesManual/e1', { date: '2026-01-05', hours: 2, client: 'C' }],
    ['clients/all', { clients: [], totalClients: 0 }],
    ['invoices/all', { entries: [], entryCount: 0 }],
    ['monthlyMetrics/all', { entries: [], entryCount: 0 }],
    ['rateCard/all', { levels: [], year: 2026 }],
    ['driveDownloads/2026-02', { month: '2026-02', totalDownloads: 0 }],
    ['timeOff/all', { holidays: [], outOfOffice: [] }],
    ['matters/m1', { name: 'General', clientName: 'Acme' }],
    ['clientAliases/a1', { alias: 'ACME' }],
    ['transactions/t1', { id: 't1', amount: 100 }],
    // Collections with NO explicit rule — must hit the deny-by-default match.
    ['attorneys/Legacy', { name: 'Legacy Attorney' }], // SEC-006
    ['downloads/d1', { file: 'x' }], // SEC-007
  ];
  for (const [path, data] of seeds) await db.doc(path).set(data);
});

after(async () => {
  await testEnv.cleanup();
});

// ---------------------------------------------------------------------------
// Principals
// ---------------------------------------------------------------------------
const unauth = testEnv.unauthenticatedContext().firestore();
const noEmail = testEnv.authenticatedContext('no-email-uid').firestore(); // token has no email claim
const admin = testEnv.authenticatedContext('admin-uid', { email: 'admin@cedargrovellp.com' }).firestore();
// SEC-017: mixed-case token email must still resolve admin/self lookups.
const adminUpper = testEnv.authenticatedContext('admin-upper-uid', { email: 'Admin@CedarGroveLLP.com' }).firestore();
const alice = testEnv.authenticatedContext('alice-uid', { email: 'alice@cedargrovellp.com' }).firestore();
const aliceUpper = testEnv.authenticatedContext('alice-upper-uid', { email: 'Alice@CedarGroveLLP.com' }).firestore();
const bob = testEnv.authenticatedContext('bob-uid', { email: 'bob@cedargrovellp.com' }).firestore();
const noflags = testEnv.authenticatedContext('noflags-uid', { email: 'noflags@cedargrovellp.com' }).firestore();
const stringflag = testEnv.authenticatedContext('stringflag-uid', { email: 'stringflag@cedargrovellp.com' }).firestore();
const partial = testEnv.authenticatedContext('partial-uid', { email: 'partial@cedargrovellp.com' }).firestore();
const downloads = testEnv.authenticatedContext('downloads-uid', { email: 'downloads@cedargrovellp.com' }).firestore();
const txops = testEnv.authenticatedContext('txops-uid', { email: 'txops@cedargrovellp.com' }).firestore();
const outsider = testEnv.authenticatedContext('outsider-uid', { email: 'evil@gmail.com' }).firestore();

// ---------------------------------------------------------------------------
// Unauthenticated: denied everywhere
// ---------------------------------------------------------------------------

test('unauthenticated: every collection read is denied', async () => {
  const paths = [
    'users/Alice',
    'users/Alice/billables/2026-01',
    'users/Alice/ops/2026-01',
    'users/Alice/eightThreeB/2026-01',
    'users/Alice/opsManual/e1',
    'users/Alice/billablesManual/e1',
    'admins/admin@cedargrovellp.com',
    'permissions/partial@cedargrovellp.com',
    'clients/all',
    'invoices/all',
    'monthlyMetrics/all',
    'rateCard/all',
    'driveDownloads/2026-02',
    'timeOff/all',
    'matters/m1',
    'clientAliases/a1',
    'transactions/t1',
    'attorneys/Legacy',
    'downloads/d1',
  ];
  for (const path of paths) {
    await assertFails(unauth.doc(path).get());
  }
  await assertFails(unauth.collection('users').get());
  await assertFails(unauth.collection('admins').get());
});

test('unauthenticated: writes are denied, including the SEC-007 downloads create', async () => {
  await assertFails(unauth.doc('users/Alice').set({ role: 'Partner' }, { merge: true }));
  await assertFails(unauth.doc('timeOff/all').set({ holidays: [] }));
  // SEC-007: downloads/{*} used to allow unauthenticated create.
  await assertFails(unauth.doc('downloads/new').set({ file: 'y' }));
  await assertFails(unauth.doc('matters/new').set({ name: 'X' }));
});

// ---------------------------------------------------------------------------
// signedIn() helper edge: auth token WITHOUT an email string
// ---------------------------------------------------------------------------

test('signed-in token with no email claim fails signedIn() — even the firm-wide timeOff read is denied', async () => {
  await assertFails(noEmail.doc('timeOff/all').get());
  await assertFails(noEmail.doc('users/Alice').get());
  await assertFails(noEmail.doc('clients/all').get());
});

test('rules do NOT enforce the @cedargrovellp.com domain — any signed-in email passes signedIn()', async () => {
  // Documents CURRENT behavior: domain restriction lives in Firebase Auth /
  // AuthContext, not in these rules. An outsider email that somehow signs in
  // can read timeOff/all (the only signedIn()-wide collection) but nothing
  // gated behind admin/permission/ownership checks.
  await assertSucceeds(outsider.doc('timeOff/all').get());
  await assertFails(outsider.doc('users/Alice').get());
  await assertFails(outsider.doc('clients/all').get());
  await assertFails(outsider.doc('invoices/all').get());
});

// ---------------------------------------------------------------------------
// users/{userId} — profile docs (rates/targets = comp data)
// ---------------------------------------------------------------------------

test('users: attorney can read own profile (matched by email field, not doc id)', async () => {
  await assertSucceeds(alice.doc('users/Alice').get());
});

test('users: SEC-017 — mixed-case token email still matches own profile', async () => {
  await assertSucceeds(aliceUpper.doc('users/Alice').get());
});

test('users: plain attorney cannot read another attorney profile (comp data)', async () => {
  await assertFails(bob.doc('users/Alice').get());
  await assertFails(alice.doc('users/Bob').get());
});

test('users: profile doc without an email field is unreadable by plain users, readable by admin', async () => {
  await assertFails(alice.doc('users/NoEmail').get());
  await assertSucceeds(admin.doc('users/NoEmail').get());
});

test('users: admin and all elevated permission flags can read any profile', async () => {
  await assertSucceeds(admin.doc('users/Alice').get());
  await assertSucceeds(adminUpper.doc('users/Alice').get());
  await assertSucceeds(partial.doc('users/Alice').get());
  await assertSucceeds(downloads.doc('users/Alice').get());
  await assertSucceeds(txops.doc('users/Alice').get());
});

test('users: a permissions doc with only false flags grants nothing beyond own profile', async () => {
  await assertFails(noflags.doc('users/Alice').get());
  await assertSucceeds(noflags.doc('users/NoFlags').get()); // own doc still works
});

test('users: permission flag of the wrong type ("true" string) grants nothing', async () => {
  await assertFails(stringflag.doc('users/Alice').get());
  await assertFails(stringflag.doc('clients/all').get());
});

test('users: full list is admin/elevated only', async () => {
  await assertSucceeds(admin.collection('users').get());
  await assertSucceeds(partial.collection('users').get());
  // A plain attorney cannot list all users (list would expose other docs).
  await assertFails(alice.collection('users').get());
});

test('users: writes require full admin — even on your OWN profile (SEC-002)', async () => {
  await assertFails(alice.doc('users/Alice').set({ rates: [{ rate: 999, month: 1, year: 2026 }] }, { merge: true }));
  await assertFails(alice.doc('users/Alice').delete());
  await assertFails(bob.doc('users/Alice').set({ role: 'Partner' }, { merge: true }));
  await assertFails(partial.doc('users/Alice').set({ note: 'x' }, { merge: true })); // partial admin is NOT enough
  await assertSucceeds(admin.doc('users/Alice').set({ note: 'admin-touch' }, { merge: true }));
});

// ---------------------------------------------------------------------------
// users/{userId}/billables|ops|eightThreeB — sheet-synced, write:false
// ---------------------------------------------------------------------------

test('user subcollections (billables/ops/eightThreeB): own + elevated can read, others cannot', async () => {
  for (const sub of ['billables', 'ops', 'eightThreeB']) {
    const path = `users/Alice/${sub}/2026-01`;
    await assertSucceeds(alice.doc(path).get());
    await assertSucceeds(admin.doc(path).get());
    await assertSucceeds(partial.doc(path).get());
    await assertSucceeds(downloads.doc(path).get());
    await assertSucceeds(txops.doc(path).get());
    await assertFails(bob.doc(path).get());
    await assertFails(noflags.doc(path).get());
    await assertFails(outsider.doc(path).get());
  }
});

test('user subcollections (billables/ops/eightThreeB): client writes denied for EVERYONE, admin included', async () => {
  for (const sub of ['billables', 'ops', 'eightThreeB']) {
    const path = `users/Alice/${sub}/2026-01`;
    await assertFails(admin.doc(path).set({ entries: [] }, { merge: true }));
    await assertFails(alice.doc(path).set({ entries: [] }, { merge: true }));
    await assertFails(admin.doc(path).delete());
    await assertFails(admin.doc(`users/Alice/${sub}/2026-02`).set({ month: 2, year: 2026 }));
  }
});

// ---------------------------------------------------------------------------
// users/{userId}/opsManual|billablesManual — app-owned manual entry
// ---------------------------------------------------------------------------

test('manual entry subcollections: owner and admin can read AND write', async () => {
  for (const sub of ['opsManual', 'billablesManual']) {
    await assertSucceeds(alice.doc(`users/Alice/${sub}/e1`).get());
    await assertSucceeds(alice.doc(`users/Alice/${sub}/self-${sub}`).set({ date: '2026-01-06', hours: 1 }));
    await assertSucceeds(admin.doc(`users/Alice/${sub}/e1`).get());
    await assertSucceeds(admin.doc(`users/Alice/${sub}/admin-${sub}`).set({ date: '2026-01-07', hours: 1 }));
  }
});

test('manual entry subcollections: non-owner attorneys cannot read or write; elevated flags read but do NOT write', async () => {
  for (const sub of ['opsManual', 'billablesManual']) {
    const path = `users/Alice/${sub}/e1`;
    await assertFails(bob.doc(path).get());
    await assertFails(bob.doc(path).set({ hours: 99 }, { merge: true }));
    await assertFails(bob.doc(`users/Alice/${sub}/bob-injects`).set({ hours: 1 }));
    // hasFullDataAccess() grants read; write needs isAdmin() || owner.
    await assertSucceeds(partial.doc(path).get());
    await assertFails(partial.doc(path).set({ hours: 99 }, { merge: true }));
    await assertSucceeds(downloads.doc(path).get());
    await assertFails(downloads.doc(`users/Alice/${sub}/dl-injects`).set({ hours: 1 }));
  }
});

// ---------------------------------------------------------------------------
// admins/{email}
// ---------------------------------------------------------------------------

test('admins: self-get allowed (AuthContext "am I an admin" check), even when the doc does not exist', async () => {
  await assertSucceeds(admin.doc('admins/admin@cedargrovellp.com').get());
  // Non-admin checking their own (absent) doc must succeed, not error.
  await assertSucceeds(alice.doc('admins/alice@cedargrovellp.com').get());
  // SEC-017: mixed-case token email self-get against the lower-cased doc id.
  await assertSucceeds(aliceUpper.doc('admins/alice@cedargrovellp.com').get());
  await assertSucceeds(adminUpper.doc('admins/admin@cedargrovellp.com').get());
});

test('admins: non-admins cannot get someone ELSE\'s admin doc (cannot probe the admin list)', async () => {
  await assertFails(alice.doc('admins/admin@cedargrovellp.com').get());
  await assertFails(partial.doc('admins/admin@cedargrovellp.com').get());
  await assertFails(outsider.doc('admins/admin@cedargrovellp.com').get());
});

test('admins: only full admins can list the admin collection', async () => {
  await assertSucceeds(admin.collection('admins').get());
  await assertFails(alice.collection('admins').get());
  await assertFails(partial.collection('admins').get()); // partial admin must not enumerate admins
  await assertFails(downloads.collection('admins').get());
});

test('admins: only full admins can grant/revoke admin — no self-promotion path', async () => {
  await assertSucceeds(admin.doc('admins/newadmin@cedargrovellp.com').set({ grantedBy: 'admin' }));
  await assertFails(alice.doc('admins/alice@cedargrovellp.com').set({})); // self-promotion
  await assertFails(partial.doc('admins/partial@cedargrovellp.com').set({})); // partial-admin escalation
  await assertFails(txops.doc('admins/txops@cedargrovellp.com').set({}));
  await assertFails(alice.doc('admins/admin@cedargrovellp.com').delete()); // demoting an admin
});

// ---------------------------------------------------------------------------
// permissions/{email} (SEC-016)
// ---------------------------------------------------------------------------

test('permissions: self-get allowed so AuthContext can resolve flags on sign-in', async () => {
  await assertSucceeds(partial.doc('permissions/partial@cedargrovellp.com').get());
  await assertSucceeds(alice.doc('permissions/alice@cedargrovellp.com').get()); // absent doc, still allowed
});

test('permissions: non-admins cannot read others\' permission docs or list the collection', async () => {
  await assertFails(alice.doc('permissions/partial@cedargrovellp.com').get());
  await assertFails(partial.doc('permissions/downloads@cedargrovellp.com').get());
  await assertFails(alice.collection('permissions').get());
  await assertFails(partial.collection('permissions').get());
  await assertSucceeds(admin.doc('permissions/partial@cedargrovellp.com').get());
  await assertSucceeds(admin.collection('permissions').get());
});

test('permissions: only full admins can write — flags cannot be self-granted', async () => {
  await assertSucceeds(admin.doc('permissions/granted@cedargrovellp.com').set({ downloadsAccess: true }));
  await assertFails(alice.doc('permissions/alice@cedargrovellp.com').set({ partialAdmin: true }));
  await assertFails(partial.doc('permissions/partial@cedargrovellp.com').set({ partialAdmin: true, downloadsAccess: true }, { merge: true }));
  await assertFails(noflags.doc('permissions/noflags@cedargrovellp.com').set({ partialAdmin: true }, { merge: true }));
});

// ---------------------------------------------------------------------------
// Firm-wide analytics: clients / monthlyMetrics / rateCard / driveDownloads
// (read = hasFullDataAccess(), write = false)
// ---------------------------------------------------------------------------

test('analytics collections: readable by admin + every elevated flag, denied to plain users', async () => {
  const paths = ['clients/all', 'monthlyMetrics/all', 'rateCard/all', 'driveDownloads/2026-02'];
  for (const path of paths) {
    await assertSucceeds(admin.doc(path).get());
    await assertSucceeds(partial.doc(path).get());
    await assertSucceeds(downloads.doc(path).get());
    await assertSucceeds(txops.doc(path).get());
    await assertFails(alice.doc(path).get());
    await assertFails(noflags.doc(path).get());
    await assertFails(outsider.doc(path).get());
  }
});

test('analytics collections: NOT client-writable at all — synced externally (write: if false)', async () => {
  const paths = ['clients/all', 'monthlyMetrics/all', 'rateCard/all', 'driveDownloads/2026-02'];
  for (const path of paths) {
    await assertFails(admin.doc(path).set({ tampered: true }, { merge: true }));
    await assertFails(partial.doc(path).set({ tampered: true }, { merge: true }));
    await assertFails(alice.doc(path).set({ tampered: true }, { merge: true }));
    await assertFails(admin.doc(path).delete());
  }
});

// ---------------------------------------------------------------------------
// timeOff/all — firm-wide readable, never client-writable
// ---------------------------------------------------------------------------

test('timeOff: readable by every signed-in user with an email, never client-writable', async () => {
  await assertSucceeds(alice.doc('timeOff/all').get());
  await assertSucceeds(noflags.doc('timeOff/all').get());
  await assertSucceeds(admin.doc('timeOff/all').get());
  await assertFails(admin.doc('timeOff/all').set({ holidays: [] }, { merge: true }));
  await assertFails(alice.doc('timeOff/all').set({ holidays: [] }, { merge: true }));
  await assertFails(admin.doc('timeOff/all').delete());
});

// ---------------------------------------------------------------------------
// Admin-tool collections: matters / clientAliases (admin + partial admin)
// ---------------------------------------------------------------------------

test('matters + clientAliases: read/write for admin and partial admin only', async () => {
  for (const path of ['matters/m1', 'clientAliases/a1']) {
    await assertSucceeds(admin.doc(path).get());
    await assertSucceeds(partial.doc(path).get());
    await assertSucceeds(admin.doc(path).set({ touched: 'admin' }, { merge: true }));
    await assertSucceeds(partial.doc(path).set({ touched: 'partial' }, { merge: true }));
    // downloads/txops have hasFullDataAccess but NOT these admin-tool routes.
    await assertFails(downloads.doc(path).get());
    await assertFails(txops.doc(path).get());
    await assertFails(downloads.doc(path).set({ tampered: true }, { merge: true }));
    await assertFails(alice.doc(path).get());
    await assertFails(alice.doc(path).set({ tampered: true }, { merge: true }));
  }
});

// ---------------------------------------------------------------------------
// invoices — read hasFullDataAccess(), write admin/partial only
// ---------------------------------------------------------------------------

test('invoices: read follows hasFullDataAccess (incl. downloads/txops), write is admin/partial only', async () => {
  await assertSucceeds(admin.doc('invoices/all').get());
  await assertSucceeds(partial.doc('invoices/all').get());
  await assertSucceeds(downloads.doc('invoices/all').get()); // wider than matters — see rules comment
  await assertSucceeds(txops.doc('invoices/all').get());
  await assertFails(alice.doc('invoices/all').get());
  await assertFails(noflags.doc('invoices/all').get());

  await assertSucceeds(admin.doc('invoices/all').set({ touched: 'admin' }, { merge: true }));
  await assertSucceeds(partial.doc('invoices/all').set({ touched: 'partial' }, { merge: true }));
  await assertFails(downloads.doc('invoices/all').set({ tampered: true }, { merge: true }));
  await assertFails(txops.doc('invoices/all').set({ tampered: true }, { merge: true }));
  await assertFails(alice.doc('invoices/all').set({ tampered: true }, { merge: true }));
});

// ---------------------------------------------------------------------------
// transactions — Mercury data: admin/partial read, write:false
// ---------------------------------------------------------------------------

test('transactions: admin + partial admin read only; never client-writable', async () => {
  await assertSucceeds(admin.doc('transactions/t1').get());
  await assertSucceeds(partial.doc('transactions/t1').get());
  await assertFails(downloads.doc('transactions/t1').get());
  await assertFails(txops.doc('transactions/t1').get()); // txops flag does NOT open transactions itself
  await assertFails(alice.doc('transactions/t1').get());

  await assertFails(admin.doc('transactions/t1').set({ amount: 0 }, { merge: true }));
  await assertFails(partial.doc('transactions/t2').set({ id: 't2' }));
  await assertFails(admin.doc('transactions/t1').delete());
});

// ---------------------------------------------------------------------------
// Deny-by-default terminal match (SEC-003 / SEC-006 / SEC-007)
// ---------------------------------------------------------------------------

test('deny-by-default: unlisted collections are dead even for full admins', async () => {
  // SEC-006: legacy attorneys/{*}
  await assertFails(admin.doc('attorneys/Legacy').get());
  await assertFails(alice.doc('attorneys/Legacy').get());
  await assertFails(admin.doc('attorneys/Legacy').set({ name: 'X' }, { merge: true }));
  // SEC-007: vestigial downloads/{*}
  await assertFails(admin.doc('downloads/d1').get());
  await assertFails(admin.doc('downloads/new').set({ file: 'y' }));
  // Any random collection
  await assertFails(admin.doc('secrets/s1').get());
  await assertFails(admin.doc('secrets/s1').set({ v: 1 }));
});
