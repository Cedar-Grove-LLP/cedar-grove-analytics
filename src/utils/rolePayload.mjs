// Pure helpers for the Role Management admin tab (RoleManagementTab.jsx).
// Extracted so the edit-state defaults and the Firestore save payload are
// unit-testable without the Firebase client SDK.

/**
 * Build the editable form state for one user document.
 * Defaults mirror what the Role Management table displays:
 * - email/activationDate fall back to '' (controlled inputs need strings)
 * - role defaults to 'Attorney', employmentType to 'FTE'
 * - active defaults to TRUE when absent (`u.active !== false`) — only an
 *   explicit `false` marks a user inactive
 */
export function buildRoleEdits(user) {
  return {
    email: user.email || '',
    role: user.role || 'Attorney',
    employmentType: user.employmentType || 'FTE',
    active: user.active !== false,
    activationDate: user.activationDate || '',
    isDirty: false,
  };
}

/**
 * Build the edits map keyed by user id for a list of users.
 * Empty/missing input yields an empty map.
 */
export function buildEditsFromUsers(users) {
  const edits = {};
  if (users && users.length > 0) {
    users.forEach(u => {
      edits[u.id] = buildRoleEdits(u);
    });
  }
  return edits;
}

/**
 * Build the Firestore `users/{userId}` update payload from an edits row.
 * Invariants:
 * - email is trimmed and lower-cased so it matches the AddUserTab convention
 *   and the exact-match `where('email', '==', ...)` query FirestoreDataContext
 *   uses to scope a plain user's own data — a mixed-case stored email would
 *   silently return zero results for that user (see SEC-008 fix).
 * - activationDate '' (or any falsy) normalizes to null; a non-empty
 *   "YYYY-MM" month string passes through unchanged (the input is
 *   <input type="month"> — month precision only).
 * - role/employmentType/active pass through as-is.
 */
export function buildRoleSavePayload(edits) {
  return {
    email: edits.email.trim().toLowerCase(),
    role: edits.role,
    employmentType: edits.employmentType,
    active: edits.active,
    activationDate: edits.activationDate || null,
  };
}
