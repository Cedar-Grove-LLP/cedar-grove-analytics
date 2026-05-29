// Client "ideal-fit" rating — Ideal / Non-Ideal / TBD.
//
// Cedar Grove tags each client's fit in their source spreadsheet (column E),
// which is synced into the `clients/all` Firestore doc. The exact synced field
// name and value shape aren't guaranteed (CLAUDE.md documents a boolean
// `isIdeal`, but the spreadsheet column is three-state text), so we read
// DEFENSIVELY across the likely field names and normalize whatever is present
// to one of: 'ideal' | 'non-ideal' | 'tbd' | null (untagged / no data).
//
// If the real synced field turns out to differ, add its name to RATING_FIELDS
// (or adjust normalizeRatingString) — no other code needs to change.

// Candidate field names, checked in order. String-valued fields are listed
// before the documented boolean `isIdeal` so a real three-state value always
// wins over a lossy boolean.
const RATING_FIELDS = [
  'idealRating',
  'idealStatus',
  'idealClient',
  'clientRating',
  'idealFit',
  'idealTag',
  'ideal',
  'isIdeal',
];

export const RATING_LABEL = {
  ideal: 'Ideal',
  'non-ideal': 'Non-Ideal',
  tbd: 'TBD',
};

// Sort/group order — ideal clients first, untagged last.
export const RATING_RANK = {
  ideal: 0,
  'non-ideal': 1,
  tbd: 2,
};

function normalizeRatingString(value) {
  const v = String(value).trim().toLowerCase();
  if (!v) return null;
  if (
    v === 'tbd' ||
    v === 'to be determined' ||
    v === 'undetermined' ||
    v === 'unknown' ||
    v === 'pending'
  ) {
    return 'tbd';
  }
  // Must test "non-ideal" BEFORE "ideal" since the former contains the latter.
  if ((v.includes('non') && v.includes('ideal')) || v === 'not ideal' || v === 'not-ideal') {
    return 'non-ideal';
  }
  if (v.includes('ideal')) return 'ideal';
  return null;
}

/**
 * Resolve a client's ideal-fit rating from whatever the sync wrote.
 * @returns {'ideal'|'non-ideal'|'tbd'|null}
 */
export function getClientRating(client) {
  if (!client) return null;

  for (const field of RATING_FIELDS) {
    const raw = client[field];
    if (raw === null || raw === undefined || raw === '') continue;

    if (typeof raw === 'boolean') {
      // A boolean can only express "ideal" vs. "not flagged". `false` is
      // ambiguous (non-ideal vs. not-yet-rated), so don't guess — leave it
      // untagged rather than mislabel a client as Non-Ideal.
      return raw ? 'ideal' : null;
    }

    const normalized = normalizeRatingString(raw);
    if (normalized) return normalized;
    // Unrecognized non-empty value — fall through to the next candidate field.
  }

  return null;
}

/** Tailwind badge classes for a rating, matching the app's status-pill palette. */
export function getClientRatingBadge(rating) {
  switch (rating) {
    case 'ideal':
      return 'bg-status-success-light text-status-success-text';
    case 'non-ideal':
      return 'bg-status-danger-light text-status-danger-text';
    case 'tbd':
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
