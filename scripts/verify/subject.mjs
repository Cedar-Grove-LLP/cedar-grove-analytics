/**
 * Small shared helpers the live collectors reuse to build Divergence
 * subjects and legs without repeating the shape by hand. Pure — no IO, no
 * network — but lives under scripts/ (not src/utils/verify/) because it is
 * collector-specific glue (workbook -> subject mapping, sheet-grid summing),
 * not app logic the pure core owns.
 *
 * See BUILD-SPEC-verify.md's "INTEGRATION SEAM" appendix: subject.attorney
 * (full name, e.g. 'Colin van Loon') is the real Firestore users/{docId}
 * doc id and is read by ruleModelled/matchModelledSource; subject.userId
 * (kebab slug, e.g. 'colin-van-loon') is read by the knownDivergences
 * ledger match. A collector that only sets one silently loses the other
 * rule's classification.
 */

import { LEG_STATE } from '../../src/utils/verify/divergence.mjs';

/**
 * Build the shared `subject` fields for a workbook (from workbooks.mjs) at
 * a given month. `attorney` is the workbook's full-name field — the actual
 * Firestore users/{docId} doc id, NOT the userId slug.
 */
export function subjectFor(workbook, monthKey) {
  return {
    attorney: workbook.attorney,
    userId: workbook.userId,
    monthKey,
    workbookKey: workbook.key,
  };
}

/** A leg whose value was successfully read. */
export function presentLeg(value, meta = {}) {
  return { state: LEG_STATE.PRESENT, value, meta };
}

/** A leg whose source exists but the key is missing — not the same as zero. */
export function absentLeg(meta = {}) {
  return { state: LEG_STATE.ABSENT, value: null, meta };
}

/** A leg we could not look at (403, cap hit, unrecognized layout). Always loud. */
export function notCheckedLeg(reason, httpStatus) {
  return { state: LEG_STATE.NOT_CHECKED, value: null, meta: { reason, httpStatus } };
}

/** A leg with no applicable source by design (silent — never confused with NOT_CHECKED). */
export function naLeg() {
  return { state: LEG_STATE.NOT_APPLICABLE, value: null, meta: {} };
}

/** Round to 2 decimal places, avoiding float noise (e.g. 30392.999999 -> 30393). */
export function round2(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Sum a resolved column below the header row. Non-numeric / blank cells
 * contribute 0. `colIndex` is 0-based, as returned by resolveLayout().
 */
export function sumColumn(grid, headerRowIndex, colIndex) {
  if (colIndex == null || colIndex < 0) return 0;
  let sum = 0;
  for (let i = headerRowIndex + 1; i < grid.length; i += 1) {
    const cell = grid[i]?.[colIndex];
    if (typeof cell === 'number') sum += cell;
  }
  return round2(sum);
}
