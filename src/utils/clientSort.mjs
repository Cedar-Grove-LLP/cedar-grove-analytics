// Pure sort comparators + filter predicates for the Clients view table.
// Extracted from components/views/ClientsView.jsx so they can be unit-tested;
// the view imports these back, so behavior is identical.
//
// No firebase/react imports — keep this module importable from Node tests.

import { PAYMENT_STATUS_RANK } from './paymentStatus.mjs';

// A client is "Active" when they have billable hours in the selected date
// range, otherwise "Quiet". (Previously keyed off recent invoicing, which
// mislabeled clients with billable hours but no invoice in the last 3 months.)
export const isBillableClient = (client) =>
  (client.billableHours || client.totalHours || 0) > 0;

// Case-insensitive substring match on the client name.
export const matchesSearch = (client, search) =>
  client.name.toLowerCase().includes(search.toLowerCase());

// Activity filter buttons: 'all' | 'billable' (Active) | 'non-billable' (Quiet).
export const matchesActivityFilter = (client, filter) => {
  if (filter === 'billable') return isBillableClient(client);
  if (filter === 'non-billable') return !isBillableClient(client);
  return true; // 'all' (and any unknown value) passes everything through
};

// Payment-status filter buttons: 'all' | 'on-target' | 'warning' | 'hold'.
export const matchesPaymentFilter = (client, filter) =>
  filter === 'all' || client.paymentStatus === filter;

// Resolve the comparable value for a client under a given sort column.
// Sentinels (pinned current behavior):
//   - paymentStatus: unknown/missing status ranks 99 → sorts after all known
//     tags ascending (healthy payers first, holds last, unknown at the end).
//   - avgPaymentDays: null/undefined → -1, so clients with no paid invoices
//     sort below 0-day payers.
//   - lastActivity: the literal 'No activity' maps to '' → sorts before every
//     ISO date string ascending (and after them descending). Real values are
//     ISO "YYYY-MM-DD" strings, so plain string comparison IS chronological;
//     a non-ISO date format here would misorder (see tests).
export const getSortValue = (client, key) => {
  switch (key) {
    case 'name':
      return client.name.toLowerCase();
    case 'status':
      // NOTE: deliberately no `|| 0` fallback (matches the original view code)
      // — billableHours 0 with totalHours undefined yields undefined > 0 →
      // false → 'inactive', same outcome as the guarded form.
      return (client.billableHours || client.totalHours) > 0 ? 'active' : 'inactive';
    case 'paymentStatus':
      // Rank healthy payers first, holds last.
      return PAYMENT_STATUS_RANK[client.paymentStatus] ?? 99;
    case 'avgPaymentDays':
      // Clients with no paid invoices sort below 0-day payers.
      return client.avgPaymentDays ?? -1;
    case 'outstandingInvoices':
      return client.outstandingInvoices || 0;
    case 'billableHours':
      return client.billableHours || client.totalHours || 0;
    case 'grossBillables':
      return client.grossBillables || 0;
    case 'lastActivity':
      return client.lastActivity === 'No activity' ? '' : client.lastActivity;
    default:
      return client.billableHours || client.totalHours || 0;
  }
};

// Comparator for Array.prototype.sort. Equal values return 0, so the sort
// keeps the engine's stability guarantees for ties.
export const compareClients = (a, b, { key, direction }) => {
  const aVal = getSortValue(a, key);
  const bVal = getSortValue(b, key);
  if (aVal < bVal) return direction === 'asc' ? -1 : 1;
  if (aVal > bVal) return direction === 'asc' ? 1 : -1;
  return 0;
};
