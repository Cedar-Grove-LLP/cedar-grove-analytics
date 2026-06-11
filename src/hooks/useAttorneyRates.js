"use client";

import { useMemo, useCallback } from 'react';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { findRate, findRateInfo, monthKeyFromDate } from '@/utils/rateLookup.mjs';

/**
 * Hook to get all user billing rates from the shared cache.
 * Returns a map of userId -> { monthKey -> rate }
 */
export function useAttorneyRates() {
  const { allRates, users, loading, error } = useFirestoreCache();

  // Build userId -> display name map for resolving entry.userId to display name
  const userIdToName = useMemo(() => {
    const map = {};
    (users || []).forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [users]);

  const getRate = useCallback((userName, date) => {
    if (!userName || !allRates[userName]) {
      return 0;
    }

    const monthKey = monthKeyFromDate(date);
    if (!monthKey) {
      return 0;
    }

    return findRate(allRates[userName], monthKey);
  }, [allRates]);

  // Like getRate, but reports whether a rate actually existed for the
  // requested month (exact or backward fallback) so callers can warn on
  // gaps instead of treating a missing rate as a silent $0.
  const getRateInfo = useCallback((userName, date) => {
    const requestedMonthKey = monthKeyFromDate(date);
    if (!userName || !allRates[userName] || !requestedMonthKey) {
      return { rate: 0, found: false, sourceMonthKey: null, requestedMonthKey };
    }
    return findRateInfo(allRates[userName], requestedMonthKey);
  }, [allRates]);

  const calculateGrossBillables = useCallback((entry) => {
    // Resolve userId (Firestore doc ID) to display name for rate lookup
    const userName = userIdToName[entry.userId] || entry.userId;
    const billableHours = entry.billableHours || 0;

    if (!userName || billableHours <= 0) return 0;

    let entryDate = entry.date;

    // Handle Firestore Timestamp
    if (entryDate && typeof entryDate === 'object' && entryDate.toDate) {
      entryDate = entryDate.toDate();
    } else if (entryDate && typeof entryDate === 'object' && entryDate.seconds) {
      entryDate = new Date(entryDate.seconds * 1000);
    }

    if (!entryDate) return 0;

    const rate = getRate(userName, entryDate);
    return rate * billableHours;
  }, [getRate, userIdToName]);

  return {
    rates: allRates,
    loading,
    error,
    getRate,
    getRateInfo,
    calculateGrossBillables,
  };
}

/**
 * Hook to get rates for a specific user from the shared cache.
 */
export function useAttorneyRatesByName(userName) {
  const { allRates, loading, error } = useFirestoreCache();

  const rates = useMemo(() => {
    if (!userName || !allRates[userName]) return {};
    return allRates[userName];
  }, [allRates, userName]);

  const getRate = useCallback((date) => {
    const monthKey = monthKeyFromDate(date);
    if (!monthKey) {
      return 0;
    }

    return findRate(rates, monthKey);
  }, [rates]);

  return {
    rates,
    loading,
    error,
    getRate,
  };
}

export default useAttorneyRates;
