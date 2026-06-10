/**
 * Cohort classification for the Overview page, shared with tests.
 * Pure module — no React/Firebase imports.
 */

export const isLawyer = (member) => (member.role || 'Attorney') === 'Attorney';

export const filterByCohort = (members, cohort) => {
  switch (cohort) {
    case 'fte-lawyers':
      return members.filter((m) => isLawyer(m) && m.employmentType === 'FTE');
    case 'pte-lawyers':
      return members.filter((m) => isLawyer(m) && m.employmentType === 'PTE');
    case 'lawyers':
      return members.filter(isLawyer);
    case 'full-team':
    default:
      return members;
  }
};

/**
 * Aggregate a cohort subset's per-attorney transactions ({ category: hours })
 * into the [{ type, totalHours }] shape TopTransactionsChart renders,
 * sorted by hours descending. attorneyData[].transactions excludes
 * Adjustment categories (see useAnalyticsData), so cohort-scoped charts
 * won't show Adjustment bars — the full-team view keeps the original
 * transactionData and is unaffected.
 */
export const deriveTransactionTotals = (attorneySubset) => {
  const totals = {};
  (attorneySubset || []).forEach((attorney) => {
    Object.entries(attorney.transactions || {}).forEach(([category, hours]) => {
      totals[category] = (totals[category] || 0) + (hours || 0);
    });
  });
  return Object.entries(totals)
    .map(([type, totalHours]) => ({ type, totalHours }))
    .sort((a, b) => b.totalHours - a.totalHours);
};
