import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRoleEdits,
  buildEditsFromUsers,
  buildRoleSavePayload,
} from '../src/utils/rolePayload.mjs';

// ---------------------------------------------------------------------------
// buildRoleSavePayload — email normalization
// ---------------------------------------------------------------------------

test('payload lower-cases the email', () => {
  const payload = buildRoleSavePayload({
    email: 'Jane.Doe@CedarGroveLLP.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2025-03',
  });
  assert.equal(payload.email, 'jane.doe@cedargrovellp.com');
});

test('payload trims whitespace around the email before lower-casing', () => {
  const payload = buildRoleSavePayload({
    email: '  Jane.Doe@CedarGroveLLP.com  ',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '',
  });
  assert.equal(payload.email, 'jane.doe@cedargrovellp.com');
});

test('an already-normalized email passes through unchanged', () => {
  const payload = buildRoleSavePayload({
    email: 'jane@cedargrovellp.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '',
  });
  assert.equal(payload.email, 'jane@cedargrovellp.com');
});

// ---------------------------------------------------------------------------
// buildRoleSavePayload — activationDate normalization
// ---------------------------------------------------------------------------

test('empty-string activationDate normalizes to null', () => {
  const payload = buildRoleSavePayload({
    email: 'a@b.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '',
  });
  assert.equal(payload.activationDate, null);
});

test('a YYYY-MM activationDate passes through unchanged', () => {
  const payload = buildRoleSavePayload({
    email: 'a@b.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2024-11',
  });
  assert.equal(payload.activationDate, '2024-11');
});

test('a legacy YYYY-MM-DD activationDate also passes through unchanged', () => {
  // The consumer (hasJoinedBy in userActivation.mjs) accepts legacy
  // day-precision values defensively; the payload does not reformat them.
  const payload = buildRoleSavePayload({
    email: 'a@b.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2024-11-15',
  });
  assert.equal(payload.activationDate, '2024-11-15');
});

// ---------------------------------------------------------------------------
// buildRoleSavePayload — pass-through fields and shape
// ---------------------------------------------------------------------------

test('payload contains exactly the five updated fields', () => {
  const payload = buildRoleSavePayload({
    email: 'a@b.com',
    role: 'Paralegal',
    employmentType: 'PTE',
    active: false,
    activationDate: '2026-01',
    isDirty: true, // UI-only flag — must NOT leak into the Firestore payload
  });
  assert.deepEqual(payload, {
    email: 'a@b.com',
    role: 'Paralegal',
    employmentType: 'PTE',
    active: false,
    activationDate: '2026-01',
  });
});

// ---------------------------------------------------------------------------
// buildRoleEdits — defaults for the edit form state
// ---------------------------------------------------------------------------

test('active defaults to true when absent on the user doc', () => {
  assert.equal(buildRoleEdits({ id: 'u1' }).active, true);
});

test('active stays true for an explicit true', () => {
  assert.equal(buildRoleEdits({ id: 'u1', active: true }).active, true);
});

test('only an explicit false marks a user inactive', () => {
  assert.equal(buildRoleEdits({ id: 'u1', active: false }).active, false);
});

test('missing fields fall back to display defaults', () => {
  assert.deepEqual(buildRoleEdits({ id: 'u1' }), {
    email: '',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '',
    isDirty: false,
  });
});

test('buildEditsFromUsers keys edits by user id and handles empty input', () => {
  const edits = buildEditsFromUsers([
    { id: 'u1', email: 'a@b.com', role: 'Partner', employmentType: 'PTE', active: false, activationDate: '2023-06' },
    { id: 'u2' },
  ]);
  assert.deepEqual(Object.keys(edits), ['u1', 'u2']);
  assert.equal(edits.u1.role, 'Partner');
  assert.equal(edits.u2.role, 'Attorney');
  assert.equal(edits.u1.isDirty, false);

  assert.deepEqual(buildEditsFromUsers([]), {});
  assert.deepEqual(buildEditsFromUsers(null), {});
  assert.deepEqual(buildEditsFromUsers(undefined), {});
});

// ---------------------------------------------------------------------------
// Round-trip: user doc -> edits -> payload
// ---------------------------------------------------------------------------

test('full payload round-trip: a normalized user doc survives edits -> payload unchanged', () => {
  const stored = {
    id: 'u1',
    name: 'Jane Doe',
    email: 'jane@cedargrovellp.com', // already lower-cased (AddUserTab convention)
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2025-03',
  };
  const payload = buildRoleSavePayload(buildRoleEdits(stored));
  assert.deepEqual(payload, {
    email: 'jane@cedargrovellp.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2025-03',
  });
});

test('round-trip on a sparse user doc yields the default payload (activationDate null)', () => {
  const payload = buildRoleSavePayload(buildRoleEdits({ id: 'u2' }));
  assert.deepEqual(payload, {
    email: '',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: null, // '' edit-state default normalizes to null on save
  });
});

test('a no-op edit produces a payload identical to the untouched one', () => {
  const user = {
    id: 'u1',
    email: 'jane@cedargrovellp.com',
    role: 'Attorney',
    employmentType: 'FTE',
    active: true,
    activationDate: '2025-03',
  };
  const pristine = buildRoleEdits(user);

  // Simulate the UI's handleChange: set a field to a new value, then back.
  const touched = { ...pristine, role: 'Partner', isDirty: true };
  const reverted = { ...touched, role: 'Attorney', isDirty: true };

  assert.deepEqual(
    buildRoleSavePayload(reverted),
    buildRoleSavePayload(pristine),
  );
});
