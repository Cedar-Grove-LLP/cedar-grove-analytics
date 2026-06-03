import { useMemo, useCallback } from 'react';
import { useAllBillableEntries, useAllOpsEntries, useAllDownloadEvents, useUsers, useClients, useMonthlyMetrics, useTimeOff } from './useFirestoreData';
import { useAttorneyRates } from './useAttorneyRates';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import {
  getEntryDate,
  getPSTDate,
} from '../utils/dateHelpers';
import {
  parseTimeOff,
  getHolidaySet,
  getOooSetFor,
  proRateMonth,
} from '../utils/timeOff';
import {
  isAttorneyHidden,
  shouldIncludeAttorneyData,
  filterHiddenAttorneys,
} from '../utils/hiddenAttorneys';
import { getClientRating } from '../utils/clientRating';

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
  const { getRate, loading: ratesLoading } = useAttorneyRates();
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

  // Calculate the date range boundaries
  const dateRangeInfo = useMemo(() => {
    const now = getPSTDate();
    let startDate;
    let endDate = new Date(now);

    switch (dateRange) {
      case 'all-time':
        if ((allBillableEntries && allBillableEntries.length > 0) || (allOpsEntries && allOpsEntries.length > 0)) {
          const billableDates = (allBillableEntries || []).map(e => getEntryDate(e)).filter(d => d);
          const opsDates = (allOpsEntries || []).map(e => getEntryDate(e)).filter(d => d);
          const allDates = [...billableDates, ...opsDates];
          if (allDates.length > 0) {
            startDate = new Date(Math.min(...allDates.map(d => d.getTime())));
          } else {
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
          }
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        break;
      case 'current-week': {
        const dayOfWeek = now.getDay();
        // Monday = 1, so days since last Monday: (dow + 6) % 7
        const daysSinceMonday = (dayOfWeek + 6) % 7;
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
        break;
      }
      case 'last-week': {
        const dow = now.getDay();
        // Monday = 1, so days since last Monday: (dow + 6) % 7
        const daysSinceMonday = (dow + 6) % 7;
        const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
        startDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7, 0, 0, 0, 0);
        endDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1, 23, 59, 59, 999);
        break;
      }
      case 'current-month':
        startDate = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0);
        break;
      case 'last-month':
        startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1, 0, 0, 0, 0);
        endDate = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
        break;
      case 'trailing-60':
        startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60, 0, 0, 0, 0);
        break;
      case 'custom':
        if (customDateStart && customDateEnd) {
          const [startYear, startMonth, startDay] = customDateStart.split('-').map(Number);
          const [endYear, endMonth, endDay] = customDateEnd.split('-').map(Number);
          startDate = new Date(startYear, startMonth - 1, startDay);
          endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        break;
      default:
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    }

    // Current month key for comparison
    const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    return { startDate, endDate, currentMonthKey, now };
  }, [dateRange, customDateStart, customDateEnd, allBillableEntries, allOpsEntries]);

  // Get list of all user names for global filter dropdown
  // Filter out hidden users from the UI display
  const allAttorneyNames = useMemo(() => {
    const names = new Set();
    firebaseUsers.forEach(user => {
      names.add(user.name || user.id);
    });

    // Filter out hidden attorneys from the dropdown
    const allNames = Array.from(names).sort();
    return filterHiddenAttorneys(allNames);
  }, [firebaseUsers]);

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
  const dateRangeMonths = useMemo(() => {
    const { startDate, endDate } = dateRangeInfo;
    const months = [];
    if (!startDate || !endDate) return months;
    const cursor = new Date(startDate.getFullYear(), startDate.getMonth(), 1);
    const end = new Date(endDate.getFullYear(), endDate.getMonth(), 1);
    while (cursor <= end) {
      months.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return months;
  }, [dateRangeInfo]);

  // Process user data with proper target calculations
  const attorneyData = useMemo(() => {
    const userStats = {};
    const userMonthlyActivity = {};

    const { startDate, endDate } = dateRangeInfo;

    // Seed all users from the database so they appear even with zero hours
    firebaseUsers.forEach(user => {
      const userName = user.name || user.id;

      // Respect global attorney filter
      if (globalAttorneyFilter.length > 0 && !globalAttorneyFilter.includes(userName)) {
        return;
      }

      userMonthlyActivity[userName] = {
        months: new Set(),
        billable: 0,
        ops: 0,
        earnings: 0,
        transactions: {},
        clients: {}
      };
    });

    // First pass: collect billable hours per user
    filteredBillableEntries.forEach(entry => {
      const userName = userMap[entry.userId] || entry.userId;
      const entryDate = getEntryDate(entry);

      if (!userMonthlyActivity[userName]) {
        userMonthlyActivity[userName] = {
          months: new Set(),
          billable: 0,
          ops: 0,
          earnings: 0,
          transactions: {},
          clients: {}
        };
      }

      if (entryDate) {
        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
        userMonthlyActivity[userName].months.add(monthKey);
      }

      const billableHours = entry.billableHours || 0;
      const earnings = entry.earnings || 0;

      userMonthlyActivity[userName].billable += billableHours;
      userMonthlyActivity[userName].earnings += earnings;
      // Gross billables = rate × hours (distinct from take-home `earnings`)
      if (billableHours > 0) {
        userMonthlyActivity[userName].grossBillables =
          (userMonthlyActivity[userName].grossBillables || 0) + getRate(userName, entryDate) * billableHours;
      }

      const category = entry.billingCategory || 'Other';
      const client = entry.client || 'Unknown';
      const isAdjustment = category.toLowerCase() === 'adjustment' || category.toLowerCase() === 'adjustments';

      // Track transactions, but exclude adjustments
      if (billableHours > 0 && !isAdjustment) {
        if (!userMonthlyActivity[userName].transactions[category]) {
          userMonthlyActivity[userName].transactions[category] = 0;
        }
        userMonthlyActivity[userName].transactions[category] += billableHours;
      }

      if (!userMonthlyActivity[userName].clients[client]) {
        userMonthlyActivity[userName].clients[client] = 0;
      }
      userMonthlyActivity[userName].clients[client] += billableHours;
    });

    // Second pass: collect ops hours per user
    filteredOpsEntries.forEach(entry => {
      const userName = userMap[entry.userId] || entry.userId;
      const entryDate = getEntryDate(entry);

      if (!userMonthlyActivity[userName]) {
        userMonthlyActivity[userName] = {
          months: new Set(),
          billable: 0,
          ops: 0,
          earnings: 0,
          transactions: {},
          clients: {}
        };
      }

      if (entryDate) {
        const monthKey = `${entryDate.getFullYear()}-${String(entryDate.getMonth() + 1).padStart(2, '0')}`;
        userMonthlyActivity[userName].months.add(monthKey);
      }

      const opsHours = entry.opsHours || 0;
      userMonthlyActivity[userName].ops += opsHours;
    });

    // Firm holidays for the active range (calendar-sourced, or federal fallback).
    // Range-dependent only, so resolve once for all attorneys.
    const rangeHolidaySet = getHolidaySet(parsedTimeOff, startDate, endDate);

    // Third pass: calculate targets for each user based on date range months
    Object.entries(userMonthlyActivity).forEach(([userName, data]) => {
      let totalBillableTarget = 0;
      let totalOpsTarget = 0;
      let totalTarget = 0;
      let oooDays = 0;
      let holidayDays = 0;

      const userTargetData = userTargets[userName] || {};
      const defaultTarget = getDefaultTarget(userName);

      // This attorney's out-of-office days (joined by email, then name).
      const oooSet = getOooSetFor(parsedTimeOff, { name: userName, email: userEmailMap[userName] || '' });

      // Use date range months for target calculation so users with zero hours
      // still get proper pro-rated targets for the selected period
      const monthsForTargets = dateRangeMonths.length > 0 ? dateRangeMonths : Array.from(data.months);

      // If no months at all, use defaults for one month
      if (monthsForTargets.length === 0) {
        totalBillableTarget = defaultTarget.billableHours;
        totalOpsTarget = defaultTarget.opsHours;
        totalTarget = defaultTarget.totalHours;
      } else {
        monthsForTargets.forEach(monthKey => {
          const [year, month] = monthKey.split('-').map(Number);

          // Get the target for this month
          const monthTarget = userTargetData[monthKey];
          const billableTarget = monthTarget?.billableHours ?? defaultTarget.billableHours;
          const opsTarget = monthTarget?.opsHours ?? defaultTarget.opsHours;
          const monthTotalTarget = monthTarget?.totalHours ?? defaultTarget.totalHours;

          // Capacity-model fraction: firm holidays cancel for a full month (they
          // only affect intra-month pace), while the attorney's OOO reduces the
          // target for any period — in-progress or completed. A fully-OOO month
          // yields 0; a full clean month yields exactly 1 (unchanged behavior).
          const pm = proRateMonth(year, month, dateRangeInfo, rangeHolidaySet, oooSet);

          totalBillableTarget += billableTarget * pm.fraction;
          totalOpsTarget += opsTarget * pm.fraction;
          totalTarget += monthTotalTarget * pm.fraction;
          oooDays += pm.oooDays;        // OOO / holiday context (UI messaging only)
          holidayDays += pm.holidayDays;
        });
      }

      userStats[userName] = {
        name: userName,
        billable: data.billable,
        ops: data.ops,
        earnings: data.earnings,
        grossBillables: data.grossBillables || 0,
        target: Math.round(totalTarget * 10) / 10,
        billableTarget: Math.round(totalBillableTarget * 10) / 10,
        opsTarget: Math.round(totalOpsTarget * 10) / 10,
        oooDays,
        holidayDays,
        role: getUserRole(userName),
        employmentType: userEmploymentTypeMap[userName] || 'FTE',
        transactions: data.transactions,
        clients: data.clients,
        topTransactions: Object.entries(data.transactions)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([name]) => name)
      };
    });

    // Convert to array and filter out hidden users from display
    const allUserData = Object.values(userStats);

    const visibleUserData = allUserData.filter(user => {
      return shouldIncludeAttorneyData(user.name, startDate, endDate) &&
             !isAttorneyHidden(user.name);
    });

    return visibleUserData;
  }, [filteredBillableEntries, filteredOpsEntries, userMap, getRate, dateRangeInfo, userTargets, getUserRole, userEmploymentTypeMap, userEmailMap, parsedTimeOff, getDefaultTarget, firebaseUsers, globalAttorneyFilter, dateRangeMonths]);

  // Create a separate dataset that includes hidden users for totals calculation
  const allAttorneyDataIncludingHidden = useMemo(() => {
    const userStats = {};
    const userMonthlyActivity = {};

    // Collect billable hours
    filteredBillableEntries.forEach(entry => {
      const userName = userMap[entry.userId] || entry.userId;

      if (!userMonthlyActivity[userName]) {
        userMonthlyActivity[userName] = { billable: 0, ops: 0, earnings: 0 };
      }

      userMonthlyActivity[userName].billable += (entry.billableHours || 0);
      userMonthlyActivity[userName].earnings += (entry.earnings || 0);
    });

    // Collect ops hours
    filteredOpsEntries.forEach(entry => {
      const userName = userMap[entry.userId] || entry.userId;

      if (!userMonthlyActivity[userName]) {
        userMonthlyActivity[userName] = { billable: 0, ops: 0, earnings: 0 };
      }

      userMonthlyActivity[userName].ops += (entry.opsHours || 0);
    });

    Object.entries(userMonthlyActivity).forEach(([userName, data]) => {
      const defaultTarget = getDefaultTarget(userName);

      userStats[userName] = {
        name: userName,
        billable: data.billable,
        ops: data.ops,
        earnings: data.earnings,
        target: defaultTarget.totalHours,
        billableTarget: defaultTarget.billableHours,
        opsTarget: defaultTarget.opsHours,
      };
    });

    return Object.values(userStats);
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
          idealRating: getClientRating(client),
          clientType: client.clientType || '',
          channel: client.channel || '',
          contactEmail: client.contactEmail || '',
          website: client.website || '',
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

  // Calculate utilization. Returns null (→ "N/A") when the pro-rated target is 0,
  // which now happens when an attorney is out of office for the entire period —
  // reporting 0% there would misread leave as underperformance.
  const calculateUtilization = (user) => {
    const total = user.billable + user.ops;
    if (!user.target || user.target <= 0) return null;
    return Math.round((total / user.target) * 100);
  };

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

  // Calculate total gross billables (rate * hours) - includes all entries (hidden users too)
  const totalGrossBillables = useMemo(() => {
    let total = 0;
    filteredBillableEntries.forEach(entry => {
      const billableHours = entry.billableHours || 0;
      if (billableHours > 0) {
        const entryDate = getEntryDate(entry);
        const userName = userMap[entry.userId] || entry.userId;
        const rate = getRate(userName, entryDate);
        total += rate * billableHours;
      }
    });
    return total;
  }, [filteredBillableEntries, userMap, getRate]);

  // Calculate totals - use allAttorneyDataIncludingHidden for accurate totals
  const totals = useMemo(() => {
    const totalBillable = allAttorneyDataIncludingHidden.reduce((acc, att) => acc + att.billable, 0);
    const totalOps = allAttorneyDataIncludingHidden.reduce((acc, att) => acc + att.ops, 0);
    const totalEarnings = allAttorneyDataIncludingHidden.reduce((acc, att) => acc + att.earnings, 0);

    const totalBillableTarget = attorneyData.reduce((acc, att) => acc + att.billableTarget, 0);
    const totalOpsTarget = attorneyData.reduce((acc, att) => acc + att.opsTarget, 0);

    // Use all visible tracked users (attorneyData already excludes hidden users)
    const attorneysOnly = attorneyData;
    const fteAttorneys = attorneysOnly.filter(att => att.employmentType === 'FTE');
    const pteAttorneys = attorneysOnly.filter(att => att.employmentType === 'PTE');

    // Average utilization, skipping attorneys with no target for the period
    // (fully out of office) so their N/A doesn't drag the cohort average.
    const avgOf = (list) => {
      const vals = list.map(att => calculateUtilization(att)).filter(v => v !== null);
      return vals.length > 0
        ? Math.round(vals.reduce((acc, v) => acc + v, 0) / vals.length)
        : 0;
    };

    const avgUtilization = avgOf(attorneysOnly);
    const avgUtilizationFTE = avgOf(fteAttorneys);
    const avgUtilizationPTE = avgOf(pteAttorneys);

    return {
      totalBillable,
      totalOps,
      totalEarnings,
      totalBillableTarget,
      totalOpsTarget,
      avgUtilization,
      avgUtilizationFTE,
      avgUtilizationPTE,
      attorneyCountFTE: fteAttorneys.length,
      attorneyCountPTE: pteAttorneys.length,
      attorneyCountTotal: attorneysOnly.length,
    };
  }, [attorneyData, allAttorneyDataIncludingHidden]);

  return {
    loading,
    error,
    allAttorneyNames,
    filteredBillableEntries,
    filteredOpsEntries,
    attorneyData,
    transactionData,
    matterData,
    downloadData,
    attorneyDownloadData,
    opsData,
    clientData,
    clientCounts,
    calculateUtilization,
    dateRangeInfo,
    totalGrossBillables,
    totalRevenueAccrued,
    periodRevenueAccrued,
    periodAttorneyBillables,
    ...totals,
  };
};

export default useAnalyticsData;
