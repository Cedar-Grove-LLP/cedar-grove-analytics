/**
 * Maps a billing category string to a hiring-focused practice area bucket,
 * for the admin "Practice Composition" tab.
 *
 * billingCategory is free text typed into the timesheet (no fixed enum), so
 * classification is a keyword match rather than a lookup table.
 *
 * Pure module — no React/Firebase imports.
 */

export const PRACTICE_AREAS = ['Corporate', 'Commercial', 'M&A', 'Non-profit'];

const MA_PATTERNS = [/\bm\s*&\s*a\b/i, /mergers?\s*(&|and)\s*acquisitions?/i];
const NONPROFIT_PATTERNS = [/non[\s-]?profit/i];
const COMMERCIAL_PATTERNS = [
  /red[\s-]?line/i,
  /new\s+draft/i,
  /\bip\b/i,
  /intellectual\s+property/i,
  /trademark/i,
  /copyright/i,
  /\bpatent/i,
];

const matchesAny = (text, patterns) => patterns.some((pattern) => pattern.test(text));

/**
 * Classify a billing category string into one of PRACTICE_AREAS:
 * M&A (category mentions M&A / mergers & acquisitions), Non-profit (category
 * mentions non-profit), Commercial (redline review, new draft, or IP/trademark/
 * patent matters), else Corporate.
 */
export const classifyPracticeArea = (billingCategory) => {
  const text = (billingCategory || '').trim();
  if (!text) return 'Corporate';
  if (matchesAny(text, MA_PATTERNS)) return 'M&A';
  if (matchesAny(text, NONPROFIT_PATTERNS)) return 'Non-profit';
  if (matchesAny(text, COMMERCIAL_PATTERNS)) return 'Commercial';
  return 'Corporate';
};

/**
 * Rolls up per-category stats ({ category, totalHours, totalEarnings, matterCount })
 * into per-practice-area totals across all of PRACTICE_AREAS (zero-filled when a
 * bucket has no matching categories), plus each bucket's share of the grand total
 * hours and its count of distinct billing categories (sub-areas).
 */
export const rollUpByPracticeArea = (categoryStats) => {
  const totals = {};
  PRACTICE_AREAS.forEach((area) => {
    totals[area] = { totalHours: 0, totalEarnings: 0, matterCount: 0, categories: new Set() };
  });

  (categoryStats || []).forEach((stat) => {
    const area = classifyPracticeArea(stat.category);
    totals[area].totalHours += stat.totalHours || 0;
    totals[area].totalEarnings += stat.totalEarnings || 0;
    totals[area].matterCount += stat.matterCount || 0;
    totals[area].categories.add(stat.category);
  });

  const grandTotalHours = PRACTICE_AREAS.reduce((sum, area) => sum + totals[area].totalHours, 0);

  return PRACTICE_AREAS.map((area) => ({
    area,
    totalHours: totals[area].totalHours,
    totalEarnings: totals[area].totalEarnings,
    matterCount: totals[area].matterCount,
    subAreaCount: totals[area].categories.size,
    percentage: grandTotalHours > 0 ? (totals[area].totalHours / grandTotalHours) * 100 : 0,
  }));
};
