/**
 * Firm-wide period metric aggregation.
 *
 * Sums a field from monthlyMetrics only when the requested date range
 * cleanly covers every calendar month it touches (with an exception for the
 * current month-to-date). Returns null when data is missing or the range is
 * partial so callers can fall back to a separately derived figure.
 *
 * Pure module — no React/Firebase imports; `now` is injected for deterministic
 * current-month handling.
 */

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export function computePeriodMetric({ monthlyMetrics, field, dateRange, startDate, endDate, now }) {
  if (!monthlyMetrics || monthlyMetrics.length === 0) return null;

  if (dateRange === 'all-time') {
    const total = monthlyMetrics.reduce((acc, m) => acc + (m[field] || 0), 0);
    return total > 0 ? total : null;
  }

  if (!startDate || !endDate) return null;

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
      e => e.year === year && e.month === MONTH_NAMES[monthIndex]
    );
    // Every in-range month must have a synced value, otherwise the sum would
    // understate the period — fall back instead of reporting a partial figure.
    if (!entry || typeof entry[field] !== 'number') return null;
    sum += entry[field];
  }

  return sum;
}
