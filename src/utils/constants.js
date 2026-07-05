// Explicit '.js' extension required: Node's ESM resolver (unlike bundlers)
// does no extension-guessing, so omitting it here breaks any plain
// `node --test`/`node -e` import of this file (this module IS meant to be
// Node-importable — see MONTH_NAMES_FULL/ABBR below).
export { CHART_COLORS } from './colors.js';

export const MONTHS = [
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
];

// Canonical month-name arrays, derived from MONTHS above. commitTimeline.mjs
// (the Tech Team feature) imports these FROM here and re-exports them for its
// own call sites — this file is the single source of truth for app-wide date
// labels, not the other way around, since MONTHS/DATE_RANGE_OPTIONS/etc.
// below are used throughout the app, not just by the Tech Team tab.
export const MONTH_NAMES_FULL = MONTHS.map((m) => m.label);
export const MONTH_NAMES_ABBR = MONTH_NAMES_FULL.map((m) => m.slice(0, 3));

// Default repository for the Tech Team commit-history view. Overridable
// server-side via the GITHUB_REPO env var (see api/commit-history/route.js).
export const DEFAULT_GITHUB_REPO = 'nmbroome/cedar-grove-analytics';

export const DATE_RANGE_OPTIONS = [
  { value: 'all-time', label: 'All Time' },
  { value: 'current-week', label: 'Current Week' },
  { value: 'last-week', label: 'Last Week' },
  { value: 'current-month', label: 'Current Month' },
  { value: 'last-month', label: 'Last Month' },
  { value: 'trailing-60', label: 'Trailing 60 Days' },
];

export const CLIENT_ACTIVITY_PERIODS = [
  { value: '2-weeks', label: 'Last 2 Weeks' },
  { value: '1-month', label: 'Last 1 Month' },
  { value: '2-months', label: 'Last 2 Months' },
  { value: '3-months', label: 'Last 3 Months' },
  { value: '6-months', label: 'Last 6 Months' },
  { value: '9-months', label: 'Last 9 Months' },
  { value: '12-months', label: 'Last 12 Months' },
  { value: '18-months', label: 'Last 18 Months' },
  { value: '24-months', label: 'Last 24 Months' },
  { value: 'custom', label: 'Custom Range' },
  { value: 'all-time', label: 'All Time' },
];
