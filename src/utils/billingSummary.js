// ============================================================
// Firm-wide monthly Attorney Billables
// ------------------------------------------------------------
// Per the client, the dashboard pulls the authoritative "Attorney
// Billables" figure straight from the source sheet's billing-summary
// table (synced onto each `monthlyMetrics/all` entry as
// `attorneyBillables`) rather than deriving it. See FirestoreSchema.md.
// ============================================================

// True when the entry carries a synced Attorney Billables figure.
export const hasAttorneyBillables = (entry) =>
  typeof entry?.attorneyBillables === 'number' && !Number.isNaN(entry.attorneyBillables);
