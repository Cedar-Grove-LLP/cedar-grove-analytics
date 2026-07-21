/**
 * The divergence record contract — the one shape every verify/* collector
 * produces, every classifier rule consumes and mutates, and the report
 * renders. Nothing else in src/utils/verify or scripts/verify defines this
 * shape; see BUILD-SPEC-verify.md §4 for the full annotated example
 * (the Michael Ohta 2025-09 record).
 *
 * Pure module — no React/Firebase imports, no network, no filesystem.
 * Node-importable and covered by tests/verify-divergence.test.mjs.
 */

/** The five independent legs a number can be checked against. */
export const LEG = Object.freeze({
  SHEET: 'SHEET',
  FS_TOTALS: 'FS_TOTALS',
  FS_ENTRIES: 'FS_ENTRIES',
  SITE: 'SITE',
  ORACLE: 'ORACLE',
});

// Canonical order — drives agreementSignature's within-group ordering and
// the tie-break when two agreement groups are the same size.
const LEG_ORDER = [LEG.SHEET, LEG.FS_TOTALS, LEG.FS_ENTRIES, LEG.SITE, LEG.ORACLE];

/**
 * A leg's read state. NOT_CHECKED and NOT_APPLICABLE both mean "no value to
 * compare" but for opposite reasons and must never be conflated:
 *   PRESENT        — a value was read.
 *   ABSENT         — the source exists but the key is missing (schema gap),
 *                     NOT the same thing as the value being zero.
 *   NOT_CHECKED    — we could not look (403, cap hit, unknown layout) — LOUD,
 *                     always routes to BLIND_SPOT via ruleCoverage.
 *   NOT_APPLICABLE — no such source exists by design (no 2024 workbook; the
 *                     ORACLE leg on a non-earnings metric) — silent.
 */
export const LEG_STATE = Object.freeze({
  PRESENT: 'PRESENT',
  ABSENT: 'ABSENT',
  NOT_CHECKED: 'NOT_CHECKED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
});

/** The terminal classification a divergence can land on. See §4 taxonomy table. */
export const CLASS = Object.freeze({
  OK: 'OK',
  CROSS_SYSTEM_OK: 'CROSS_SYSTEM_OK',
  MODELLED: 'MODELLED',
  STALE_SYNC: 'STALE_SYNC',
  SCHEMA_GAP: 'SCHEMA_GAP',
  EXPECTED_WRITEBACK: 'EXPECTED_WRITEBACK',
  BLIND_SPOT: 'BLIND_SPOT',
  DEFECT: 'DEFECT',
  UNKNOWN: 'UNKNOWN',
});

/** Two severities that matter, no escape hatch — see BUILD-SPEC §2. */
export const SEVERITY = Object.freeze({
  ok: 'ok',
  info: 'info',
  blind_spot: 'blind_spot',
  defect: 'defect',
});

const EMPTY_LEG = Object.freeze({ state: LEG_STATE.NOT_APPLICABLE, value: null, meta: Object.freeze({}) });

/**
 * Build a Divergence record. `legs` need only carry the LEG names the
 * collector actually checked — any of the five omitted is filled in as
 * NOT_APPLICABLE so every record has the full, uniform five-leg shape
 * downstream code can rely on. `signature` is derived, `classification`
 * starts null (set later by classify()).
 */
export function makeDivergence({ id, domain, subject, metric, legs }) {
  const filledLegs = {};
  for (const legName of LEG_ORDER) {
    filledLegs[legName] = legs?.[legName] ?? EMPTY_LEG;
  }

  return {
    id,
    domain,
    subject,
    metric,
    legs: filledLegs,
    signature: agreementSignature(filledLegs),
    classification: null,
  };
}

/**
 * Tri-state-aware equality for exactly two values, immune to the `> 0`
 * guard bug (src/context/FirestoreDataContext.js:219,229,280,355 and
 * scripts/lib/audit-helpers.mjs:123,126,130): those guards skip the check
 * entirely when one side is 0, so a real regression like (0, 340) never
 * gets compared. Here 0 is a value like any other — only genuinely absent
 * (undefined/null) values get the ABSENT treatment.
 *
 *   BOTH_PRESENT_EQUAL  — both present, |a-b| <= eps            equal: true
 *   BOTH_PRESENT_DIFFER — both present, |a-b| >  eps             equal: false
 *   BOTH_ZERO           — both present and === 0 exactly         equal: true  (silent)
 *   ONE_ABSENT          — exactly one side is undefined/null     equal: null  (never "equal")
 *   BOTH_ABSENT         — both sides undefined/null              equal: null
 */
export function zeroAwareCompare(a, b, eps = 0.02) {
  const aAbsent = a === undefined || a === null;
  const bAbsent = b === undefined || b === null;

  if (aAbsent && bAbsent) return { equal: null, state: 'BOTH_ABSENT' };
  if (aAbsent || bAbsent) return { equal: null, state: 'ONE_ABSENT' };
  if (a === 0 && b === 0) return { equal: true, state: 'BOTH_ZERO' };

  const equal = Math.abs(a - b) <= eps;
  return { equal, state: equal ? 'BOTH_PRESENT_EQUAL' : 'BOTH_PRESENT_DIFFER' };
}

/**
 * Render the agreement pattern across every PRESENT leg, e.g.
 * 'FS_TOTALS=FS_ENTRIES=ORACLE≠SHEET'. Legs in states other than PRESENT
 * (ABSENT / NOT_CHECKED / NOT_APPLICABLE) are excluded — this is a value
 * agreement signature, not a coverage report.
 *
 * Legs are bucketed into equivalence groups (pairwise zeroAwareCompare
 * equal, using the first PRESENT leg encountered in canonical order —
 * SHEET, FS_TOTALS, FS_ENTRIES, SITE, ORACLE — as each group's
 * representative). Groups are then ordered largest-first (the "what does
 * everyone agree on" reading), ties broken by which group formed earliest
 * in canonical order — which is simply creation order, since groups are
 * created in canonical-order pass. Members within a group print in
 * canonical order, joined by '='; groups join by '≠'.
 */
export function agreementSignature(legs, eps = 0.02) {
  const present = LEG_ORDER.filter((name) => legs[name]?.state === LEG_STATE.PRESENT);
  if (present.length === 0) return '';

  const groups = []; // [{ representative: value, members: [legName,...] }]
  for (const name of present) {
    const value = legs[name].value;
    const group = groups.find((g) => zeroAwareCompare(g.representative, value, eps).equal === true);
    if (group) {
      group.members.push(name);
    } else {
      groups.push({ representative: value, members: [name] });
    }
  }

  groups.sort((g1, g2) => g2.members.length - g1.members.length); // stable: ties keep creation order

  return groups.map((g) => g.members.join('=')).join('≠');
}
