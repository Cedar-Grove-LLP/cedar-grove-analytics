#!/usr/bin/env node
/**
 * Migrate timesheet month docs from orphaned/mis-keyed user IDs to canonical
 * users/{fullName} doc IDs.
 *
 * DRY-RUN BY DEFAULT — prints what would happen and writes nothing.
 *   --write          actually copy month docs to the canonical paths
 *   --delete-source  additionally delete source docs that were copied (or
 *                    verified identical) THIS run; requires --write
 *
 * Usage:
 *   node scripts/migrate-timesheet-user-ids.mjs --map ./migration-map.json [--write] [--delete-source]
 *   node scripts/migrate-timesheet-user-ids.mjs --from "Ohta" --to "Michael Ohta"
 *
 * migration-map.json: { "<sourceUserId>": "<targetCanonicalUserId>", ... }
 * Start from the audit's `suggestedMigrationMap` (audit-timesheet-coverage.mjs
 * --out), review every pair by hand, prune anything uncertain.
 *
 * SEQUENCING (critical): the Apps Script sync delete-and-replaces month docs
 * under whatever user ID it is configured with. Fix the sync's target IDs
 * (docs/timesheet-sync.md) BEFORE running with --write, or the next sync run
 * recreates the orphans and/or overwrites freshly migrated docs.
 *
 * Conflict policy: if the target month doc already exists and differs from
 * the source, it is SKIPPED with a warning — two attorneys' months are never
 * silently merged. Resolve conflicts manually, or prefer a resync from the
 * source sheet (the source of truth).
 */

import { readFileSync } from 'node:fs';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';
import { summarizeMonthDoc } from './lib/audit-helpers.mjs';

const TIMESHEET_COLLECTIONS = ['billables', 'ops', 'eightThreeB'];
const MAX_BATCH_OPS = 400;

const { values: args } = parseArgs({
  options: {
    map: { type: 'string' },
    from: { type: 'string', multiple: true, default: [] },
    to: { type: 'string', multiple: true, default: [] },
    write: { type: 'boolean', default: false },
    'delete-source': { type: 'boolean', default: false },
  },
});

if (args['delete-source'] && !args.write) {
  console.error('--delete-source requires --write. Refusing to run.');
  process.exit(1);
}
if (args.from.length !== args.to.length) {
  console.error('--from and --to must be passed in pairs.');
  process.exit(1);
}

const mapping = {};
if (args.map) {
  Object.assign(mapping, JSON.parse(readFileSync(args.map, 'utf8')));
}
args.from.forEach((src, i) => { mapping[src] = args.to[i]; });

if (Object.keys(mapping).length === 0) {
  console.error('No mappings given. Use --map ./migration-map.json and/or --from/--to pairs.');
  process.exit(1);
}

loadEnvFile('.env.local');
const db = getDb();

const mode = args.write
  ? (args['delete-source'] ? 'WRITE + DELETE-SOURCE' : 'WRITE')
  : 'DRY-RUN (no writes)';
console.log(`Timesheet user-ID migration — mode: ${mode}\n`);

// ----------------------------------------------------------- validation
const usersSnap = await db.collection('users').get();
const knownUserIds = new Set(usersSnap.docs.map((d) => d.id));

let invalid = false;
for (const [source, target] of Object.entries(mapping)) {
  if (source === target) {
    console.error(`INVALID: "${source}" maps to itself.`);
    invalid = true;
  }
  if (!knownUserIds.has(target)) {
    console.error(`INVALID: target "${target}" does not exist in users/. ` +
      'Create the canonical user first (Admin → User Management → Add User).');
    invalid = true;
  }
}
if (invalid) process.exit(1);

// Compare two month docs ignoring volatile sync metadata. Deep equality —
// not JSON.stringify — so field insertion order can't fake a conflict.
const sameDocData = (a, b) => {
  const strip = ({ syncedAt, lastSyncedAt, ...rest }) => rest;
  return isDeepStrictEqual(strip(a), strip(b));
};

// ----------------------------------------------------------- plan + execute
let pendingBatch = db.batch();
let pendingOps = 0;
const commitIfFull = async (force = false) => {
  if (pendingOps === 0 || (!force && pendingOps < MAX_BATCH_OPS)) return;
  await pendingBatch.commit();
  pendingBatch = db.batch();
  pendingOps = 0;
};

const totals = { toCopy: 0, conflicts: 0, identical: 0, deleted: 0, entries: 0 };

for (const [source, target] of Object.entries(mapping)) {
  console.log(`\n${source}  →  ${target}`);

  const sourceUserRef = db.collection('users').doc(source);
  const sourceUserDoc = await sourceUserRef.get();
  const sourceData = sourceUserDoc.exists ? sourceUserDoc.data() : null;
  const sourceIsStub = !sourceData ||
    (!Array.isArray(sourceData.rates) && !Array.isArray(sourceData.targets));
  console.log(`  users/${source} doc: ` +
    (sourceUserDoc.exists ? (sourceIsStub ? 'exists (stub — no rates/targets)' : 'exists (HAS rates/targets — review before deleting)') : 'absent'));

  const copiedDocRefs = [];

  for (const type of TIMESHEET_COLLECTIONS) {
    const snap = await sourceUserRef.collection(type).get();
    for (const doc of snap.docs) {
      const summary = summarizeMonthDoc(type, doc.id, doc.data());
      const targetRef = db.collection('users').doc(target).collection(type).doc(doc.id);
      const targetDoc = await targetRef.get();

      let status;
      if (!targetDoc.exists) {
        status = 'will copy';
        totals.toCopy += 1;
        totals.entries += summary.entryCount;
        if (args.write) {
          pendingBatch.set(targetRef, doc.data());
          pendingOps += 1;
          await commitIfFull();
          copiedDocRefs.push(doc.ref);
        }
      } else if (sameDocData(targetDoc.data(), doc.data())) {
        status = 'target identical — skip copy';
        totals.identical += 1;
        copiedDocRefs.push(doc.ref); // safe to delete: same content already canonical
      } else {
        status = 'TARGET EXISTS & DIFFERS — CONFLICT, skipped (resolve manually or resync)';
        totals.conflicts += 1;
      }

      console.log(`  users/${source}/${type}/${doc.id} → users/${target}/${type}/${doc.id}` +
        `  entries=${summary.entryCount} hours=${summary.hours}  [${status}]`);
    }
  }

  if (args['delete-source']) {
    for (const ref of copiedDocRefs) {
      pendingBatch.delete(ref);
      pendingOps += 1;
      totals.deleted += 1;
      await commitIfFull();
    }
    // Flush ALL pending deletes before counting — the shared batch may hold
    // deletes queued above (or commit mid-loop at the 400-op boundary), and
    // a count taken against a partially-applied state could wrongly delete
    // the parent doc while conflicted month docs still exist beneath it.
    await commitIfFull(true);
    // Delete the source parent doc only when it's a stub and nothing remains
    // under it (conflicted/unmigrated docs keep the parent alive).
    if (sourceUserDoc.exists && sourceIsStub) {
      const remaining = await Promise.all(
        TIMESHEET_COLLECTIONS.map((t) => sourceUserRef.collection(t).count().get())
      );
      const remainingDocs = remaining.reduce((acc, r) => acc + r.data().count, 0);
      if (remainingDocs === 0) {
        pendingBatch.delete(sourceUserRef);
        pendingOps += 1;
        console.log(`  users/${source} stub doc: will delete`);
        await commitIfFull();
      } else {
        console.log(`  users/${source} stub doc: kept (${remainingDocs} unmigrated docs remain)`);
      }
    }
  }
}

if (args.write) {
  await commitIfFull(true);
}

console.log(`\nSummary: ${totals.toCopy} docs ${args.write ? 'copied' : 'to copy'} ` +
  `(${totals.entries} entries), ${totals.identical} already identical, ` +
  `${totals.conflicts} conflicts skipped` +
  (args['delete-source'] ? `, ${totals.deleted} source docs deleted` : ''));
if (!args.write) {
  console.log('DRY-RUN complete — nothing was written. Re-run with --write to apply.');
}
if (totals.conflicts > 0) {
  console.log('Conflicts require manual resolution (or resync from the source sheet).');
}
