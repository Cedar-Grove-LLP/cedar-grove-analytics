// Helper function to convert month name to number
export const getMonthNumber = (monthName) => {
  const months = ['January', 'February', 'March', 'April', 'May', 'June',
                  'July', 'August', 'September', 'October', 'November', 'December'];
  return months.findIndex(m => m.toLowerCase() === monthName?.toLowerCase()) + 1 || 1;
};

// Helper to get current date/time in PST
export const getPSTDate = () => {
  const now = new Date();
  const pstString = now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' });
  return new Date(pstString);
};

// Helper function to get date from entry.
// Entries are day-granularity: returns local midnight of the PST calendar day
// the entry belongs to, so .getMonth()/.getDate()/.getFullYear() yield the
// same answer regardless of the browser's timezone.
const PST_DATE_PARTS = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Los_Angeles',
  year: 'numeric', month: '2-digit', day: '2-digit',
});

export const getEntryDate = (entry) => {
  let raw;
  if (entry.date?.toDate) {
    raw = entry.date.toDate();
  } else if (entry.date && typeof entry.date === 'object' && entry.date.seconds) {
    raw = new Date(entry.date.seconds * 1000);
  } else if (entry.date) {
    raw = new Date(entry.date);
  } else {
    return new Date(entry.year, getMonthNumber(entry.month) - 1);
  }

  if (!raw || isNaN(raw.getTime())) return raw;

  const parts = Object.fromEntries(
    PST_DATE_PARTS.formatToParts(raw)
      .filter(p => p.type !== 'literal')
      .map(p => [p.type, parseInt(p.value, 10)])
  );
  return new Date(parts.year, parts.month - 1, parts.day);
};

/**
 * Format a Date as a local-calendar-day key 'YYYY-MM-DD'.
 * Uses local getFullYear/getMonth/getDate so it lines up with the local-midnight
 * dates produced by getEntryDate and the month math elsewhere in this module.
 * Used to test membership in holiday / out-of-office date sets.
 */
export const toDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

/**
 * Check if a date is a business day (Monday-Friday, excluding US federal holidays)
 */
export const isBusinessDay = (date) => {
  const day = date.getDay();
  // Weekend check
  if (day === 0 || day === 6) return false;
  
  // US Federal Holidays (approximate - some holidays have complex rules)
  const year = date.getFullYear();
  const month = date.getMonth();
  const dayOfMonth = date.getDate();
  
  const holidays = getUSFederalHolidays(year);
  
  for (const holiday of holidays) {
    if (holiday.getMonth() === month && holiday.getDate() === dayOfMonth) {
      return false;
    }
  }
  
  return true;
};

/**
 * Get US Federal Holidays for a given year
 * Returns array of Date objects
 */
export const getUSFederalHolidays = (year) => {
  const holidays = [];
  
  // New Year's Day - January 1 (observed on closest weekday if on weekend)
  holidays.push(observedHoliday(new Date(year, 0, 1)));
  
  // MLK Day - Third Monday in January
  holidays.push(nthWeekdayOfMonth(year, 0, 1, 3));
  
  // Presidents Day - Third Monday in February
  holidays.push(nthWeekdayOfMonth(year, 1, 1, 3));
  
  // Memorial Day - Last Monday in May
  holidays.push(lastWeekdayOfMonth(year, 4, 1));
  
  // Juneteenth - June 19 (observed on closest weekday if on weekend)
  holidays.push(observedHoliday(new Date(year, 5, 19)));
  
  // Independence Day - July 4 (observed on closest weekday if on weekend)
  holidays.push(observedHoliday(new Date(year, 6, 4)));
  
  // Labor Day - First Monday in September
  holidays.push(nthWeekdayOfMonth(year, 8, 1, 1));
  
  // Columbus Day - Second Monday in October
  holidays.push(nthWeekdayOfMonth(year, 9, 1, 2));
  
  // Veterans Day - November 11 (observed on closest weekday if on weekend)
  holidays.push(observedHoliday(new Date(year, 10, 11)));
  
  // Thanksgiving - Fourth Thursday in November
  holidays.push(nthWeekdayOfMonth(year, 10, 4, 4));
  
  // Day after Thanksgiving - Fourth Friday in November
  const thanksgiving = nthWeekdayOfMonth(year, 10, 4, 4);
  holidays.push(new Date(thanksgiving.getTime() + 24 * 60 * 60 * 1000));
  
  // Christmas Day - December 25 (observed on closest weekday if on weekend)
  holidays.push(observedHoliday(new Date(year, 11, 25)));
  
  return holidays;
};

/**
 * Get the nth occurrence of a weekday in a month
 * @param year - Year
 * @param month - Month (0-indexed)
 * @param weekday - Day of week (0=Sunday, 1=Monday, etc.)
 * @param n - Which occurrence (1=first, 2=second, etc.)
 */
const nthWeekdayOfMonth = (year, month, weekday, n) => {
  const firstDay = new Date(year, month, 1);
  const firstWeekday = firstDay.getDay();
  let dayOffset = weekday - firstWeekday;
  if (dayOffset < 0) dayOffset += 7;
  const day = 1 + dayOffset + (n - 1) * 7;
  return new Date(year, month, day);
};

/**
 * Get the last occurrence of a weekday in a month
 */
const lastWeekdayOfMonth = (year, month, weekday) => {
  const lastDay = new Date(year, month + 1, 0);
  const lastWeekday = lastDay.getDay();
  let dayOffset = lastWeekday - weekday;
  if (dayOffset < 0) dayOffset += 7;
  return new Date(year, month + 1, -dayOffset);
};

/**
 * Get the observed date for a holiday (Friday if Saturday, Monday if Sunday)
 */
const observedHoliday = (date) => {
  const day = date.getDay();
  if (day === 6) {
    // Saturday -> observed on Friday
    return new Date(date.getTime() - 24 * 60 * 60 * 1000);
  } else if (day === 0) {
    // Sunday -> observed on Monday
    return new Date(date.getTime() + 24 * 60 * 60 * 1000);
  }
  return date;
};

/**
 * Count business days between two dates (inclusive of both ends).
 * @param startDate
 * @param endDate
 * @param excludeDates - optional Set<'YYYY-MM-DD'> of additional days to skip
 *                       (e.g. firm holidays and/or out-of-office days). Days
 *                       already excluded by isBusinessDay (weekends, federal
 *                       holidays) are skipped regardless.
 */
export const countBusinessDays = (startDate, endDate, excludeDates = null) => {
  let count = 0;
  const current = new Date(startDate);
  current.setHours(0, 0, 0, 0);

  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);

  while (current <= end) {
    if (isBusinessDay(current) && (!excludeDates || !excludeDates.has(toDateKey(current)))) {
      count++;
    }
    current.setDate(current.getDate() + 1);
  }

  return count;
};

/**
 * Get business days info for a month
 * Returns { total: number, elapsed: number, remaining: number }
 */
export const getMonthBusinessDays = (year, month, asOfDate = null) => {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // Last day of month

  const total = countBusinessDays(monthStart, monthEnd);

  if (!asOfDate) {
    return { total, elapsed: total, remaining: 0 };
  }

  const asOf = new Date(asOfDate);
  asOf.setHours(23, 59, 59, 999);

  // If asOfDate is before the month starts, no days elapsed
  if (asOf < monthStart) {
    return { total, elapsed: 0, remaining: total };
  }

  // If asOfDate is after the month ends, all days elapsed
  if (asOf > monthEnd) {
    return { total, elapsed: total, remaining: 0 };
  }

  // Count business days from month start to asOfDate
  const elapsed = countBusinessDays(monthStart, asOf);
  const remaining = total - elapsed;

  return { total, elapsed, remaining };
};

/**
 * Capacity-model pro-rate fraction for a single month.
 *
 * Returns the fraction of a month's target an attorney is expected to hit over
 * the window [effectiveStart, effectiveEnd], reducing the target for the
 * attorney's own out-of-office (OOO) days while treating firm holidays as
 * already baked into the monthly target:
 *
 *   denominator = business days in the WHOLE month, excluding holidays only
 *                 (the capacity the monthly target assumes — OOO is NOT
 *                  subtracted here)
 *   numerator   = business days within [effectiveStart, effectiveEnd], excluding
 *                 holidays AND the attorney's OOO
 *   fraction    = numerator / denominator   (0 when the month has no capacity)
 *
 * Because holidays appear in both numerator and denominator, a full clean month
 * yields exactly 1 (full target); holidays only depress intra-month pace. OOO is
 * subtracted from the numerator only, so it reduces the target for ANY period —
 * in-progress or completed. A month entirely covered by OOO yields 0.
 *
 * Note: isBusinessDay already excludes weekends and US federal holidays, so the
 * holidaySet only needs to carry additional (non-federal) firm holidays.
 *
 * @param {number} year
 * @param {number} month - 1-indexed month
 * @param {Date} effectiveStart - window start, clamped to the month/range
 * @param {Date} effectiveEnd   - window end, clamped to the month/range
 *                                (e.g. "today" for the in-progress current month)
 * @param {Set<string>} [holidaySet] - 'YYYY-MM-DD' firm holidays
 * @param {Set<string>} [oooSet]     - 'YYYY-MM-DD' attorney out-of-office days
 * @returns {{ fraction: number, baselineMonthDays: number, availableDays: number }}
 */
export const getMonthProRateFraction = (
  year,
  month,
  effectiveStart,
  effectiveEnd,
  holidaySet = null,
  oooSet = null,
) => {
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 0); // last day of month

  // Denominator: full-month capacity (holidays excluded, OOO NOT excluded).
  const baselineMonthDays = countBusinessDays(monthStart, monthEnd, holidaySet);

  // Numerator: available days in the effective window (holidays AND OOO excluded).
  let excludeForPeriod = holidaySet;
  if (oooSet && oooSet.size > 0) {
    excludeForPeriod = new Set(holidaySet || []);
    oooSet.forEach((d) => excludeForPeriod.add(d));
  }
  const availableDays = countBusinessDays(effectiveStart, effectiveEnd, excludeForPeriod);

  const fraction = baselineMonthDays > 0 ? availableDays / baselineMonthDays : 0;

  return { fraction, baselineMonthDays, availableDays };
};

// Get date range label for display
export const getDateRangeLabel = (dateRange, customDateStart, customDateEnd) => {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  const formatDateRange = (start, end) => {
    const startStr = `${monthNames[start.getMonth()]} ${start.getDate()}`;
    const endStr = `${monthNames[end.getMonth()]} ${end.getDate()}, ${end.getFullYear()}`;
    return `${startStr} - ${endStr}`;
  };

  if (dateRange === 'all-time') {
    return 'All Time';
  }

  const now = getPSTDate();
  let startDate;
  let endDate = new Date(now);

  switch (dateRange) {
    case 'current-week': {
      const dayOfWeek = now.getDay();
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
      return `Current Week (${formatDateRange(startDate, endDate)})`;
    }
    case 'last-week': {
      const dow = now.getDay();
      const dSinceMonday = (dow + 6) % 7;
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dSinceMonday);
      startDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 7);
      endDate = new Date(thisMonday.getFullYear(), thisMonday.getMonth(), thisMonday.getDate() - 1);
      return `Last Week (${formatDateRange(startDate, endDate)})`;
    }
    case 'current-month':
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      return `Current Month (${formatDateRange(startDate, endDate)})`;
    case 'last-month':
      startDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      endDate = new Date(now.getFullYear(), now.getMonth(), 0);
      return `Last Month (${formatDateRange(startDate, endDate)})`;
    case 'trailing-60':
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 60);
      return `Trailing 60 Days (${formatDateRange(startDate, endDate)})`;
    case 'custom':
      if (customDateStart && customDateEnd) {
        const [startYear, startMonth, startDay] = customDateStart.split('-').map(Number);
        const [endYear, endMonth, endDay] = customDateEnd.split('-').map(Number);
        const start = `${monthNames[startMonth - 1]} ${startDay}`;
        const end = `${monthNames[endMonth - 1]} ${endDay}, ${endYear}`;
        return `${start} - ${end}`;
      }
      return 'Custom Range';
    default:
      return 'All Time';
  }
};

// Calculate date range boundaries
export const calculateDateRange = (dateRange, customDateStart, customDateEnd, allEntries = []) => {
  const now = getPSTDate();
  let startDate;
  let endDate = new Date(now);

  switch (dateRange) {
    case 'all-time':
      if (allEntries && allEntries.length > 0) {
        const dates = allEntries.map(e => getEntryDate(e)).filter(d => d);
        if (dates.length > 0) {
          startDate = new Date(Math.min(...dates.map(d => d.getTime())));
        } else {
          startDate = new Date(now.getFullYear(), now.getMonth(), 1);
        }
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      break;
    case 'current-week': {
      const dayOfWeek = now.getDay();
      const daysSinceMonday = (dayOfWeek + 6) % 7;
      startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday, 0, 0, 0, 0);
      break;
    }
    case 'last-week': {
      const dow = now.getDay();
      const dSinceMonday = (dow + 6) % 7;
      const thisMonday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - dSinceMonday, 0, 0, 0, 0);
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
        startDate = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        endDate = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
      } else {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
      }
      break;
    default:
      startDate = new Date(now.getFullYear(), now.getMonth(), 1);
  }

  return { startDate, endDate };
};

// Calculate client activity date range
export const calculateClientActivityDateRange = (period, customStart, customEnd) => {
  const now = getPSTDate();
  let startDate = null;
  let endDate = now;
  
  switch (period) {
    case '2-weeks':
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 14);
      break;
    case '1-month':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      break;
    case '2-months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 2);
      break;
    case '3-months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 3);
      break;
    case '6-months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 6);
      break;
    case '9-months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 9);
      break;
    case '12-months':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 1);
      break;
    case '18-months':
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 18);
      break;
    case '24-months':
      startDate = new Date(now);
      startDate.setFullYear(startDate.getFullYear() - 2);
      break;
    case 'custom':
      if (customStart) {
        startDate = new Date(customStart + 'T00:00:00');
      }
      if (customEnd) {
        endDate = new Date(customEnd + 'T23:59:59');
      }
      break;
    case 'all-time':
    default:
      startDate = null;
      break;
  }
  
  return { startDate, endDate };
};