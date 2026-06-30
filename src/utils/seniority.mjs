/**
 * Firm staff seniority order — the single source of truth for how staff /
 * attorneys are listed everywhere in the dashboard (filter dropdowns, tables,
 * charts, admin rosters, menus). Ordered most- to least-tenured. Update THIS
 * list (never the individual call sites) when tenure changes or people join /
 * leave.
 *
 * The (W2)/(1099)/Partner notes are documentation only — ordering is purely
 * positional in this array, so it intentionally interleaves employment types.
 *
 * Pure, Node-importable module (no React/Firebase imports) — covered by
 * tests/seniority.test.mjs. Matching is tolerant of capitalisation, extra
 * whitespace, and first-name nicknames or middle names (e.g. "Nicholas Agate"
 * ↔ "Nick Agate", "Colin van Loon" ↔ "Colin Van Loon") by falling back to a
 * unique-surname match.
 */
export const SENIORITY_ORDER = [
  'Sam McClure',      // Partner
  'Colin Van Loon',   // Partner
  'Michael Ohta',     // W2
  'Molly Manning',    // W2
  'Michael Levin',    // W2
  'Valery Uscanga',   // 1099
  'David Popkin',     // 1099
  'Nick Agate',       // 1099
  'Paige Wilson',     // 1099
  'Martyna Skrodzka', // 1099
];

// Lowercase, trim, and collapse internal whitespace so capitalisation and
// stray spaces never change a name's rank.
const normalizeName = (name) =>
  String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');

// Last whitespace-delimited token of an already-normalized name. Multi-word
// surnames ("van loon") collapse to their final token ("loon"), which keeps the
// fallback robust to middle names and given-name nicknames.
const surnameKey = (normalized) => {
  const parts = normalized.split(' ').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '';
};

// normalized full name -> rank
const RANK_BY_FULL_NAME = new Map(
  SENIORITY_ORDER.map((name, i) => [normalizeName(name), i]),
);

// surname -> rank, but ONLY for surnames that are unique within the roster, so
// a nickname/middle-name variant still resolves while any genuine ambiguity
// falls through to "unranked" rather than mis-ordering someone.
const RANK_BY_SURNAME = (() => {
  const counts = new Map();
  SENIORITY_ORDER.forEach((name) => {
    const key = surnameKey(normalizeName(name));
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const map = new Map();
  SENIORITY_ORDER.forEach((name, i) => {
    const key = surnameKey(normalizeName(name));
    if (counts.get(key) === 1) map.set(key, i);
  });
  return map;
})();

/**
 * Seniority rank of a staff member (0 = most senior), or null if the name is
 * not on the roster. Tolerant of capitalisation, whitespace, and nickname /
 * middle-name variants (via unique-surname fallback).
 */
export function getSeniorityRank(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;
  if (RANK_BY_FULL_NAME.has(normalized)) return RANK_BY_FULL_NAME.get(normalized);
  const surname = surnameKey(normalized);
  if (surname && RANK_BY_SURNAME.has(surname)) return RANK_BY_SURNAME.get(surname);
  return null;
}

// Names not on the roster sort after everyone ranked, then alphabetically among
// themselves, so ordering is always deterministic.
const UNRANKED = Number.MAX_SAFE_INTEGER;

/**
 * Comparator for two staff names by seniority. Known staff order by tenure;
 * anyone off the roster sorts to the end, alphabetically (case-insensitive).
 * Suitable to pass straight to Array.prototype.sort.
 */
export function compareBySeniority(a, b) {
  const ra = getSeniorityRank(a);
  const rb = getSeniorityRank(b);
  const na = ra == null ? UNRANKED : ra;
  const nb = rb == null ? UNRANKED : rb;
  if (na !== nb) return na - nb;
  return normalizeName(a).localeCompare(normalizeName(b));
}

/**
 * Return a NEW array of `items` ordered by seniority (does not mutate input).
 * `getName` extracts each item's display name; it defaults to identity so an
 * array of name strings can be sorted directly.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => string} [getName]
 * @returns {T[]}
 */
export function sortBySeniority(items, getName) {
  const get = typeof getName === 'function' ? getName : (x) => x;
  return [...(items || [])].sort((a, b) => compareBySeniority(get(a), get(b)));
}
