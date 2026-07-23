// SEC-008 fetch gate — decides whether a signed-in user may pull the full
// firm-wide dataset into their browser.
//
// Admins, partial admins (who can reach admin-only routes like
// /clients/[clientName] and /billing-summaries directly), and the two
// firm-wide restricted dashboards (downloads-only, transactions+ops-only)
// need the full firm dataset. A plain attorney only needs their own profile +
// their own time entries — fetching every attorney's billing rates, targets,
// clients, and time entries into every signed-in user's browser regardless of
// role was SEC-008 in the security audit. firestore.rules enforces the
// matching boundary server-side (hasFullDataAccess() there mirrors this flag
// exactly).

/**
 * @param {{ isAdmin?: boolean, isPartialAdmin?: boolean,
 *           hasDownloadsAccess?: boolean, hasTransactionsOpsAccess?: boolean }} flags
 * @returns {boolean} true = fetch the full firm dataset; false = own-data only
 */
export function hasFullDataAccess({ isAdmin, isPartialAdmin, hasDownloadsAccess, hasTransactionsOpsAccess } = {}) {
  return Boolean(isAdmin || isPartialAdmin || hasDownloadsAccess || hasTransactionsOpsAccess);
}
