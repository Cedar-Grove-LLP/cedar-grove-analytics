import { useMemo, useCallback } from 'react';
import { useAllBillableEntries, useAllOpsEntries, useAllDownloadEvents, useUsers, useClients, useMonthlyMetrics, useTimeOff } from './useFirestoreData';
import { useAttorneyRates } from './useAttorneyRates';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import {
  getEntryDate,
  getPSTDate,
  calculateDateRange,
  derivePriorPeriodWindow,
  listRangeMonthKeys,
} from '../utils/dateHelpers';
import {
  parseTimeOff,
  getHolidaySet,
  getOooMapFor,
  proRateMonth,
} from '../utils/timeOff';
import { filterHiddenAttorneys } from '../utils/hiddenAttorneys.mjs';
import { sortBySeniority } from '../utils/seniority.mjs';
import {
  buildUserActivity,
  buildAttorneyStats,
  selectVisibleAttorneys,
  buildAttorneyTotalsIncludingHidden,
  calculateUtilization,
  computeGrossBillables,
  computeFirmTotals,
} from '../utils/analyticsAggregation.mjs';
import { hasJoinedBy } from '@/utils/userActivation.mjs';

export const useAnalyticsData = ({
  dateRange,
  customDateStart,
  customDateEnd,
  globalAttorneyFilter,
  transactionAttorneyFilter,
}) => {
  // Read data from shared cache
  const { data: allBillableEntries, loading: billableLoading, error: billableError } = useAllBillableEntries();
  const { data: allOpsEntries, loading: opsLoading, error: opsError } = useAllOpsEntries();
  const { users: firebaseUsers, loading: usersLoading, error: usersError } = useUsers();
  const { clients: firebaseClients, loading: clientsLoading, error: clientsError } = useClients();
  const { data: allDownloadEvents, loading: downloadsLoading } = useAllDownloadEvents();
  const { data: monthlyMetrics } = useMonthlyMetrics();
  const { data: timeOff } = useTimeOff();
  const { getRate, getRateInfo, loading: ratesLoading } = useAttorneyRates();
  const { allTargets: userTargets } = useFirestoreCache();

  // Parse OOO + holidays once per data load (memoized on the raw doc).
  const parsedTimeOff = useMemo(() => parseTimeOff(timeOff), [timeOff]);

  const loading = billableLoading || opsLoading || usersLoading || clientsLoading || downloadsLoading || ratesLoading;
  const error = billableError || opsError || usersError || clientsError;

  // Create user name map (userId -> display name)
  const userMap = useMemo(() => {
    const map = {};
    firebaseUsers.forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [firebaseUsers]);

  // Create user role map (from Firestore user profile)
  const userRoleMap = useMemo(() => {
    const map = {};
    firebaseUsers.forEach(user => {
      const name = user.name || user.id;
      map[name] = user.role || 'Attorney';
    });
    return map;
  }, [firebaseUsers]);

  // Create user employment type map (from Firestore user profile)
  const userEmploymentTypeMap = useMemo(() => {
    const map = {};
    firebaseUsers.forEach(user => {
      const name = user.name || user.id;
      map[name] = user.employmentType || 'FTE';
    });
    return map;
  }, [firebaseUsers]);

  // Create user email map (display name -> email) for joining out-of-office data
  const userEmailMap = useMemo(() => {
    const map = {};
    firebaseUsers.forEach(user => {
      const name = user.name || user.id;
      map[name] = user.email || '';
    });
    return map;
  }, [firebaseUsers]);

  // Helper function to get role for a user
  const getUserRole = useCallback((name) => {
    return userRoleMap[name] || 'Attorney';
  }, [userRoleMap]);

  // Calculate the date range boundaries (canonical implementation lives in
  // dateHelpers.calculateDateRange; all-time derives its start from the
  // earliest billable OR ops entry, hence the concatenated array).
  const dateRangeInfo = useMemo(() => {
    const now = getPSTDate();
    const { startDate, endDate } = calculateDateRange(
      dateRange,
      customDateStart,
      customDateEnd,
      [...(allBillableEntries || []), ...(allOpsEntries || [])],
      now,
    );

    // Current month key for comparison
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return { startDate, endDate, currentMonthKey, now };
  }, [dateRange, customDateStart, customDateEnd, allBillableEntries, allOpsEntries]);

  // Equivalent prior window for period-over-period deltas (e.g. last-month May
  // → prior April). all-time has no meaningful prior period.
  const priorDateRangeInfo = useMemo(
    () => derivePriorPeriodWindow(dateRange, dateRangeInfo),
    [dateRange, dateRangeInfo]
  );

  // Names of attorneys explicitly toggled inactive in the admin panel.
  // Inactive attorneys are only surfaced when the selected range overlaps their data.
  const inactiveAttorneyNames = useMemo(() => {
    const names = new Set();
    firebaseUsers.forEach(user => {
      if (user.active === false) names.add(user.name || user.id);
    });
    return names;
  }, [firebaseUsers]);

  // Names of attorneys who had not yet joined the firm as of the end of the
  // selected date range. Mirrors namesWithDataInRange's all-time special case:
  // an unbounded range means no one can be "not yet joined", so this Set is
  // empty for dateRange === 'all-time'.
  const notYetJoinedAttorneyNames = useMemo(() => {
    const names = new Set();
    const rangeEnd = dateRange === 'all-time' ? null : dateRangeInfo.endDate;
    firebaseUsers.forEach(user => {
      if (!hasJoinedBy(user, rangeEnd)) names.add(user.name || user.id);
    });
    return names;
  }, [firebaseUsers, dateRange, dateRangeInfo]);

  // Names that have at least one billable/ops entry inside the selected date
  // range (global attorney filter intentionally ignored — this drives which
  // inactive attorneys are eligible to appear at all for this timeframe).
  const namesWithDataInRange = useMemo(() => {
    const names = new Set();
    const { startDate: rangeStart, endDate: rangeEnd } = dateRangeInfo;
    const inRange = (entry) => {
      if (dateRange === 'all-time' || !rangeStart) return true;
      const d = getEntryDate(entry);
      return d >= rangeStart && d <= rangeEnd;
    };
    (allBillableEntries || []).forEach(e => { if (inRange(e)) names.add(userMap[e.userId] || e.userId); });
    (allOpsEntries || []).forEach(e => { if (inRange(e)) names.add(userMap[e.userId] || e.userId); });
    return names;
  }, [allBillableEntries, allOpsEntries, dateRange, dateRangeInfo, userMap]);

  // Get list of all user names for global filter dropdown
  // Filter out hidden users, and inactive users that have no data in range.
  const allAttorneyNames = useMemo(() => {
    const names = new Set();
    firebaseUsers.forEach(user => {
      names.add(user.name || user.id);
    });

    // Drop hidden attorneys, plus inactive attorneys with no data this timeframe.
    // Listed in firm seniority order (unknown names trail alphabetically).
    const allNames = sortBySeniority(Array.from(names));
    return filterHiddenAttorneys(allNames).filter(name =>
      (!inactiveAttorneyNames.has(name) || namesWithDataInRange.has(name)) &&
      (!notYetJoinedAttorneyNames.has(name) || namesWithDataInRange.has(name))
    );
  }, [firebaseUsers, inactiveAttorneyNames, notYetJoinedAttorneyNames, namesWithDataInRange]);

  // Filter billable entries based on date range and attorney filter
  const filteredBillableEntries = useMemo(() => {
    if (!allBillableEntries) return [];

    let entries = allBillableEntries;

    // Filter by date range
    if (dateRange !== 'all-time') {
      const { startDate: rangeStart, endDate: rangeEnd } = dateRangeInfo;

      if (rangeStart) {
        entries = entries.filter(entry => {
          const entryDate = getEntryDate(entry);
          return entryDate >= rangeStart && entryDate <= rangeEnd;
        });
      }
    }

    // Filter by selected users (global filter)
    if (globalAttorneyFilter.length > 0) {
      entries = entries.filter(entry => {
        const userName = userMap[entry.userId] || entry.userId;
        return globalAttorneyFilter.includes(userName);
      });
    }

    return entries;
  }, [allBillableEntries, dateRange, dateRangeInfo, globalAttorneyFilter, userMap]);

  // Billable entries for the prior comparison window (same attorney filter as
  // the current window) — powers the Active/Quiet period-over-period deltas.
  const priorPeriodBillableEntries = useMemo(() => {
    if (!allBillableEntries || !priorDateRangeInfo.hasPrior) return [];

    const { startDate: rangeStart, endDate: rangeEnd } = priorDateRangeInfo;

    let entries = allBillableEntries.filter(entry => {
      const entryDate = getEntryDate(entry);
      return entryDate >= rangeStart && entryDate <= rangeEnd;
    });

    // Filter by selected users (global filter) — mirror filteredBillableEntries.
    if (globalAttorneyFilter.length > 0) {
      entries = entries.filter(entry => {
        const userName = userMap[entry.userId] || entry.userId;
        return globalAttorneyFilter.includes(userName);
      });
    }

    return entries;
  }, [allBillableEntries, priorDateRangeInfo, globalAttorneyFilter, userMap]);

  // Filter ops entries based on date range and attorney filter
  const filteredOpsEntries = useMemo(() => {
    if (!allOpsEntries) return [];

    let entries = allOpsEntries;

    // Filter by date range
    if (dateRange !== 'all-time') {
      const { startDate: rangeStart, endDate: rangeEnd } = dateRangeInfo;

      if (rangeStart) {
        entries = entries.filter(entry => {
          const entryDate = getEntryDate(entry);
          return entryDate >= rangeStart && entryDate <= rangeEnd;
        });
      }
    }

    // Filter by selected users (global filter)
    if (globalAttorneyFilter.length > 0) {
      entries = entries.filter(entry => {
        const userName = userMap[entry.userId] || entry.userId;
        return globalAttorneyFilter.includes(userName);
      });
    }

    return entries;
  }, [allOpsEntries, dateRange, dateRangeInfo, globalAttorneyFilter, userMap]);

  // Helper function to get default target for a user (uses current month target if available)
  const getDefaultTarget = useCallback((userName) => {
    const { currentMonthKey } = dateRangeInfo;
    const userTargetData = userTargets[userName] || {};
    const currentMonthTarget = userTargetData[currentMonthKey];

    return {
      billableHours: currentMonthTarget?.billableHours ?? 100,
      opsHours: currentMonthTarget?.opsHours ?? 50,
      totalHours: currentMonthTarget?.totalHours ?? 150
    };
  }, [dateRangeInfo, userTargets]);

  // Calculate the months spanned by the selected date range (for target calculation)
  const dateRangeMonths = useMemo(
    () => listRangeMonthKeys(dateRangeInfo.startDate, dateRangeInfo.endDate),
    [dateRangeInfo]
  );

  // Process user data with proper target calculations (pure passes live in
  // utils/analyticsAggregation.mjs; this memo wires in the fetched data).
  const attorneyData = useMemo(() => {
    const { startDate, endDate } = dateRangeInfo;

    // Seed all users from the database so they appear even with zero hours
    // (respecting the global attorney filter).
    const seedNames = [];
    firebaseUsers.forEach(user => {
      const userName = user.name || user.id;
      if (globalAttorneyFilter.length > 0 && !globalAttorneyFilter.includes(userName)) {
        return;
      }
      seedNames.push(userName);
    });

    const activity = buildUserActivity({
      billableEntries: filteredBillableEntries,
      opsEntries: filteredOpsEntries,
      getUserName: (entry) => userMap[entry.userId] || entry.userId,
      getRate,
      seedNames,
    });

    // Firm holidays for the active range (calendar-sourced, or federal fallback).
    // Range-dependent only, so resolve once for all attorneys.
    const rangeHolidaySet = getHolidaySet(parsedTimeOff, startDate, endDate);

    const allUserData = buildAttorneyStats({
      activity,
      rangeMonths: dateRangeMonths,
      userTargets,
      getDefaultTarget,
      // Capacity-model fraction: firm holidays cancel for a full month (they
      // only affect intra-month pace), while the attorney's OOO reduces the
      // target for any period — in-progress or completed. A fully-OOO month
      // yields 0; a full clean month yields exactly 1 (unchanged behavior).
      getMonthProRateFor: (userName) => {
        // This attorney's out-of-office days (joined by email, then name),
        // resolved once per user.
        const oooMap = getOooMapFor(parsedTimeOff, { name: userName, email: userEmailMap[userName] || '' });
        return (monthKey, year, month) =>
          proRateMonth(year, month, dateRangeInfo, rangeHolidaySet, oooMap);
      },
      getUserRole,
      getEmploymentType: (userName) => userEmploymentTypeMap[userName] || 'FTE',
    });

    // Filter out hidden users from display; firm-seniority order.
    return selectVisibleAttorneys(allUserData, {
      inactiveNames: inactiveAttorneyNames,
      notYetJoinedNames: notYetJoinedAttorneyNames,
      namesWithData: namesWithDataInRange,
      startDate,
      endDate,
    });
  }, [filteredBillableEntries, filteredOpsEntries, userMap, getRate, dateRangeInfo, userTargets, getUserRole, userEmploymentTypeMap, userEmailMap, parsedTimeOff, getDefaultTarget, firebaseUsers, globalAttorneyFilter, dateRangeMonths, inactiveAttorneyNames, namesWithDataInRange, notYetJoinedAttorneyNames]);

  // Create a separate dataset that includes hidden users for totals calculation
  const allAttorneyDataIncludingHidden = useMemo(() => {
    return buildAttorneyTotalsIncludingHidden({
      billableEntries: filteredBillableEntries,
      opsEntries: filteredOpsEntries,
      getUserName: (entry) => userMap[entry.userId] || entry.userId,
      getDefaultTarget,
    });
    // userTargets is intentionally NOT in this dep array: this memo body
    // does not read userTargets directly; it only calls getDefaultTarget
    // (a useCallback with [dateRangeInfo, userTargets] deps). When
    // userTargets changes, getDefaultTarget's identity changes and triggers
    // re-computation transitively.
  }, [filteredBillableEntries, filteredOpsEntries, userMap, getDefaultTarget]);

  // Process transaction data (from billable entries only)
  const transactionData = useMemo(() => {
    const transactionStats = {};

    const entriesToProcess = transactionAttorneyFilter === 'all'
      ? filteredBillableEntries
      : filteredBillableEntries.filter(entry => {
          const userName = userMap[entry.userId] || entry.userId;
          return userName === transactionAttorneyFilter;
        });

    entriesToProcess.forEach(entry => {
      const category = entry.billingCategory || 'Other';
      const billableHours = entry.billableHours || 0;
      const earnings = entry.earnings || 0;
      const userName = userMap[entry.userId] || entry.userId;
      const matter = entry.matter || '';

      if (billableHours > 0) {
        if (!transactionStats[category]) {
          transactionStats[category] = {
            type: category,
            totalHours: 0,
            totalEarnings: 0,
            entryCount: 0,
            matters: {},
            byAttorney: {},
            entries: []
          };
        }

        transactionStats[category].totalHours += billableHours;
        transactionStats[category].totalEarnings += earnings;
        transactionStats[category].entryCount += 1;

        // Track matters within each category
        if (matter) {
          if (!transactionStats[category].matters[matter]) {
            transactionStats[category].matters[matter] = {
              matter,
              clientName: entry.client || 'Unknown',
              totalHours: 0,
              totalEarnings: 0,
              count: 0
            };
          }
          transactionStats[category].matters[matter].totalHours += billableHours;
          transactionStats[category].matters[matter].totalEarnings += earnings;
          transactionStats[category].matters[matter].count += 1;
        }

        if (!transactionStats[category].byAttorney[userName]) {
          transactionStats[category].byAttorney[userName] = { count: 0, hours: 0, earnings: 0 };
        }
        transactionStats[category].byAttorney[userName].count += 1;
        transactionStats[category].byAttorney[userName].hours += billableHours;
        transactionStats[category].byAttorney[userName].earnings += earnings;

        if (transactionStats[category].entries.length < 50) {
          transactionStats[category].entries.push({
            attorney: userName,
            client: entry.client || 'Unknown',
            hours: billableHours,
            earnings: earnings,
            date: entry.date || '',
            notes: entry.notes || ''
          });
        }
      }
    });

    return Object.values(transactionStats).map(stat => {
      const matterCount = Object.keys(stat.matters).length;
      return {
        ...stat,
        count: matterCount || stat.entryCount,
        matterCount,
        avgHours: matterCount > 0 ? (stat.totalHours / matterCount).toFixed(1) : (stat.entryCount > 0 ? (stat.totalHours / stat.entryCount).toFixed(1) : 0),
        avgEarnings: matterCount > 0 ? (stat.totalEarnings / matterCount).toFixed(2) : (stat.entryCount > 0 ? (stat.totalEarnings / stat.entryCount).toFixed(2) : 0),
        entries: stat.entries.sort((a, b) => {
          if (!a.date || !b.date) return 0;
          const dateA = a.date.seconds ? new Date(a.date.seconds * 1000) : new Date(a.date);
          const dateB = b.date.seconds ? new Date(b.date.seconds * 1000) : new Date(b.date);
          return dateB - dateA;
        })
      };
    }).sort((a, b) => b.totalHours - a.totalHours);
  }, [filteredBillableEntries, transactionAttorneyFilter, userMap]);

  // Per-member transaction breakdown for the Overview's cohort-scoped chart.
  // Built from the same entries as transactionData (hidden/inactive attorneys
  // included per the aggregate-totals convention, transaction attorney filter
  // honored, Adjustment categories included), so totals derived from any
  // cohort subset compose back to transactionData's per-category totals.
  const transactionMemberData = useMemo(() => {
    const byUser = new Map();

    const entriesToProcess = transactionAttorneyFilter === 'all'
      ? filteredBillableEntries
      : filteredBillableEntries.filter(entry => {
          const userName = userMap[entry.userId] || entry.userId;
          return userName === transactionAttorneyFilter;
        });

    entriesToProcess.forEach(entry => {
      const billableHours = entry.billableHours || 0;
      if (billableHours <= 0) return;
      const userName = userMap[entry.userId] || entry.userId;
      const category = entry.billingCategory || 'Other';

      if (!byUser.has(userName)) {
        byUser.set(userName, {
          name: userName,
          role: getUserRole(userName),
          employmentType: userEmploymentTypeMap[userName] || 'FTE',
          transactions: {},
        });
      }
      const member = byUser.get(userName);
      member.transactions[category] = (member.transactions[category] || 0) + billableHours;
    });

    return [...byUser.values()];
  }, [filteredBillableEntries, transactionAttorneyFilter, userMap, getUserRole, userEmploymentTypeMap]);

  // Process matter data (from billable entries only, grouped by matter name)
  const matterData = useMemo(() => {
    const matterStats = {};

    filteredBillableEntries.forEach(entry => {
      const matter = entry.matter || '';
      if (!matter) return; // Skip entries with no matter

      const billableHours = entry.billableHours || 0;
      const earnings = entry.earnings || 0;
      const userName = userMap[entry.userId] || entry.userId;

      if (billableHours > 0) {
        if (!matterStats[matter]) {
          matterStats[matter] = {
            matter,
            clientName: entry.client || 'Unknown',
            totalHours: 0,
            totalEarnings: 0,
            count: 0,
            byAttorney: {},
            byCategory: {},
            entries: []
          };
        }

        matterStats[matter].totalHours += billableHours;
        matterStats[matter].totalEarnings += earnings;
        matterStats[matter].count += 1;

        if (!matterStats[matter].byAttorney[userName]) {
          matterStats[matter].byAttorney[userName] = { count: 0, hours: 0, earnings: 0 };
        }
        matterStats[matter].byAttorney[userName].count += 1;
        matterStats[matter].byAttorney[userName].hours += billableHours;
        matterStats[matter].byAttorney[userName].earnings += earnings;

        const category = entry.billingCategory || 'Other';
        if (!matterStats[matter].byCategory[category]) {
          matterStats[matter].byCategory[category] = { count: 0, hours: 0, earnings: 0 };
        }
        matterStats[matter].byCategory[category].count += 1;
        matterStats[matter].byCategory[category].hours += billableHours;
        matterStats[matter].byCategory[category].earnings += earnings;

        if (matterStats[matter].entries.length < 50) {
          matterStats[matter].entries.push({
            attorney: userName,
            client: entry.client || 'Unknown',
            hours: billableHours,
            earnings: earnings,
            date: entry.date || '',
            notes: entry.notes || ''
          });
        }
      }
    });

    return Object.values(matterStats).map(stat => ({
      ...stat,
      avgHours: stat.count > 0 ? (stat.totalHours / stat.count).toFixed(1) : 0,
      entries: stat.entries.sort((a, b) => {
        if (!a.date || !b.date) return 0;
        const dateA = a.date.seconds ? new Date(a.date.seconds * 1000) : new Date(a.date);
        const dateB = b.date.seconds ? new Date(b.date.seconds * 1000) : new Date(b.date);
        return dateB - dateA;
      })
    })).sort((a, b) => b.totalHours - a.totalHours);
  }, [filteredBillableEntries, userMap]);

  // Process download data (from driveDownloads events, grouped by folder then file)
  const downloadData = useMemo(() => {
    if (!allDownloadEvents || allDownloadEvents.length === 0) return [];

    const { startDate, endDate } = dateRangeInfo;

    // Filter events by date range
    const filtered = allDownloadEvents.filter(event => {
      if (!event.date) return false;
      if (dateRange === 'all-time') return true;
      const eventDate = new Date(event.date + 'T00:00:00');
      return eventDate >= startDate && eventDate <= endDate;
    });

    // Group by folderName (immediate parent folder) -> file
    const folderStats = {};
    filtered.forEach(event => {
      const file = event.file;
      if (!file) return;

      const folderName = event.folderName || event.folder || 'Unknown';
      const folderPath = event.folderPath || folderName;
      const folder = event.folder || 'Unknown';

      if (!folderStats[folderName]) {
        folderStats[folderName] = {
          folderPath,
          folderName,
          folder,
          downloads: 0,
          lastDownload: '',
          users: {},
          files: {},
        };
      }

      folderStats[folderName].downloads += 1;
      if (event.ts > folderStats[folderName].lastDownload) {
        folderStats[folderName].lastDownload = event.ts;
      }
      if (event.user) {
        folderStats[folderName].users[event.user] = (folderStats[folderName].users[event.user] || 0) + 1;
      }

      // Track file-level stats within folder
      if (!folderStats[folderName].files[file]) {
        folderStats[folderName].files[file] = {
          file,
          downloads: 0,
          lastDownload: '',
          type: event.type || '',
          owner: event.owner || '',
          users: {},
        };
      }

      folderStats[folderName].files[file].downloads += 1;
      if (event.ts > folderStats[folderName].files[file].lastDownload) {
        folderStats[folderName].files[file].lastDownload = event.ts;
      }
      if (event.user) {
        folderStats[folderName].files[file].users[event.user] =
          (folderStats[folderName].files[file].users[event.user] || 0) + 1;
      }
    });

    return Object.values(folderStats)
      .map(stat => ({
        ...stat,
        uniqueFiles: Object.keys(stat.files).length,
        uniqueUsers: Object.keys(stat.users).length,
        files: Object.values(stat.files)
          .map(f => ({
            ...f,
            topUsers: Object.entries(f.users)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 5)
              .map(([user, count]) => ({ user, count })),
          }))
          .sort((a, b) => b.downloads - a.downloads),
      }))
      .sort((a, b) => b.downloads - a.downloads);
  }, [allDownloadEvents, dateRangeInfo, dateRange]);

  // Per-attorney download aggregate (date-range filtered)
  const attorneyDownloadData = useMemo(() => {
    if (!allDownloadEvents || allDownloadEvents.length === 0) return [];

    const { startDate, endDate } = dateRangeInfo;
    const filtered = allDownloadEvents.filter(event => {
      if (!event.date) return false;
      if (dateRange === 'all-time') return true;
      const eventDate = new Date(event.date + 'T00:00:00');
      return eventDate >= startDate && eventDate <= endDate;
    });

    const userStats = {};
    filtered.forEach(event => {
      const user = event.user;
      if (!user) return;
      if (!userStats[user]) {
        userStats[user] = {
          user,
          totalDownloads: 0,
          files: {},
          folderCounts: {},
          lastDownload: '',
          lastFile: '',
        };
      }
      const stats = userStats[user];
      stats.totalDownloads += 1;

      const folder = event.folderName || event.folder || 'Unknown';
      stats.folderCounts[folder] = (stats.folderCounts[folder] || 0) + 1;

      if (event.file) {
        stats.files[event.file] = (stats.files[event.file] || 0) + 1;
      }
      if (event.ts && event.ts > stats.lastDownload) {
        stats.lastDownload = event.ts;
        stats.lastFile = event.file || '';
      }
    });

    return Object.values(userStats)
      .map(stat => {
        const fileEntries = Object.entries(stat.files);
        const topFile = fileEntries.length
          ? fileEntries.sort((a, b) => b[1] - a[1])[0]
          : null;
        return {
          user: stat.user,
          totalDownloads: stat.totalDownloads,
          uniqueFiles: fileEntries.length,
          lastDownload: stat.lastDownload,
          lastFile: stat.lastFile,
          folderCounts: stat.folderCounts,
          topFile: topFile ? { file: topFile[0], count: topFile[1] } : null,
        };
      })
      .sort((a, b) => b.totalDownloads - a.totalDownloads);
  }, [allDownloadEvents, dateRangeInfo, dateRange]);

  // Process ops data (from ops entries only)
  const opsData = useMemo(() => {
    const opsStats = {};
    let totalOpsHours = 0;

    filteredOpsEntries.forEach(entry => {
      const opsHours = entry.opsHours || 0;
      const userName = userMap[entry.userId] || entry.userId;

      if (opsHours > 0) {
        const category = (entry.category && entry.category.trim() !== '')
          ? entry.category
          : 'Other';

        if (!opsStats[category]) {
          opsStats[category] = { hours: 0, byAttorney: {}, entries: [] };
        }
        opsStats[category].hours += opsHours;
        totalOpsHours += opsHours;

        if (!opsStats[category].byAttorney[userName]) {
          opsStats[category].byAttorney[userName] = { count: 0, hours: 0 };
        }
        opsStats[category].byAttorney[userName].count += 1;
        opsStats[category].byAttorney[userName].hours += opsHours;

        if (opsStats[category].entries.length < 50) {
          opsStats[category].entries.push({
            attorney: userName,
            client: 'N/A',
            hours: opsHours,
            date: entry.date || '',
            notes: entry.description || entry.notes || ''
          });
        }
      }
    });

    return Object.entries(opsStats).map(([category, data]) => ({
      category,
      hours: Math.round(data.hours * 10) / 10,
      percentage: totalOpsHours > 0 ? Math.round((data.hours / totalOpsHours) * 100) : 0,
      byAttorney: data.byAttorney,
      entries: data.entries.sort((a, b) => {
        if (!a.date || !b.date) return 0;
        const dateA = a.date.seconds ? new Date(a.date.seconds * 1000) : new Date(a.date);
        const dateB = b.date.seconds ? new Date(b.date.seconds * 1000) : new Date(b.date);
        return dateB - dateA;
      }),
      count: data.entries.length
    })).sort((a, b) => b.hours - a.hours);
  }, [filteredOpsEntries, userMap]);

  // Process client data - merge billable + ops entries
  const clientData = useMemo(() => {
    const entryStats = {};

    // Process billable entries
    filteredBillableEntries.forEach(entry => {
      const clientName = entry.client || 'Unknown';
      const billableHours = entry.billableHours || 0;
      const category = entry.billingCategory || 'Other';
      const earnings = entry.earnings || 0;
      const entryDate = getEntryDate(entry);
      const userName = userMap[entry.userId] || entry.userId;

      if (!entryStats[clientName]) {
        entryStats[clientName] = {
          totalHours: 0,
          totalEarnings: 0,
          uniqueTransactions: new Set(),
          transactionCount: 0,
          lastActivity: entryDate,
          byAttorney: {},
          byCategory: {},
          entries: []
        };
      }

      entryStats[clientName].totalHours += billableHours;
      entryStats[clientName].totalEarnings += earnings;
      entryStats[clientName].uniqueTransactions.add(category);
      entryStats[clientName].transactionCount += 1;

      if (entryDate > entryStats[clientName].lastActivity) {
        entryStats[clientName].lastActivity = entryDate;
      }

      if (!entryStats[clientName].byAttorney[userName]) {
        entryStats[clientName].byAttorney[userName] = { count: 0, hours: 0, earnings: 0 };
      }
      entryStats[clientName].byAttorney[userName].count += 1;
      entryStats[clientName].byAttorney[userName].hours += billableHours;
      entryStats[clientName].byAttorney[userName].earnings += earnings;

      if (!entryStats[clientName].byCategory[category]) {
        entryStats[clientName].byCategory[category] = { count: 0, hours: 0 };
      }
      entryStats[clientName].byCategory[category].count += 1;
      entryStats[clientName].byCategory[category].hours += billableHours;

      if (entryStats[clientName].entries.length < 50) {
        entryStats[clientName].entries.push({
          attorney: userName,
          category: category,
          billableHours: billableHours,
          opsHours: 0,
          totalHours: billableHours,
          earnings: earnings,
          date: entry.date || '',
          notes: entry.notes || ''
        });
      }
    });

    // Process ops entries (add ops hours to client totals)
    filteredOpsEntries.forEach(entry => {
      // Ops entries don't have a client field in the new schema
      // so we skip client association for ops entries
      // They contribute to user totals but not client-specific breakdowns
    });

    const activeStatuses = ['Active', 'Quiet'];
    const inactiveStatuses = ['Terminated', 'Dissolved'];

    return firebaseClients
      .filter(client => {
        const status = client.status || '';
        return activeStatuses.includes(status) || (!inactiveStatuses.includes(status) && status !== '');
      })
      .map(client => {
        const clientName = client.clientName || 'Unknown';
        const stats = entryStats[clientName] || {
          totalHours: 0,
          totalEarnings: 0,
          uniqueTransactions: new Set(),
          transactionCount: 0,
          lastActivity: null,
          byAttorney: {},
          byCategory: {},
          entries: []
        };

        const fbStatus = client.status || '';
        let displayStatus = 'active';
        if (fbStatus === 'Quiet') {
          displayStatus = 'quiet';
        } else if (inactiveStatuses.includes(fbStatus)) {
          displayStatus = 'inactive';
        }

        const sortedEntries = (stats.entries || []).sort((a, b) => {
          if (!a.date || !b.date) return 0;
          const dateA = a.date.seconds ? new Date(a.date.seconds * 1000) : new Date(a.date);
          const dateB = b.date.seconds ? new Date(b.date.seconds * 1000) : new Date(b.date);
          return dateB - dateA;
        });

        return {
          name: clientName,
          totalHours: Math.round(stats.totalHours * 10) / 10,
          totalEarnings: stats.totalEarnings,
          uniqueTransactions: stats.uniqueTransactions.size,
          avgHoursPerTransaction: stats.transactionCount > 0
            ? (stats.totalHours / stats.transactionCount).toFixed(1)
            : 0,
          lastActivity: stats.lastActivity
            ? stats.lastActivity.toISOString().split('T')[0]
            : 'No activity',
          status: displayStatus,
          fbStatus: fbStatus,
          clientType: client.clientType || '',
          channel: client.channel || '',
          contactEmail: client.contactEmail || '',
          website: client.website || '',
          // Per-client "General Notes" synced from the finance sheet, kept on
          // the client object so it stays paired with its client by name
          // (never by row position) through any table sort. Coerce before
          // trimming — a numeric-only note cell syncs from Sheets as a number.
          notes: String(client.notes || '').trim(),
          byAttorney: stats.byAttorney || {},
          byCategory: stats.byCategory || {},
          entries: sortedEntries,
          entryCount: stats.transactionCount || 0
        };
      })
      .sort((a, b) => b.totalHours - a.totalHours);
  }, [filteredBillableEntries, filteredOpsEntries, firebaseClients, userMap]);

  // Count clients by status from Firebase
  const clientCounts = useMemo(() => {
    const inactiveStatuses = ['Terminated', 'Dissolved'];

    const active = firebaseClients.filter(c => c.status === 'Active').length;
    const quiet = firebaseClients.filter(c => c.status === 'Quiet').length;
    const terminated = firebaseClients.filter(c => inactiveStatuses.includes(c.status)).length;
    const total = active + quiet;

    return { active, quiet, terminated, total };
  }, [firebaseClients]);

  // Utilization now lives in utils/analyticsAggregation.mjs
  // (calculateUtilization — null → "N/A" when the pro-rated target is 0);
  // re-exported unchanged from this hook's return object below.

  // Total firm-wide revenue accrued across all months (from monthlyMetrics/all)
  const totalRevenueAccrued = useMemo(() => {
    return (monthlyMetrics || []).reduce((acc, m) => acc + (m.revenueAccrued || 0), 0);
  }, [monthlyMetrics]);

  // Sum a firm-wide monthly metric field (e.g. revenueAccrued, attorneyBillables)
  // over the active date range. Null when the range does not align to one or more
  // whole calendar months (or when no monthlyMetrics entries match).
  const computePeriodMetric = useCallback((field) => {
    if (!monthlyMetrics || monthlyMetrics.length === 0) return null;

    if (dateRange === 'all-time') {
      const total = monthlyMetrics.reduce((acc, m) => acc + (m[field] || 0), 0);
      return total > 0 ? total : null;
    }

    const { startDate, endDate } = dateRangeInfo || {};
    if (!startDate || !endDate) return null;

    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];

    // Enumerate every calendar month touched by [startDate, endDate]
    const candidates = [];
    let y = startDate.getFullYear();
    let m = startDate.getMonth();
    const endY = endDate.getFullYear();
    const endM = endDate.getMonth();
    while (y < endY || (y === endY && m <= endM)) {
      candidates.push({ year: y, monthIndex: m });
      m++; if (m > 11) { m = 0; y++; }
    }

    const now = getPSTDate();
    const matched = candidates.filter(({ year, monthIndex }) => {
      const monthFirst = new Date(year, monthIndex, 1, 0, 0, 0, 0);
      const monthLast = new Date(year, monthIndex + 1, 0, 23, 59, 59, 999);
      const fullyCovered = startDate <= monthFirst && endDate >= monthLast;
      // Allow the in-progress current month: range starts on the 1st and ends today
      const isCurrentMonthToDate =
        startDate.getTime() === monthFirst.getTime() &&
        year === now.getFullYear() &&
        monthIndex === now.getMonth() &&
        endDate <= monthLast;
      return fullyCovered || isCurrentMonthToDate;
    });

    // Use the firm-wide monthly figure only when the range aligns cleanly to
    // whole calendar months (or the current month-to-date). If any touched
    // month is only partially covered — Trailing 60, a week, or an arbitrary
    // custom range — return null so the caller falls back to rate × hours.
    if (matched.length === 0 || matched.length !== candidates.length) return null;

    let sum = 0;
    for (const { year, monthIndex } of matched) {
      const entry = monthlyMetrics.find(
        e => e.year === year && e.month === monthNames[monthIndex]
      );
      // Every in-range month must have a synced value, otherwise the sum would
      // understate the period — fall back instead of reporting a partial figure.
      if (!entry || typeof entry[field] !== 'number') return null;
      sum += entry[field];
    }

    return sum;
  }, [dateRange, dateRangeInfo, monthlyMetrics]);

  // Revenue Accrued and Attorney Billables for the active date range (firm-wide,
  // pulled from the source sheet). Null when the range doesn't align to whole months.
  const periodRevenueAccrued = useMemo(() => computePeriodMetric('revenueAccrued'), [computePeriodMetric]);
  const periodAttorneyBillables = useMemo(() => computePeriodMetric('attorneyBillables'), [computePeriodMetric]);

  // One pass over the in-range billable entries computes both the gross
  // billables total (rate × hours — includes hidden users) AND the
  // missing-rate warnings: attorneys whose hours bill at $0 because no
  // usable rate covers those months. Months before an attorney's earliest
  // stored rate bill retrospectively at that earliest rate (see
  // rateLookup.mjs), so the warning now fires only for mid-history gaps and
  // attorneys with no usable rates at all. Surfaced as an explicit warning
  // instead of silently understating every rate × hours figure.
  const grossBillablesInfo = useMemo(() => {
    return computeGrossBillables({
      billableEntries: filteredBillableEntries,
      getUserName: (entry) => userMap[entry.userId] || entry.userId,
      getRateInfo,
    });
  }, [filteredBillableEntries, userMap, getRateInfo]);

  const { totalGrossBillables, missingRateWarnings } = grossBillablesInfo;

  // Calculate totals - use allAttorneyDataIncludingHidden for accurate totals
  const totals = useMemo(
    () => computeFirmTotals({
      visibleAttorneys: attorneyData,
      attorneysIncludingHidden: allAttorneyDataIncludingHidden,
    }),
    [attorneyData, allAttorneyDataIncludingHidden]
  );

  return {
    loading,
    error,
    allAttorneyNames,
    filteredBillableEntries,
    filteredOpsEntries,
    attorneyData,
    transactionData,
    transactionMemberData,
    matterData,
    downloadData,
    attorneyDownloadData,
    opsData,
    clientData,
    clientCounts,
    calculateUtilization,
    dateRangeInfo,
    priorPeriodBillableEntries,
    hasPriorPeriod: priorDateRangeInfo.hasPrior,
    totalGrossBillables,
    totalRevenueAccrued,
    periodRevenueAccrued,
    periodAttorneyBillables,
    missingRateWarnings,
    ...totals,
  };
};

export default useAnalyticsData;
