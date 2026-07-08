// Downloads-only dashboard access is granted via the `permissions/{email}`
// Firestore collection (Admin → User Management → Permissions tab),
// enforced server-side by firestore.rules' hasDownloadsAccess() helper —
// not a hardcoded email list. See SEC-016 in the security audit.
export function hasDownloadsAccessEmail(permissionsData) {
  return permissionsData?.downloadsAccess === true;
}
