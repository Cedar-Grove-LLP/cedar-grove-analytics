import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  TIMESHEET_COLLECTIONS,
  buildMapping,
  validateMapping,
  sameDocData,
  isStubUser,
  planMonthDocAction,
  shouldDeleteSourceParent,
} from '../scripts/migrate-timesheet-user-ids.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/migrate-timesheet-user-ids.mjs', import.meta.url));

const monthDoc = (overrides = {}) => ({
  month: 'March',
  year: 2026,
  entries: [
    { date: '2026-03-02', client: 'Acme', matter: 'General', hours: 3, earnings: 1200 },
    { date: '2026-03-05', client: 'Beta', matter: 'IP', hours: 1.5, earnings: 600 },
  ],
  sheetTotals: { billableHours: 4.5 },
  ...overrides,
});

// ---------------------------------------------------------------- no-conflict move

test('no-conflict move: absent target is copied in --write mode and source becomes deletable', () => {
  const plan = planMonthDocAction({
    sourceDocData: monthDoc(),
    targetDocData: undefined, // target month doc does not exist
    write: true,
  });
  assert.equal(plan.status, 'will copy');
  assert.equal(plan.copy, true);
  assert.equal(plan.deletable, true);
});

test('no-conflict move covers every timesheet collection type', () => {
  assert.deepEqual(TIMESHEET_COLLECTIONS, ['billables', 'ops', 'eightThreeB']);
});

// ---------------------------------------------------------------- conflict path

test('conflict: existing target that differs wins — nothing copied, nothing deletable', () => {
  const source = monthDoc();
  const target = monthDoc({
    entries: [{ date: '2026-03-09', client: 'Gamma', matter: 'M&A', hours: 8, earnings: 4000 }],
  });
  const plan = planMonthDocAction({ sourceDocData: source, targetDocData: target, write: true });
  // Pin exactly what wins: the TARGET is never overwritten (copy=false) and
  // the source is never deleted (deletable=false) — the conflict is skipped
  // for manual resolution, matching the CLI's documented policy.
  assert.equal(plan.status,
    'TARGET EXISTS & DIFFERS — CONFLICT, skipped (resolve manually or resync)');
  assert.equal(plan.copy, false);
  assert.equal(plan.deletable, false);
});

test('identical target (modulo volatile sync metadata) skips the copy but allows source delete', () => {
  const source = monthDoc({ syncedAt: '2026-03-31T10:00:00Z' });
  const target = monthDoc({ syncedAt: '2026-04-01T09:00:00Z', lastSyncedAt: 'later' });
  const plan = planMonthDocAction({ sourceDocData: source, targetDocData: target, write: true });
  assert.equal(plan.status, 'target identical — skip copy');
  assert.equal(plan.copy, false);
  // Same content already canonical — safe to delete the source copy.
  assert.equal(plan.deletable, true);
});

test('field insertion order cannot fake a conflict (deep equality, not JSON.stringify)', () => {
  const source = { year: 2026, month: 'March', entries: [{ hours: 1, client: 'A' }] };
  const target = { month: 'March', entries: [{ client: 'A', hours: 1 }], year: 2026 };
  assert.equal(sameDocData(target, source), true);
  const plan = planMonthDocAction({ sourceDocData: source, targetDocData: target, write: true });
  assert.equal(plan.status, 'target identical — skip copy');
});

test('a real nested entry difference IS a conflict', () => {
  const source = monthDoc();
  const target = monthDoc();
  target.entries = target.entries.map((e) => ({ ...e }));
  target.entries[1].hours = 2; // one entry edited on the target side
  const plan = planMonthDocAction({ sourceDocData: source, targetDocData: target, write: true });
  assert.equal(plan.copy, false);
  assert.equal(plan.deletable, false);
  assert.match(plan.status, /CONFLICT/);
});

// ------------------------------------------- delete-only-after-successful-copy

test('invariant: a doc is never deletable unless its copy was queued this run or the target is already identical', () => {
  const source = monthDoc();
  const scenarios = [
    { targetDocData: undefined, write: true },   // copy queued → deletable
    { targetDocData: undefined, write: false },  // dry-run: no copy → NOT deletable
    { targetDocData: monthDoc(), write: true },  // identical → deletable without copy
    { targetDocData: monthDoc(), write: false },
    { targetDocData: monthDoc({ year: 2025 }), write: true },  // conflict → never
    { targetDocData: monthDoc({ year: 2025 }), write: false },
  ];
  for (const s of scenarios) {
    const plan = planMonthDocAction({ sourceDocData: source, ...s });
    const targetIdentical = s.targetDocData !== undefined && sameDocData(s.targetDocData, source);
    if (plan.deletable) {
      assert.equal(plan.copy || targetIdentical, true,
        `deletable without a queued copy or identical target: ${JSON.stringify(s)}`);
    }
  }
});

test('dry-run copy is not deletable even though it reports "will copy"', () => {
  const plan = planMonthDocAction({ sourceDocData: monthDoc(), targetDocData: undefined, write: false });
  assert.equal(plan.status, 'will copy');
  assert.equal(plan.copy, false);
  assert.equal(plan.deletable, false);
});

test('source parent doc deleted only when stub AND fully drained', () => {
  const base = { sourceUserExists: true, sourceIsStub: true, remainingDocs: 0 };
  assert.equal(shouldDeleteSourceParent(base), true);
  // Conflicted/unmigrated month docs keep the parent alive.
  assert.equal(shouldDeleteSourceParent({ ...base, remainingDocs: 1 }), false);
  // A parent with rates/targets is never auto-deleted.
  assert.equal(shouldDeleteSourceParent({ ...base, sourceIsStub: false }), false);
  // Absent parent: nothing to delete.
  assert.equal(shouldDeleteSourceParent({ ...base, sourceUserExists: false }), false);
});

// ---------------------------------------------------------------- dry-run flag

test('dry-run is the default: --delete-source without --write is refused before any I/O', () => {
  // Runs the real CLI. It must exit 1 on the flag guard, well before any
  // Firestore/credential access (no .env.local exists in CI).
  const result = (() => {
    try {
      execFileSync(process.execPath, [SCRIPT, '--delete-source'], { encoding: 'utf8', stdio: 'pipe' });
      return { status: 0, stderr: '' };
    } catch (err) {
      return { status: err.status, stderr: String(err.stderr) };
    }
  })();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--delete-source requires --write/);
});

test('CLI with no mappings exits 1 without touching Firestore', () => {
  try {
    execFileSync(process.execPath, [SCRIPT], { encoding: 'utf8', stdio: 'pipe' });
    assert.fail('expected non-zero exit');
  } catch (err) {
    assert.equal(err.status, 1);
    assert.match(String(err.stderr), /No mappings given/);
  }
});

// ---------------------------------------------------------------- mapping validation

test('buildMapping merges map file with --from/--to pairs; CLI pairs win', () => {
  const mapping = buildMapping({ Ohta: 'Michael Ohta', Sam: 'Sam McClure' }, ['Sam'], ['Samuel McClure']);
  assert.deepEqual(mapping, { Ohta: 'Michael Ohta', Sam: 'Samuel McClure' });
  assert.deepEqual(buildMapping(null, [], []), {});
});

test('validateMapping rejects self-mappings and unknown targets', () => {
  const known = new Set(['Michael Ohta', 'Sam McClure']);
  assert.deepEqual(validateMapping({ Ohta: 'Michael Ohta' }, known), []);
  const errors = validateMapping({ Ohta: 'Ohta', Ghost: 'Nobody' }, known);
  assert.equal(errors.length, 3); // self-map + self-map's unknown target + Ghost's unknown target
  assert.match(errors[0], /maps to itself/);
  assert.match(errors[1], /"Ohta" does not exist in users\//);
  assert.match(errors[2], /"Nobody" does not exist in users\//);
});

// ---------------------------------------------------------------- malformed docs

test('malformed month docs still compare via deep equality without crashing', () => {
  // Missing entries[] entirely.
  const bare = { month: 'March', year: 2026 };
  assert.equal(sameDocData(bare, { month: 'March', year: 2026 }), true);
  // entries: null vs entries absent is a real difference → conflict.
  const plan = planMonthDocAction({
    sourceDocData: bare,
    targetDocData: { month: 'March', year: 2026, entries: null },
    write: true,
  });
  assert.match(plan.status, /CONFLICT/);
  assert.equal(plan.deletable, false);
});

test('sameDocData throws on non-object doc data (current behavior — unreachable via Firestore, where doc.data() is always an object)', () => {
  assert.throws(() => sameDocData(null, {}));
  assert.throws(() => sameDocData({}, undefined));
});

test('isStubUser: absent or malformed profile data counts as a stub', () => {
  assert.equal(isStubUser(null), true);           // parent doc absent
  assert.equal(isStubUser({}), true);             // empty doc
  assert.equal(isStubUser({ name: 'X' }), true);  // no rates/targets arrays
  // Malformed non-array rates/targets are treated as absent.
  assert.equal(isStubUser({ rates: 'oops', targets: 42 }), true);
  // Any real rates[] or targets[] array (even empty) blocks auto-delete.
  assert.equal(isStubUser({ rates: [] }), false);
  assert.equal(isStubUser({ targets: [{ month: 1 }] }), false);
});
