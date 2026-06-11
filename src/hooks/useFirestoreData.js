import { useMemo } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { buildPaymentStatusIndex } from '@/utils/paymentStatus.mjs';

/**
 * Normalize a billable entry from the new schema.
 * New schema fields: client, date, hours, earnings, billingCategory, matter, reimbursements, notes, sheetRowNumber
 * Normalized output adds: userId, billableHours, month, year
 */
export const normalizeBillableEntry = (entryData, userId, month, year) => {
  const billableHours = parseFloat(entryData.hours) || 0;
  const earnings = parseFloat(entryData.earnings) || 0;

  return {
    ...entryData,
    userId,
    billableHours,
    earnings,
    billingCategory: entryData.billingCategory || 'Other',
    client: entryData.client || 'Unknown',
    matter: entryData.matter || '',
    reimbursements: parseFloat(entryData.reimbursements) || 0,
    notes: entryData.notes || '',
    month: month || '',
    year: year || new Date().getFullYear(),
  };
};

/**
 * Normalize an ops entry from the new schema.
 * New schema fields: description, date, hours, category, sheetRowNumber
 * Normalized output adds: userId, opsHours, month, year
 */
export const normalizeOpsEntry = (entryData, userId, month, year) => {
  const opsHours = parseFloat(entryData.hours) || 0;

  return {
    ...entryData,
    userId,
    opsHours,
    description: entryData.description || '',
    category: entryData.category || 'Other',
    notes: entryData.description || '',
    month: month || '',
    year: year || new Date().getFullYear(),
  };
};

/**
 * Get all billable entries from the shared cache.
 * Optionally filter by year/month.
 */
export const useAllBillableEntries = (filters = {}) => {
  const { allBillableEntries, loading, error } = useFirestoreCache();

  const data = useMemo(() => {
    let entries = allBillableEntries;
    if (filters.year) {
      entries = entries.filter(e => e.year === filters.year);
    }
    if (filters.month) {
      entries = entries.filter(e => e.month === filters.month);
    }
    return entries;
  }, [allBillableEntries, filters.year, filters.month]);

  return { data, loading, error };
};

/**
 * Get all ops entries from the shared cache.
 * Optionally filter by year/month.
 */
export const useAllOpsEntries = (filters = {}) => {
  const { allOpsEntries, loading, error } = useFirestoreCache();

  const data = useMemo(() => {
    let entries = allOpsEntries;
    if (filters.year) {
      entries = entries.filter(e => e.year === filters.year);
    }
    if (filters.month) {
      entries = entries.filter(e => e.month === filters.month);
    }
    return entries;
  }, [allOpsEntries, filters.year, filters.month]);

  return { data, loading, error };
};

/**
 * Get all users from the shared cache.
 */
export const useUsers = () => {
  const { users, loading, error } = useFirestoreCache();
  return { users, loading, error };
};

/**
 * Get data validation warnings from the shared cache.
 * Returns warnings keyed by user display name.
 */
export const useDataWarnings = () => {
  const { dataWarnings } = useFirestoreCache();
  return dataWarnings || {};
};

/**
 * Get all clients from the shared cache.
 */
export const useClients = () => {
  const { clients, loading, error } = useFirestoreCache();
  return { clients, loading, error };
};

export const useAllDownloadEvents = () => {
  const { allDownloadEvents, loading, error } = useFirestoreCache();
  return { data: allDownloadEvents || [], loading, error };
};

/**
 * Get firm-wide monthly metrics from `monthlyMetrics/all`.
 * Each entry: { month, year, revenueAccrued, syncedAt }
 */
export const useMonthlyMetrics = () => {
  const { monthlyMetrics, loading, error } = useFirestoreCache();
  return { data: monthlyMetrics || [], loading, error };
};

/**
 * Get all client invoice entries from `invoices/all` (synced from the
 * Invoices workbook's "Payment Status" tab). Drives the calculated client
 * Payment Status tags — see utils/paymentStatus.mjs.
 */
export const useInvoices = () => {
  const { invoices, loading, error } = useFirestoreCache();
  return { invoices: invoices || [], loading, error };
};

/**
 * Calculated client Payment Status tags (On Target / Warning / Hold) for the
 * whole book, computed once per cache refresh from `invoices/all` + each
 * client's paymentTerms. The single computation site for every consumer —
 * look up a client with `getClientPaymentStatus(index, clientName)`.
 */
export const usePaymentStatusIndex = () => {
  const { invoices, clients, loading, error } = useFirestoreCache();
  const index = useMemo(
    () => buildPaymentStatusIndex(invoices || [], clients || []),
    [invoices, clients]
  );
  return { index, loading, error };
};

/**
 * Get the firm's out-of-office + holiday document from `timeOff/all`.
 * Returns the raw doc ({ holidays, outOfOffice, ... }) or null until synced.
 * Parse it with utils/timeOff.js `parseTimeOff` before use.
 */
export const useTimeOff = () => {
  const { timeOff, loading, error } = useFirestoreCache();
  return { data: timeOff || null, loading, error };
};

/**
 * Get billable entries for a specific user from the shared cache.
 * Supports lookup by display name or Firestore document ID.
 */
export const useUserBillableEntries = (userNameOrId) => {
  const { allBillableEntries, users, loading, error } = useFirestoreCache();

  const data = useMemo(() => {
    if (!userNameOrId) return [];

    // Build a set of matching userIds: check both direct ID match and display name match
    const matchingIds = new Set();
    users.forEach(user => {
      if (user.id === userNameOrId || (user.name || user.id) === userNameOrId) {
        matchingIds.add(user.id);
      }
    });

    // Fallback: if no user matched, try direct ID match on entries
    if (matchingIds.size === 0) {
      matchingIds.add(userNameOrId);
    }

    return allBillableEntries.filter(e => matchingIds.has(e.userId));
  }, [allBillableEntries, users, userNameOrId]);

  return { data, loading, error };
};

/**
 * Get ops entries for a specific user from the shared cache.
 * Supports lookup by display name or Firestore document ID.
 */
export const useUserOpsEntries = (userNameOrId) => {
  const { allOpsEntries, users, loading, error } = useFirestoreCache();

  const data = useMemo(() => {
    if (!userNameOrId) return [];

    // Build a set of matching userIds: check both direct ID match and display name match
    const matchingIds = new Set();
    users.forEach(user => {
      if (user.id === userNameOrId || (user.name || user.id) === userNameOrId) {
        matchingIds.add(user.id);
      }
    });

    // Fallback: if no user matched, try direct ID match on entries
    if (matchingIds.size === 0) {
      matchingIds.add(userNameOrId);
    }

    return allOpsEntries.filter(e => matchingIds.has(e.userId));
  }, [allOpsEntries, users, userNameOrId]);

  return { data, loading, error };
};
