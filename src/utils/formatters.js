import { MONTH_NAMES_ABBR } from './constants';

// Format currency - omit .00 decimals
export const formatCurrency = (amount) => {
  const rounded = Math.round(amount * 100) / 100;
  if (rounded === Math.floor(rounded)) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(rounded);
  }
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

// Format hours - round to .1, omit .0 decimals, thousands separators (1,234.5)
export const formatHours = (hours) => {
  const rounded = Math.round(hours * 10) / 10;
  if (rounded === Math.floor(rounded)) {
    return Math.floor(rounded).toLocaleString('en-US');
  }
  return rounded.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
};

// Build a human phrase for the OOO/holiday context behind a pro-rated target,
// e.g. "3 days out of office and 1 firm holiday". Returns '' when both are 0, so
// callers can gate the whole sentence on a truthy result. Used by the attorney
// detail OOO note and the Overview pace-card tooltip.
export const formatTimeOffContext = (oooDays = 0, holidayDays = 0) => {
  const parts = [];
  if (oooDays > 0) parts.push(`${oooDays} day${oooDays === 1 ? '' : 's'} out of office`);
  if (holidayDays > 0) parts.push(`${holidayDays} firm holiday${holidayDays === 1 ? '' : 's'}`);
  return parts.join(' and ');
};

// Format date from various formats (Firestore Timestamp, string, Date)
export const formatDate = (date) => {
  if (!date) return 'No date';
  // Handle Firestore Timestamp
  if (date && typeof date === 'object' && date.seconds) {
    return new Date(date.seconds * 1000).toLocaleDateString();
  }
  // Handle string dates
  if (typeof date === 'string') {
    return date;
  }
  // Handle Date objects
  if (date instanceof Date) {
    return date.toLocaleDateString();
  }
  return 'No date';
};

// Format a date as "Mon D, YYYY" (e.g. "Jun 11, 2026"). Accepts an ISO string,
// a Date, or epoch-millis. Returns '' for null / invalid input so callers can
// guard the surrounding text.
export const formatShortDate = (input) => {
  if (input == null) return '';
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return '';
  return `${MONTH_NAMES_ABBR[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
};
