// Partial-admin access is granted via the `permissions/{email}` Firestore
// collection (Admin → User Management → Permissions tab), enforced
// server-side by firestore.rules' isPartialAdmin() helper — not a
// hardcoded email list. See SEC-016 in the security audit.
export function isPartialAdminEmail(permissionsData) {
  return permissionsData?.partialAdmin === true;
}
