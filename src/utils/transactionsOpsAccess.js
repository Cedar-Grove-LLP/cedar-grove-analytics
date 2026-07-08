// Transactions+Ops-only dashboard access is granted via the
// `permissions/{email}` Firestore collection (Admin → User Management →
// Permissions tab), enforced server-side by firestore.rules'
// hasTransactionsOpsAccess() helper — not a hardcoded email list. See
// SEC-016 in the security audit.
export function hasTransactionsOpsAccessEmail(permissionsData) {
  return permissionsData?.transactionsOpsAccess === true;
}
