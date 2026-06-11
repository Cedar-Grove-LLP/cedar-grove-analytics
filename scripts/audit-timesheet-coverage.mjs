#!/usr/bin/env node
/**
 * READ-ONLY timesheet coverage audit for Cedar Grove Analytics.
 *
 * Performs zero Firestore writes. The only output is stdout plus an optional
 * local JSON artifact (--out). Safe to run against production with read
 * credentials.
 *
 * Usage:
 *   node scripts/audit-timesheet-coverage.mjs \
 *     [--start 2025-01-01] [--end 2025-03-12] [--out audit-report.json]
 *
 * Credentials (loaded from .env.local automatically; see scripts/lib/firestore.mjs):
 *   FIREBASE_SERVICE_ACCOUNT_KEY='{...service account JSON...}'
 *   or GOOGLE_APPLICATION_CREDENTIALS=/path/to/key.json
 *
 * What it reports:
 *   1. Every users/{id} doc: role, employmentType (flagging the missing→FTE
 *      read default), active flag, legacy hiddenAttorneys.mjs status, and
 *      rates[] coverage (count, earliest/latest month).
 *   2. Per user: billables/ops/eightThreeB month docs — entry counts, summed
 *      hours, sheetTotals mismatches (same round-to-2 rule as the app).
 *   3. Window stats (default Jan 1 – Mar 12, 2025): billable/ops hours,
 *      gross billables via the app's exact backward-fallback rate logic,
 *      and months with hours but no rate.
 *   4. collectionGroup scans of billables/ops/eightThreeB/entries — any
 *      parent ID not present in users/ is ORPHANED (invisible to the app).
 *   5. Legacy probes: top-level attorneys/ collection; per-user legacy
 *      rates/ subcollections.
 *   6. monthlyMetrics/all coverage for the window months.
 *   7. A coverage table classifying every user OK / MISSING / ORPHANED /
 *      MISSING_RATE (multiple flags possible).
 */

import { writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';
import {
  MONTH_NAMES,
  buildRatesMapFromUserDoc,
  rateBounds,
  summarizeMonthDoc,
  windowStats,
  detectOrphans,
  suggestOrphanMatches,
  classifyUser,
  formatTable,
} from './lib/audit-helpers.mjs';

import { HIDDEN_ATTORNEYS } from '../src/utils/hiddenAttorneys.mjs';

const hiddenStatus = (name) => {
  const config = HIDDEN_ATTORNEYS.find((a) => a.name === name);
  if (!config) return '';
  const parts = [];
  if (config.hideBefore) parts.push(`hideBefore ${config.hideBefore.toISOString().slice(0, 10)}`);
  if (config.hideAfter) parts.push(`hideAfter ${config.hideAfter.toISOString().slice(0, 10)}`);
  return parts.join(', ');
};

const { values: args } = parseArgs({
  options: {
    start: { type: 'string', default: '2025-01-01' },
    end: { type: 'string', default: '2025-03-12' },
    out: { type: 'string' },
  },
});

const windowStart = new Date(`${args.start}T00:00:00`);
const windowEnd = new Date(`${args.end}T23:59:59.999`);
if (isNaN(windowStart) || isNaN(windowEnd)) {
  console.error('Invalid --start/--end date (expected YYYY-MM-DD)');
  process.exit(1);
}

const TIMESHEET_COLLECTIONS = ['billables', 'ops', 'eightThreeB'];
const heading = (text) => console.log(`\n=== ${text} ===\n`);

loadEnvFile('.env.local');
const db = getDb();

console.log(`Timesheet coverage audit — window ${args.start} → ${args.end}`);
console.log('READ-ONLY: this script performs no Firestore writes.');

// ---------------------------------------------------------------- 1. users
const usersSnap = await db.collection('users').get();
const users = usersSnap.docs.map((doc) => {
  const data = doc.data();
  return {
    id: doc.id,
    data,
    name: data.name || doc.id,
    role: data.role || 'Attorney',
    employmentTypeRaw: data.employmentType,
    active: data.active !== false,
    email: data.email || '',
    ratesMap: buildRatesMapFromUserDoc(data),
  };
});
const knownUserIds = new Set(users.map((u) => u.id));

heading(`Users (${users.length})`);
console.log(formatTable(users, [
  { header: 'ID', value: (u) => u.id },
  { header: 'Name', value: (u) => u.name },
  { header: 'Role', value: (u) => u.role },
  // AddUserTab writes 'PTE' by default, but a MISSING field reads as 'FTE'
  // (FirestoreDataContext.js:72) — that asymmetry is itself a finding.
  { header: 'EmpType', value: (u) => u.employmentTypeRaw || 'MISSING → reads as FTE' },
  { header: 'Active', value: (u) => (u.active ? 'yes' : 'NO') },
  { header: 'Email', value: (u) => u.email },
  { header: 'Hidden (legacy)', value: (u) => hiddenStatus(u.name) },
  { header: 'Rates', value: (u) => rateBounds(u.ratesMap).count },
  { header: 'RateRange', value: (u) => {
    const b = rateBounds(u.ratesMap);
    return b.count ? `${b.earliest} → ${b.latest}` : '—';
  } },
]));

// ------------------------------------------- 2. per-user month docs + 3. window
heading('Per-user month docs (billables / ops / eightThreeB)');
const userReports = [];
for (const user of users) {
  const docsByType = {};
  const snaps = await Promise.all(
    TIMESHEET_COLLECTIONS.map((type) => db.collection('users').doc(user.id).collection(type).get())
  );
  TIMESHEET_COLLECTIONS.forEach((type, i) => {
    docsByType[type] = snaps[i].docs.map((d) => ({ docId: d.id, data: d.data() }));
  });

  const summaries = TIMESHEET_COLLECTIONS.flatMap((type) =>
    docsByType[type].map(({ docId, data }) => summarizeMonthDoc(type, docId, data))
  );

  const stats = windowStats(
    { billableDocs: docsByType.billables, opsDocs: docsByType.ops },
    user.ratesMap,
    windowStart,
    windowEnd
  );
  userReports.push({ user, summaries, stats });

  console.log(`\n${user.id} (${summaries.length} month docs)`);
  if (summaries.length > 0) {
    console.log(formatTable(summaries, [
      { header: 'Coll', value: (s) => s.type },
      { header: 'Doc', value: (s) => s.docId },
      { header: 'Entries', value: (s) => s.entryCount },
      { header: 'Hours', value: (s) => s.hours },
      { header: 'Earnings', value: (s) => s.earnings },
      { header: 'SheetTotals', value: (s) => (s.sheetTotals ? 'yes' : '—') },
      { header: 'Mismatch', value: (s) => s.mismatches.join('; ') },
    ]));
  }
  console.log(
    `  window ${args.start} → ${args.end}: billable ${stats.billableHours}h, ` +
    `ops ${stats.opsHours}h, gross (app fallback logic) $${stats.gross}` +
    (stats.missingRateMonthKeys.length
      ? `, MISSING RATES for ${stats.missingRateMonthKeys.join(', ')}`
      : '')
  );
}

// --------------------------------------------- 4. collectionGroup orphan scan
heading('Orphan scan (collectionGroup)');
const parentIdsByCollection = {};
const unexpectedPaths = [];
for (const name of [...TIMESHEET_COLLECTIONS, 'entries']) {
  const parents = new Map();
  // select() with no fields: we only need refs/paths, not the (potentially
  // huge) entries[] payloads this loop would otherwise re-download.
  const snap = await db.collectionGroup(name).select().get();
  snap.docs.forEach((doc) => {
    // Attribute by path root so depth doesn't matter: users/{id}/<coll>/{doc}
    // AND the legacy users/{id}/<coll>/{month}/entries/{e} layout both belong
    // to segment 1. Anything not rooted at users/ is reported verbatim.
    const segments = doc.ref.path.split('/');
    if (segments[0] === 'users' && segments.length >= 4) {
      parents.set(segments[1], (parents.get(segments[1]) || 0) + 1);
    } else {
      unexpectedPaths.push(doc.ref.path);
    }
  });
  parentIdsByCollection[name] = parents;
  console.log(`collectionGroup('${name}'): ${snap.size} docs across ${parents.size} users-parents`);
}
if (unexpectedPaths.length > 0) {
  console.log(`\nDocs outside users/{id}/... (${unexpectedPaths.length}):`);
  unexpectedPaths.slice(0, 50).forEach((p) => console.log(`  ${p}`));
  if (unexpectedPaths.length > 50) console.log(`  ... and ${unexpectedPaths.length - 50} more`);
}

const orphans = detectOrphans(parentIdsByCollection, knownUserIds);
const orphanMatches = suggestOrphanMatches(orphans.map((o) => o.parentId), users);
if (orphans.length > 0) {
  console.log('\nORPHANED parent IDs (data invisible to the dashboard):');
  console.log(formatTable(orphans, [
    { header: 'Parent ID', value: (o) => o.parentId },
    { header: 'Collections', value: (o) => o.collections.join(', ') },
    { header: 'Docs', value: (o) => o.docCount },
    { header: 'Suggested target', value: (o) =>
      orphanMatches.find((m) => m.orphanId === o.parentId)?.suggestedTargetId || '(unmatched)' },
    { header: 'Confidence', value: (o) =>
      orphanMatches.find((m) => m.orphanId === o.parentId)?.confidence },
  ]));
} else {
  console.log('\nNo orphaned parent IDs found.');
}

// -------------------------------------------------------- 5. legacy probes
heading('Legacy schema probes');
const attorneysSnap = await db.collection('attorneys').get();
console.log(`attorneys/ (deprecated): ${attorneysSnap.size} docs` +
  (attorneysSnap.size ? ` — ${attorneysSnap.docs.map((d) => d.id).join(', ')}` : ''));

const allSubcollections = await Promise.all(
  users.map((user) => db.collection('users').doc(user.id).listCollections())
);
const legacyRatesUsers = users
  .filter((_, i) => allSubcollections[i].some((c) => c.id === 'rates'))
  .map((u) => u.id);
console.log(`users/{id}/rates legacy subcollections: ` +
  (legacyRatesUsers.length ? legacyRatesUsers.join(', ') : 'none'));

// ------------------------------------------------------ 6. monthlyMetrics
heading('monthlyMetrics/all coverage for window months');
const monthlyMetricsDoc = await db.collection('monthlyMetrics').doc('all').get();
const metricEntries = monthlyMetricsDoc.exists ? (monthlyMetricsDoc.data().entries || []) : [];
const windowMonths = [];
for (let cursor = new Date(windowStart.getFullYear(), windowStart.getMonth(), 1);
  cursor <= windowEnd;
  cursor.setMonth(cursor.getMonth() + 1)) {
  windowMonths.push({ year: cursor.getFullYear(), month: MONTH_NAMES[cursor.getMonth()] });
}
windowMonths.forEach(({ year, month }) => {
  const entry = metricEntries.find((e) => e.year === year && e.month === month);
  console.log(`  ${month} ${year}: attorneyBillables=` +
    `${typeof entry?.attorneyBillables === 'number' ? entry.attorneyBillables : 'ABSENT'}, ` +
    `revenueAccrued=${typeof entry?.revenueAccrued === 'number' ? entry.revenueAccrued : 'ABSENT'}`);
});

// ------------------------------------------------------- 7. coverage table
heading('Coverage classification');
const coverageRows = userReports.map(({ user, stats }) => {
  const orphanMatchesForUser = orphanMatches.filter((m) => m.suggestedTargetId === user.id);
  const { flags, notes } = classifyUser({ windowStats: stats, orphanMatchesForUser });
  return { user, stats, flags, notes };
});
console.log(formatTable(coverageRows, [
  { header: 'User', value: (r) => r.user.id },
  { header: 'EmpType', value: (r) => r.user.employmentTypeRaw || 'FTE?' },
  { header: 'Billable(h)', value: (r) => r.stats.billableHours },
  { header: 'Ops(h)', value: (r) => r.stats.opsHours },
  { header: 'Gross($)', value: (r) => r.stats.gross },
  { header: 'Flags', value: (r) => r.flags.join('+') },
  { header: 'Notes', value: (r) => r.notes.join('; ') },
]));

const spotlight = coverageRows.filter((r) =>
  ['Michael Ohta', 'Valery Uscanga'].includes(r.user.id) || r.user.employmentTypeRaw === 'PTE');
if (spotlight.length > 0) {
  console.log('\nSpotlight (Michael Ohta, Valery Uscanga, all PTE attorneys):');
  spotlight.forEach((r) =>
    console.log(`  ${r.user.id}: ${r.flags.join('+')}${r.notes.length ? ` — ${r.notes.join('; ')}` : ''}`));
}

const unmatchedOrphans = orphanMatches.filter((m) => !m.suggestedTargetId);
if (unmatchedOrphans.length > 0) {
  console.log('\nUnmatched orphans (need manual mapping):');
  unmatchedOrphans.forEach((m) => console.log(`  ${m.orphanId}`));
}

// ----------------------------------------------------------- JSON artifact
if (args.out) {
  const artifact = {
    generatedAt: new Date().toISOString(),
    window: { start: args.start, end: args.end },
    users: coverageRows.map((r) => ({
      id: r.user.id,
      name: r.user.name,
      role: r.user.role,
      employmentType: r.user.employmentTypeRaw || null,
      active: r.user.active,
      flags: r.flags,
      notes: r.notes,
      windowStats: r.stats,
      rateBounds: rateBounds(r.user.ratesMap),
    })),
    orphans: orphans.map((o) => ({
      ...o,
      ...orphanMatches.find((m) => m.orphanId === o.parentId),
    })),
    // The human-run rate backfill worklist (Admin → User Management):
    missingRates: coverageRows
      .filter((r) => r.stats.missingRateMonthKeys.length > 0)
      .map((r) => ({
        userId: r.user.id,
        userName: r.user.name,
        monthKeys: r.stats.missingRateMonthKeys,
        billableHoursAffected: r.stats.billableHours,
      })),
    // Review by hand, prune, then feed to migrate-timesheet-user-ids.mjs --map:
    suggestedMigrationMap: Object.fromEntries(
      orphanMatches
        .filter((m) => m.suggestedTargetId)
        .map((m) => [m.orphanId, m.suggestedTargetId])
    ),
    monthlyMetrics: windowMonths.map(({ year, month }) => {
      const entry = metricEntries.find((e) => e.year === year && e.month === month);
      return {
        year,
        month,
        attorneyBillables: typeof entry?.attorneyBillables === 'number' ? entry.attorneyBillables : null,
        revenueAccrued: typeof entry?.revenueAccrued === 'number' ? entry.revenueAccrued : null,
      };
    }),
    legacy: {
      attorneysCollectionDocs: attorneysSnap.docs.map((d) => d.id),
      legacyRatesSubcollections: legacyRatesUsers,
      unexpectedCollectionGroupPaths: unexpectedPaths,
    },
  };
  writeFileSync(args.out, JSON.stringify(artifact, null, 2));
  console.log(`\nWrote JSON artifact to ${args.out}`);
}
