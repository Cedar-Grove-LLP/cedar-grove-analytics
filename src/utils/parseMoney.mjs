/**
 * Single shared parser for money fields synced from Google Sheets, which may
 * carry '$' and ',' formatting. Hours fields deliberately do NOT use this
 * parser — keep using plain parseFloat for those.
 *
 * @param {unknown} value
 * @returns {number}
 */
export function parseMoney(value) {
  const normalized = typeof value === 'string' ? value.replace(/[$,]/g, '') : value;
  const parsed = parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}
