"use client";

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { collection, getDocs, doc, getDoc, query, where } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';
import { useAuth } from './AuthContext';
import { normalizeBillableEntry, normalizeOpsEntry } from '@/hooks/useFirestoreData';
import { getMonthNumber, getEntryDate } from '@/utils/dateHelpers';
import { parseMoney } from '@/utils/entryNormalize.mjs';
import { zeroAwareCompare } from '@/utils/verify/divergence.mjs';

const FirestoreDataContext = createContext({});

export const useFirestoreCache = () => useContext(FirestoreDataContext);

const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export const FirestoreDataProvider = ({ children }) => {
  const [allBillableEntries, setAllBillableEntries] = useState([]);
  const [allOpsEntries, setAllOpsEntries] = useState([]);
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const lastFetchedAt = useRef(null);
  const fetchInProgress = useRef(false);
  const { user, isAuthorized, isAdmin, isPartialAdmin, hasDownloadsAccess, hasTransactionsOpsAccess, userEmail } = useAuth();

  const fetchAllData = useCallback(async (force = false, silent = false) => {
    if (fetchInProgress.current) return;
    if (!force && lastFetchedAt.current && Date.now() - lastFetchedAt.current < CACHE_TTL) {
      return;
    }

    fetchInProgress.current = true;
    if (!silent) setLoading(true);

    try {
      await waitForAuth();

      // Admins, partial admins (who can reach admin-only routes like
      // /clients/[clientName] and /billing-summaries directly), and the two
      // firm-wide restricted dashboards (downloads-only, transactions+ops-
      // only) need the full firm dataset. A plain attorney only needs their
      // own profile + their own time entries — fetching every attorney's
      // billing rates, targets, clients, and time entries into every
      // signed-in user's browser regardless of role was SEC-008 in the
      // security audit. firestore.rules enforces the matching boundary
      // server-side (hasFullDataAccess() there mirrors this flag exactly).
      const hasFullAccess = isAdmin || isPartialAdmin || hasDownloadsAccess || hasTransactionsOpsAccess;

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
      const warnings = {}; // keyed by userName

      // Helper: round to 2 decimal places for comparison
      const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

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
            if (sheetTotals) {
              const computedHoursRounded = round2(computedHours);
              const computedEarningsRounded = round2(computedEarnings);

              // Zero-aware: a stored 0 against a nonzero entries sum is the proven
              // rollup-zero sync defect and must warn; an absent key still skips.
              if (zeroAwareCompare(computedHoursRounded, sheetTotals.totalBillableHours).equal === false) {
                addWarning(userName, {
                  type: 'hours-mismatch',
                  collection: 'billables',
                  month,
                  year,
                  message: `Billable hours mismatch in ${month} ${year}: entries sum to ${computedHoursRounded}h but sheet total is ${sheetTotals.totalBillableHours}h`,
                });
              }

              if (zeroAwareCompare(computedEarningsRounded, sheetTotals.billableEarnings).equal === false) {
                addWarning(userName, {
                  type: 'earnings-mismatch',
                  collection: 'billables',
                  month,
                  year,
                  message: `Billable earnings mismatch in ${month} ${year}: entries sum to $${computedEarningsRounded.toLocaleString()} but sheet total is $${sheetTotals.billableEarnings.toLocaleString()}`,
                });
              }
            }
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

            // Validate computed ops hours against sheet totals (if available)
            if (sheetTotals) {
              const computedOpsRounded = round2(computedOpsHours);

              if (zeroAwareCompare(computedOpsRounded, sheetTotals.opsHours).equal === false) {
                addWarning(userName, {
                  type: 'hours-mismatch',
                  collection: 'ops',
                  month,
                  year,
                  message: `Ops hours mismatch in ${month} ${year}: entries sum to ${computedOpsRounded}h but sheet total is ${sheetTotals.opsHours}h`,
                });
              }

              // Cross-validate total hours (billable + ops) against sheet total
              // We need to look up the billable sheetTotals for the same month to get computed billable hours
              // This is done after all entries are processed — see totalHours validation below
            }
          }
        });
      });

      // Cross-validate total hours (billable + ops) and total payment per user per month
      // Build a map of sheet totals per user per month from the entry results
      const userMonthSheetTotals = {}; // { userName: { "2026_January": { billables: {...}, ops: {...}, eightThreeB: {...} } } }
      const userMonthComputedTotals = {}; // { userName: { "2026_January": { billableHours, billableEarnings, opsHours, reimbursements, eightThreeBFees } } }

      entryResults.forEach(({ userId, type, snap }) => {
        const userName = userNameLookup[userId] || userId;
        snap.docs.forEach(doc => {
          const data = doc.data();
          const month = data.month || '';
          const year = data.year || new Date().getFullYear();
          const docKey = `${year}_${month}`;
          const entries = data.entries || [];
          const sheetTotals = data.sheetTotals || null;

          if (!userMonthSheetTotals[userName]) userMonthSheetTotals[userName] = {};
          if (!userMonthSheetTotals[userName][docKey]) userMonthSheetTotals[userName][docKey] = {};
          if (sheetTotals) {
            userMonthSheetTotals[userName][docKey][type] = sheetTotals;
          }

          if (!userMonthComputedTotals[userName]) userMonthComputedTotals[userName] = {};
          if (!userMonthComputedTotals[userName][docKey]) {
            userMonthComputedTotals[userName][docKey] = {
              billableHours: 0, billableEarnings: 0, opsHours: 0, reimbursements: 0, eightThreeBFees: 0,
            };
          }

          if (type === 'billables') {
            entries.forEach(entry => {
              userMonthComputedTotals[userName][docKey].billableHours += parseMoney(entry.hours);
              userMonthComputedTotals[userName][docKey].billableEarnings += parseMoney(entry.earnings);
              userMonthComputedTotals[userName][docKey].reimbursements += parseMoney(entry.reimbursements);
            });
          } else if (type === 'ops') {
            entries.forEach(entry => {
              userMonthComputedTotals[userName][docKey].opsHours += parseMoney(entry.hours);
            });
          } else if (type === 'eightThreeB') {
            entries.forEach(entry => {
              userMonthComputedTotals[userName][docKey].eightThreeBFees += parseMoney(entry.flatFee);
            });
          }
        });
      });

      // Check total hours and total payment cross-collection
      Object.entries(userMonthSheetTotals).forEach(([userName, months]) => {
        Object.entries(months).forEach(([docKey, sheetTotalsByType]) => {
          const computed = userMonthComputedTotals[userName]?.[docKey];
          if (!computed) return;

          const [yearStr, month] = docKey.split('_');
          const year = parseInt(yearStr, 10);

          // Total hours check (from ops sheetTotals which has the combined total).
          // Deliberately NOT zero-aware, unlike the per-collection rollups above:
          // this cell is left unpopulated (stored as 0) for every attorney who
          // doesn't track ops, so a 0 here means "absent", not "zero hours" —
          // verified across Agate/Wilson/Skrodzka/Popkin, who bill real hours
          // against a 0 total. Comparing zero-aware turns ~47 unpopulated cells
          // into mismatch warnings and buries the rollup defects worth seeing.
          const opsSheetTotals = sheetTotalsByType.ops;
          if (opsSheetTotals?.totalHours > 0) {
            const computedTotalHours = round2(computed.billableHours + computed.opsHours);
            if (computedTotalHours !== opsSheetTotals.totalHours) {
              addWarning(userName, {
                type: 'total-hours-mismatch',
                month,
                year,
                message: `Total hours mismatch in ${month} ${year}: entries sum to ${computedTotalHours}h but sheet total is ${opsSheetTotals.totalHours}h`,
              });
            }
          }


        });
      });

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
    } else {
      setLoading(false);
    }
  }, [isAuthorized, user, fetchAllData]);

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
