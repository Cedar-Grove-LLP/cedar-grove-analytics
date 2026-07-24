// Pure grid-state -> users/{userId}.targets[] payload builder for the admin
// Utilization Targets tab (src/components/admin/UtilizationTargetsTab.jsx).
//
// Grid state shape (one user's matrix): { [monthIdx 0-11]: { client: string, ops: string } }
// where cell values are raw <input type="number"> strings ('' when blank).
//
// BEHAVIOR NOTES (current, intentional pins — see tests/targets-payload.test.mjs):
// - Saving rewrites the ENTIRE targets array for the selected year: all 12
//   months are always emitted, whether or not they were shown in the grid or
//   edited. Any month whose grid cell is blank/missing becomes a 0-hour
//   target, silently overwriting whatever was stored for that month.
// - `earnings` is always reset to 0 for the selected year's entries.
// - Entries for OTHER years are preserved untouched (strict !== on `year`,
//   so a string-typed year never matches a number year and is kept).

const MONTH_LONG = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/**
 * Build the 12 target entries for one year from a user's grid matrix.
 * Blank, missing, or non-numeric cells coerce to 0 (parseFloat(...) || 0).
 */
export function buildYearTargetEntries(userMatrix, year) {
  return MONTH_LONG.map((month, idx) => {
    const cell = (userMatrix && userMatrix[idx]) || {};
    const billable = parseFloat(cell.client) || 0;
    const ops = parseFloat(cell.ops) || 0;
    return {
      month,
      year,
      billableHours: billable,
      opsHours: ops,
      totalHours: billable + ops,
      earnings: 0,
    };
  });
}

/**
 * Full targets-array payload for a save: existing entries for other years
 * (in their original order), followed by the freshly rebuilt Jan–Dec entries
 * for the selected year. Every same-year entry in `existingTargets` is
 * discarded and replaced.
 */
export function buildTargetsPayload(existingTargets, userMatrix, year) {
  const otherYears = (existingTargets || []).filter(t => t.year !== year);
  return [...otherYears, ...buildYearTargetEntries(userMatrix, year)];
}
