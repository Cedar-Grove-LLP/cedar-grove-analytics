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
 *
 * The decision logic (what to copy/skip/delete, conflict resolution) lives in
 * the exported pure functions below so it is unit-testable
 * (tests/migrate-timesheet-policy.test.mjs); all Firestore I/O stays inside
 * main(), which only runs when this file is executed directly.
 */

import { readFileSync } from 'node:fs';
import { parseArgs, isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';
import { summarizeMonthDoc } from './lib/audit-helpers.mjs';

export const TIMESHEET_COLLECTIONS = ['billables', 'ops', 'eightThreeB'];
const MAX_BATCH_OPS = 400;

// ----------------------------------------------------------- pure policy

/**
 * Merge a migration map (from --map JSON) with --from/--to pairs. CLI pairs
 * win over the map file on key collision (they are applied last).
 */
export function buildMapping(mapObject, from = [], to = []) {
  const mapping = {};
  if (mapObject) Object.assign(mapping, mapObject);
  from.forEach((src, i) => { mapping[src] = to[i]; });
  return mapping;
}

/**
 * Validate a source→target mapping against the set of known canonical user
 * IDs. Returns an array of error strings — empty means valid. Mirrors the
 * CLI behavior: self-mappings and unknown targets are fatal.
 */
export function validateMapping(mapping, knownUserIds) {
  const errors = [];
  for (const [source, target] of Object.entries(mapping)) {
    if (source === target) {
      errors.push(`INVALID: "${source}" maps to itself.`);
    }
    if (!knownUserIds.has(target)) {
      errors.push(`INVALID: target "${target}" does not exist in users/. ` +
        'Create the canonical user first (Admin → User Management → Add User).');
    }
  }
  return errors;
}

/**
 * Compare two month docs ignoring volatile sync metadata. Deep equality —
 * not JSON.stringify — so field insertion order can't fake a conflict.
 */
export const sameDocData = (a, b) => {
  const strip = ({ syncedAt, lastSyncedAt, ...rest }) => rest;
  return isDeepStrictEqual(strip(a), strip(b));
};

/**
 * A source user doc is a "stub" when it is absent or carries neither a
 * rates[] nor a targets[] array — i.e. it holds no profile data worth
 * reviewing before deletion.
 */
export const isStubUser = (sourceData) => !sourceData ||
  (!Array.isArray(sourceData.rates) && !Array.isArray(sourceData.targets));

/**
 * Decide what happens to one source month doc given the target doc's state.
 *
 *   targetDocData === undefined  → target absent → copy source over.
 *   target identical (mod volatile syncedAt/lastSyncedAt) → skip the copy;
 *     the canonical content is already in place.
 *   target exists & differs → CONFLICT: the target wins — nothing is copied,
 *     nothing is deleted, the source is left in place for manual resolution.
 *
 * Returns { status, copy, deletable }:
 *   status    — exact log/status string the CLI prints
 *   copy      — whether a copy op should be queued (only in --write mode)
 *   deletable — whether the SOURCE doc may be deleted by --delete-source.
 *     Deletion is only ever allowed after the copy has been queued this run
 *     (copy === true) or when the target is already verified identical —
 *     never for a dry-run copy and never for a conflict.
 */
export function planMonthDocAction({ sourceDocData, targetDocData, write }) {
  if (targetDocData === undefined) {
    return { status: 'will copy', copy: Boolean(write), deletable: Boolean(write) };
  }
  if (sameDocData(targetDocData, sourceDocData)) {
    // Safe to delete the source: same content already canonical.
    return { status: 'target identical — skip copy', copy: false, deletable: true };
  }
  return {
    status: 'TARGET EXISTS & DIFFERS — CONFLICT, skipped (resolve manually or resync)',
    copy: false,
    deletable: false,
  };
}

/**
 * Delete the source parent user doc only when it exists, is a stub (no
 * rates/targets to review), and nothing remains under it — conflicted or
 * unmigrated month docs keep the parent alive.
 */
export function shouldDeleteSourceParent({ sourceUserExists, sourceIsStub, remainingDocs }) {
  return Boolean(sourceUserExists) && Boolean(sourceIsStub) && remainingDocs === 0;
}

// ----------------------------------------------------------- CLI entry point

async function main() {
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

  const mapping = buildMapping(
    args.map ? JSON.parse(readFileSync(args.map, 'utf8')) : null,
    args.from,
    args.to
  );

  if (Object.keys(mapping).length === 0) {
    console.error('No mappings given. Use --map ./migration-map.json and/or --from/--to pairs.');
    process.exit(1);
  }

  loadEnvFile('.env.local');
  // Dynamic import so merely importing this module (tests) never touches
  // firebase-admin.
  const { getDb } = await import('./lib/firestore.mjs');
  const db = getDb();

  const mode = args.write
    ? (args['delete-source'] ? 'WRITE + DELETE-SOURCE' : 'WRITE')
    : 'DRY-RUN (no writes)';
  console.log(`Timesheet user-ID migration — mode: ${mode}\n`);

  // ----------------------------------------------------------- validation
  const usersSnap = await db.collection('users').get();
  const knownUserIds = new Set(usersSnap.docs.map((d) => d.id));

  const errors = validateMapping(mapping, knownUserIds);
  for (const err of errors) console.error(err);
  if (errors.length > 0) process.exit(1);

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
    const sourceIsStub = isStubUser(sourceData);
    console.log(`  users/${source} doc: ` +
      (sourceUserDoc.exists ? (sourceIsStub ? 'exists (stub — no rates/targets)' : 'exists (HAS rates/targets — review before deleting)') : 'absent'));

    const copiedDocRefs = [];

    for (const type of TIMESHEET_COLLECTIONS) {
      const snap = await sourceUserRef.collection(type).get();
      for (const doc of snap.docs) {
        const summary = summarizeMonthDoc(type, doc.id, doc.data());
        const targetRef = db.collection('users').doc(target).collection(type).doc(doc.id);
        const targetDoc = await targetRef.get();

        const plan = planMonthDocAction({
          sourceDocData: doc.data(),
          targetDocData: targetDoc.exists ? targetDoc.data() : undefined,
          write: args.write,
        });

        if (plan.status === 'will copy') {
          totals.toCopy += 1;
          totals.entries += summary.entryCount;
          if (plan.copy) {
            pendingBatch.set(targetRef, doc.data());
            pendingOps += 1;
            await commitIfFull();
          }
        } else if (plan.status === 'target identical — skip copy') {
          totals.identical += 1;
        } else {
          totals.conflicts += 1;
        }
        if (plan.deletable) copiedDocRefs.push(doc.ref);

        console.log(`  users/${source}/${type}/${doc.id} → users/${target}/${type}/${doc.id}` +
          `  entries=${summary.entryCount} hours=${summary.hours}  [${plan.status}]`);
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
      if (sourceUserDoc.exists && sourceIsStub) {
        const remaining = await Promise.all(
          TIMESHEET_COLLECTIONS.map((t) => sourceUserRef.collection(t).count().get())
        );
        const remainingDocs = remaining.reduce((acc, r) => acc + r.data().count, 0);
        if (shouldDeleteSourceParent({
          sourceUserExists: sourceUserDoc.exists,
          sourceIsStub,
          remainingDocs,
        })) {
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
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
