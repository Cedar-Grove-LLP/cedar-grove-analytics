"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';
import { useAuth } from './AuthContext';
import { normalizeBillableEntry, normalizeOpsEntry } from '@/hooks/useFirestoreData';
import { getMonthNumber, getEntryDate } from '@/utils/dateHelpers';
import { parseMoney } from '@/utils/parseMoney.mjs';
import { hasFullDataAccess } from '@/utils/fetchGate.mjs';
import {
  validateBillablesSheetTotals,
  validateOpsSheetTotals,
  buildUserMonthTotals,
  validateTotalHours,
} from '@/utils/sheetTotalsValidation.mjs';

const FirestoreDataContext = createContext({});

export const useFirestoreCache = () => useContext(FirestoreDataContext);

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const FirestoreDataProvider = ({ children }) => {
  const [allBillableEntries, setAllBillableEntries] = useState([]);
  const [allOpsEntries, setAllOpsEntries] = useState([]);
  const [allEightThreeBEntries, setAllEightThreeBEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [clients, setClients] = useState([]);
  const [allRates, setAllRates] = useState({});
  const [allTargets, setAllTargets] = useState({});
  const [allDownloadEvents, setAllDownloadEvents] = useState([]);
  const [monthlyMetrics, setMonthlyMetrics] = useState([]);
  const [invoices, setInvoices] = useState([]);
  const [rateCard, setRateCard] = useState(null);
  const [timeOff, setTimeOff] = useState(null);
  const [dataWarnings, setDataWarnings] = useState({});
  const [userMonthSheetTotalsState, setUserMonthSheetTotalsState] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastFetchedAt = useRef(null);
  const fetchInProgress = useRef(false);
  const { user, isAuthorized, isAdmin, isPartialAdmin, hasDownloadsAccess, hasTransactionsOpsAccess, userEmail, loading: authLoading } = useAuth();

  const fetchAllData = useCallback(async (force = false, silent = false) => {
    if (fetchInProgress.current) return;
    if (!force && lastFetchedAt.current && Date.now() - lastFetchedAt.current < CACHE_TTL) {
      return;
    }

    fetchInProgress.current = true;
    if (!silent) setLoading(true);

    try {
      await waitForAuth();

      // SEC-008 fetch gate — see src/utils/fetchGate.mjs for the full
      // rationale. firestore.rules enforces the matching boundary server-side.
      const hasFullAccess = hasFullDataAccess({ isAdmin, isPartialAdmin, hasDownloadsAccess, hasTransactionsOpsAccess });

      // A plain user only ever needs their own profile doc, looked up by
      // email (doc IDs are display names, not emails) instead of listing
      // every user in the firm.
      const usersQuery = hasFullAccess
        ? collection(db, 'users')
        : query(collection(db, 'users'), where('email', '==', userEmail || '__no-match__'));

      // Fetch users, clients, downloads, monthly metrics, invoices, rate
      // card, and time off in parallel. Everything except users/timeOff is
      // admin/elevated-access-only — skip those reads entirely for a plain
      // user rather than issuing requests firestore.rules would reject.
      const [usersSnap, clientsDoc, downloadsSnap, monthlyMetricsDoc, invoicesDoc, rateCardDoc, timeOffDoc] = await Promise.all([
        getDocs(usersQuery),
        hasFullAccess ? getDoc(doc(db, 'clients', 'all')) : Promise.resolve(null),
        hasFullAccess ? getDocs(collection(db, 'driveDownloads')) : Promise.resolve(null),
        hasFullAccess ? getDoc(doc(db, 'monthlyMetrics', 'all')) : Promise.resolve(null),
        hasFullAccess ? getDoc(doc(db, 'invoices', 'all')) : Promise.resolve(null),
        hasFullAccess ? getDoc(doc(db, 'rateCard', 'all')) : Promise.resolve(null),
        getDoc(doc(db, 'timeOff', 'all')),
      ]);

      // Process users and build rates/targets maps from profile arrays
      const userList = [];
      const ratesMap = {};
      const targetsMap = {};

      usersSnap.docs.forEach(doc => {
        const data = doc.data();
        const userId = doc.id;
        const userName = data.name || userId;

        userList.push({
          id: userId,
          name: userName,
          role: data.role || 'Attorney',
          email: data.email || '',
          employmentType: data.employmentType || 'FTE',
          // Missing flag = active (back-compat for users created before the toggle existed)
          active: data.active !== false,
          activationDate: data.activationDate || null,
        });

        // Build rates map from user profile rates[] array
        // Key by display name so lookups work consistently across the app
        if (Array.isArray(data.rates)) {
          ratesMap[userName] = {};
          data.rates.forEach(rateEntry => {
            const monthNum = getMonthNumber(rateEntry.month);
            const monthKey = `${rateEntry.year}-${String(monthNum).padStart(2, '0')}`;
            ratesMap[userName][monthKey] = {
              rate: rateEntry.rate || 0,
              // Attorney take-home rate (the sheet's "Rate" cell) — distinct
              // from `rate` (client billing rate); drives manual billable
              // entry earnings (hours × take-home) on Timesheets (testing).
              takeHomeRate: rateEntry.takeHomeRate || 0,
              month: monthNum,
              year: rateEntry.year,
            };
          });
        }

        // Build targets map from user profile targets[] array
        // Key by display name so lookups work consistently across the app
        if (Array.isArray(data.targets)) {
          targetsMap[userName] = {};
          data.targets.forEach(targetEntry => {
            const monthNum = getMonthNumber(targetEntry.month);
            const monthKey = `${targetEntry.year}-${String(monthNum).padStart(2, '0')}`;
            targetsMap[userName][monthKey] = {
              billableHours: targetEntry.billableHours ?? 100,
              opsHours: targetEntry.opsHours ?? 50,
              totalHours: targetEntry.totalHours ?? 150,
              earnings: targetEntry.earnings ?? 0,
            };
          });
        }
      });

      // Fetch billables, ops, and eightThreeB subcollections for all users in parallel
      const userIds = usersSnap.docs.map(doc => doc.id);
      const entryFetches = userIds.flatMap(userId => [
        getDocs(collection(db, 'users', userId, 'billables')).then(snap => ({ userId, type: 'billables', snap })),
        getDocs(collection(db, 'users', userId, 'ops')).then(snap => ({ userId, type: 'ops', snap })),
        getDocs(collection(db, 'users', userId, 'eightThreeB')).then(snap => ({ userId, type: 'eightThreeB', snap })),
      ]);

      const entryResults = await Promise.all(entryFetches);

      // Process billable, ops, and 83(b) entries, validating dates and totals against parent document
      const billableEntries = [];
      const opsEntries = [];
      const eightThreeBEntries = [];
      const warnings = {}; // keyed by userName

      // Helper: add a warning for a user
      const addWarning = (userName, warning) => {
        if (!warnings[userName]) warnings[userName] = [];
        warnings[userName].push(warning);
      };

      // Build userId -> userName lookup from already-processed userList
      const userNameLookup = {};
      userList.forEach(u => { userNameLookup[u.id] = u.name; });

      entryResults.forEach(({ userId, type, snap }) => {
        const userName = userNameLookup[userId] || userId;

        snap.docs.forEach(doc => {
          const data = doc.data();
          const month = data.month || '';
          const year = data.year || new Date().getFullYear();
          const entries = data.entries || [];
          const docMonthNum = getMonthNumber(month); // 1-indexed
          const sheetTotals = data.sheetTotals || null;

          if (type === 'billables') {
            const mismatchedRows = [];
            let computedHours = 0;
            let computedEarnings = 0;
            let computedReimbursements = 0;

            entries.forEach((entry, idx) => {
              const normalized = normalizeBillableEntry(entry, userId, month, year);
              billableEntries.push({ id: `${userId}_${doc.id}_${idx}`, ...normalized });

              computedHours += normalized.billableHours || 0;
              computedEarnings += normalized.earnings || 0;
              computedReimbursements += normalized.reimbursements || 0;

              // Validate entry date against document month/year
              const entryDate = getEntryDate(normalized);
              if (entryDate && !isNaN(entryDate.getTime())) {
                if (entryDate.getMonth() + 1 !== docMonthNum || entryDate.getFullYear() !== year) {
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  mismatchedRows.push({
                    row: normalized.sheetRowNumber || (idx + 10),
                    date: `${monthNames[entryDate.getMonth()]} ${entryDate.getDate()}, ${entryDate.getFullYear()}`,
                    client: normalized.client || '',
                    hours: normalized.billableHours || 0,
                  });
                }
              }
            });

            if (mismatchedRows.length > 0) {
              addWarning(userName, {
                type: 'date-mismatch',
                collection: 'billables',
                month,
                year,
                count: mismatchedRows.length,
                total: entries.length,
                mismatchedRows,
                message: `${mismatchedRows.length} of ${entries.length} billable ${entries.length === 1 ? 'entry has a' : 'entries have'} date${mismatchedRows.length === 1 ? '' : 's'} outside ${month} ${year}`,
              });
            }

            // Validate computed sums against sheet totals (if available)
            validateBillablesSheetTotals({ sheetTotals, computedHours, computedEarnings, month, year })
              .forEach(warning => addWarning(userName, warning));
          } else if (type === 'ops') {
            const mismatchedRows = [];
            let computedOpsHours = 0;

            entries.forEach((entry, idx) => {
              const normalized = normalizeOpsEntry(entry, userId, month, year);
              opsEntries.push({ id: `${userId}_${doc.id}_${idx}`, ...normalized });

              computedOpsHours += normalized.opsHours || 0;

              const entryDate = getEntryDate(normalized);
              if (entryDate && !isNaN(entryDate.getTime())) {
                if (entryDate.getMonth() + 1 !== docMonthNum || entryDate.getFullYear() !== year) {
                  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                  mismatchedRows.push({
                    row: normalized.sheetRowNumber || (idx + 10),
                    date: `${monthNames[entryDate.getMonth()]} ${entryDate.getDate()}, ${entryDate.getFullYear()}`,
                    description: normalized.description || '',
                    hours: normalized.opsHours || 0,
                  });
                }
              }
            });

            if (mismatchedRows.length > 0) {
              addWarning(userName, {
                type: 'date-mismatch',
                collection: 'ops',
                month,
                year,
                count: mismatchedRows.length,
                total: entries.length,
                mismatchedRows,
                message: `${mismatchedRows.length} of ${entries.length} ops ${entries.length === 1 ? 'entry has a' : 'entries have'} date${mismatchedRows.length === 1 ? '' : 's'} outside ${month} ${year}`,
              });
            }

            // Validate computed ops hours against sheet totals (if available).
            // Cross-validation of total hours (billable + ops) needs the
            // billable sheetTotals for the same month — done after all
            // entries are processed, see the totalHours validation below.
            validateOpsSheetTotals({ sheetTotals, computedOpsHours, month, year })
              .forEach(warning => addWarning(userName, warning));
          } else if (type === 'eightThreeB') {
            entries.forEach((entry, idx) => {
              eightThreeBEntries.push({
                id: `${userId}_${doc.id}_${idx}`,
                userId,
                name: entry.name || '',
                company: entry.company || '',
                flatFee: parseMoney(entry.flatFee),
                sheetRowNumber: entry.sheetRowNumber,
                month,
                year,
              });
            });
          }
        });
      });

      // Cross-validate total hours (billable + ops) per user per month.
      // Flatten the entry results into plain records, then build the sheet-
      // total and computed-total maps and run the cross-collection check
      // (pure logic in utils/sheetTotalsValidation.mjs).
      const docRecords = [];
      entryResults.forEach(({ userId, type, snap }) => {
        const userName = userNameLookup[userId] || userId;
        snap.docs.forEach(doc => {
          const data = doc.data();
          docRecords.push({
            userName,
            type,
            month: data.month || '',
            year: data.year || new Date().getFullYear(),
            entries: data.entries || [],
            sheetTotals: data.sheetTotals || null,
          });
        });
      });

      const { userMonthSheetTotals, userMonthComputedTotals } = buildUserMonthTotals(docRecords);

      validateTotalHours(userMonthSheetTotals, userMonthComputedTotals)
        .forEach(({ userName, warning }) => addWarning(userName, warning));

      // Process clients (skipped/null for a plain, non-elevated user — see hasFullAccess above)
      const clientList = clientsDoc?.exists() ? (clientsDoc.data().clients || []) : [];

      // Process download events — flatten all month docs into a single array
      const downloadEvents = [];
      (downloadsSnap?.docs || []).forEach(doc => {
        const data = doc.data();
        const events = data.events || [];
        events.forEach(event => {
          downloadEvents.push({
            ts: event.ts || '',
            date: event.date || '',
            user: event.user || '',
            file: event.file || '',
            type: event.type || '',
            docId: event.docId || null,
            owner: event.owner || null,
            folder: event.folder || '',
            folderName: event.folderName || event.folder || '',
            folderPath: event.folderPath || event.folder || '',
          });
        });
      });

      const monthlyMetricsList = monthlyMetricsDoc?.exists() ? (monthlyMetricsDoc.data().entries || []) : [];

      const invoiceList = invoicesDoc?.exists() ? (invoicesDoc.data().entries || []) : [];

      const rateCardData = rateCardDoc?.exists() ? rateCardDoc.data() : null;

      // Out-of-office + firm holidays (optional; enrichment only — absent until the sync ships)
      const timeOffData = timeOffDoc.exists() ? timeOffDoc.data() : null;

      setAllBillableEntries(billableEntries);
      setAllOpsEntries(opsEntries);
      setAllEightThreeBEntries(eightThreeBEntries);
      setUsers(userList);
      setClients(clientList);
      setAllDownloadEvents(downloadEvents);
      setMonthlyMetrics(monthlyMetricsList);
      setInvoices(invoiceList);
      setRateCard(rateCardData);
      setTimeOff(timeOffData);
      setAllRates(ratesMap);
      setAllTargets(targetsMap);
      setDataWarnings(warnings);
      setUserMonthSheetTotalsState(userMonthSheetTotals);
      setError(null);
      lastFetchedAt.current = Date.now();
    } catch (err) {
      console.error('FirestoreDataProvider: Error fetching data:', err);
      if (!silent) setError(err.message);
    } finally {
      if (!silent) setLoading(false);
      fetchInProgress.current = false;
    }
  }, [isAdmin, isPartialAdmin, hasDownloadsAccess, hasTransactionsOpsAccess, userEmail]);

  // Fetch on auth
  useEffect(() => {
    if (isAuthorized && user) {
      fetchAllData();
    } else if (!authLoading) {
      // Only settle the cache as "not loading" once auth has DEFINITIVELY
      // resolved to an unauthenticated/unauthorized state. While auth is
      // still resolving, `loading` must stay true: child effects (e.g.
      // ProtectedRoute's decideRoute gate) run before this provider's
      // effect in the commit where auth flips authorized, and a premature
      // loading=false makes them read the still-empty users cache as a
      // definitive deny — the direct-load /login?error=access_denied race.
      setLoading(false);
    }
  }, [isAuthorized, user, authLoading, fetchAllData]);

  // Background refresh when tab regains focus
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isAuthorized && lastFetchedAt.current) {
        const age = Date.now() - lastFetchedAt.current;
        if (age > CACHE_TTL) {
          fetchAllData(true, true);
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isAuthorized, fetchAllData]);

  const refetch = useCallback((force = true) => {
    return fetchAllData(force, false);
  }, [fetchAllData]);

  const value = {
    allBillableEntries,
    allOpsEntries,
    allEightThreeBEntries,
    allDownloadEvents,
    monthlyMetrics,
    invoices,
    rateCard,
    timeOff,
    users,
    clients,
    allRates,
    allTargets,
    dataWarnings,
    userMonthSheetTotals: userMonthSheetTotalsState,
    loading,
    error,
    refetch,
  };

  return (
    <FirestoreDataContext.Provider value={value}>
      {children}
    </FirestoreDataContext.Provider>
  );
};
