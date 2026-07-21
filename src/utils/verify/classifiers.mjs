/**
 * The ordered classifier chain — turns a Divergence's legs into exactly one
 * verdict. `classify()` walks CHAIN in order; the first rule that returns a
 * non-null classification wins; `ruleUnknown` always returns one, so
 * `classify()` never throws in practice (the throw below is a structural
 * guard against someone breaking that invariant, not a real code path).
 *
 * ORDER IS LOAD-BEARING — see BUILD-SPEC-verify.md §5:
 *   - ruleModelled precedes ruleCrossSystem/ruleAgree: Firestore matches
 *     McClure's 2025 H1 estimate-column tabs EXACTLY, and would otherwise
 *     silently classify OK, hiding the 27.2%/38.2% modelled-data KPI.
 *   - ruleInternalConsistency precedes ruleStaleness: an internally
 *     INCONSISTENT doc (FS_TOTALS != FS_ENTRIES) is a misparse, never
 *     staleness, regardless of what SHEET says.
 *   - ruleUnknown is last and always claims — it is the alarm.
 *
 * Each rule reads only `divergence.legs` / `.metric` / `.domain` /
 * `.subject` — never `.classification` (that doesn't exist yet). Each
 * returns `{ class, severity, ruleId, reason, evidence }` or `null`
 * ("I don't apply, try the next rule"). `classify()` then attaches
 * `baselineId` / `inBand` / `isNew` via the knownDivergences.mjs ledger —
 * that step is uniform across every rule and lives here, not per-rule.
 *
 * Pure module — no React/Firebase imports, no network, no filesystem.
 * Node-importable and covered by tests/verify-classifiers.test.mjs.
 */

import { LEG_STATE, CLASS, SEVERITY, zeroAwareCompare } from './divergence.mjs';
import { classifyEarningsLabel } from './currency.mjs';
import { matchModelledSource } from './modelledSources.mjs';
import { EXPECTED_BLIND_SPOTS } from './workbooks.mjs';
import { KNOWN_DIVERGENCES, matchBaseline } from './knownDivergences.mjs';

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Build the bare classification shape every rule returns (pre-baseline). */
function verdict(class_, severity, ruleId, reason, evidence) {
  return { class: class_, severity, ruleId, reason, evidence };
}

// --------------------------------------------------------------- 1. coverage

/**
 * Anything we could not look at — a 403/cap-hit leg (`NOT_CHECKED`), an
 * explicit `rangeCap` metric, or a SHEET leg whose layout resolver returned
 * `signatureId: null` — becomes BLIND_SPOT, never silently absent. Does
 * NOT claim `NOT_APPLICABLE` legs (no 2024 workbook exists by design) —
 * that is ruleModelled's case, not a coverage gap.
 */
export function ruleCoverage(d) {
  const notCheckedLegs = Object.values(d.legs).filter((leg) => leg.state === LEG_STATE.NOT_CHECKED);
  const unrecognizedLayout = d.legs.SHEET.state === LEG_STATE.PRESENT && d.legs.SHEET.meta?.signatureId === null;
  const isRangeCap = d.metric === 'rangeCap';
  if (notCheckedLegs.length === 0 && !unrecognizedLayout && !isRangeCap) return null;

  const workbookKey = d.subject?.workbookKey ?? null;
  const allowlisted = EXPECTED_BLIND_SPOTS.some((b) => b.workbookKey === workbookKey);
  const sample = notCheckedLegs[0];
  const reason =
    sample?.meta?.reason ??
    (isRangeCap
      ? 'range cap hit — sheet may hold more rows than requested'
      : 'unrecognized sheet layout — resolveLayout returned signatureId: null');

  return verdict(CLASS.BLIND_SPOT, SEVERITY.blind_spot, 'coverage', reason, {
    workbookKey,
    reason,
    httpStatus: sample?.meta?.httpStatus ?? null,
    metricsAffected: notCheckedLegs.length || 1,
    allowlisted,
  });
}

// --------------------------------------------------------------- 2. modelled

/**
 * Never-timekept periods (2024 lumped import, McClure 2025 H1 estimate
 * matrix) — MODELLED, not OK, even when every leg agrees exactly, so the
 * data-quality KPI counts them instead of them vanishing into "passing".
 */
export function ruleModelled(d) {
  const hit = matchModelledSource({ attorney: d.subject?.attorney, monthKey: d.subject?.monthKey, domain: d.domain });
  if (!hit) return null;

  const hours = d.legs.SHEET?.meta?.hours ?? d.legs.FS_ENTRIES?.meta?.hours ?? null;
  return verdict(CLASS.MODELLED, SEVERITY.info, 'modelled', hit.reason, {
    sourceId: hit.id,
    kind: hit.kind,
    reason: hit.reason,
    hours,
  });
}

// ------------------------------------------------------------ 3. crossSystem

/**
 * The ORACLE derivation. Only CLIENT_BILLED earnings tabs need it —
 * TAKE_HOME tabs need no conversion and fall through untouched (they read
 * as plain OK/DEFECT via later rules). This is the rule that both explains
 * Ohta 2025-09 (CROSS_SYSTEM_OK) and catches the van Loon discount-rate
 * defect that FS_TOTALS===FS_ENTRIES hides from every 2-way diff.
 */
export function ruleCrossSystem(d) {
  if (d.metric !== 'earnings' || d.legs.SHEET.state !== LEG_STATE.PRESENT) return null;

  const columnLabel = d.legs.SHEET.meta?.columnLabel;
  const labelSystem = classifyEarningsLabel(columnLabel);
  if (labelSystem !== 'CLIENT_BILLED') return null; // TAKE_HOME needs no conversion; UNKNOWN falls through, loud

  const fsValue = d.legs.FS_ENTRIES.state === LEG_STATE.PRESENT ? d.legs.FS_ENTRIES.value : d.legs.FS_TOTALS.value;

  if (d.legs.ORACLE.state !== LEG_STATE.PRESENT) {
    // Client-billed column but no take-home ratio on file for this month — never guess.
    return verdict(
      CLASS.DEFECT,
      SEVERITY.defect,
      'crossSystem',
      'no rate on file for this month; cannot derive the ORACLE leg',
      {
        defectId: 'no-rate-on-file',
        expected: null,
        actual: fsValue ?? null,
        delta: null,
        affectedRows: d.legs.SHEET.meta?.rowsRead ?? null,
        why: d.legs.ORACLE.meta?.reason ?? 'takeHomeRate/rate not on file for this month',
      }
    );
  }

  const oracleValue = d.legs.ORACLE.value;
  const ratio = d.legs.ORACLE.meta?.ratio ?? null;
  const hours = d.legs.SHEET.meta?.hours ?? null;
  const cmp = zeroAwareCompare(fsValue, oracleValue);

  if (cmp.equal) {
    return verdict(
      CLASS.CROSS_SYSTEM_OK,
      SEVERITY.info,
      'crossSystem',
      `column "${columnLabel}" is CLIENT_BILLED; oracle (sheet × ${ratio}) reproduces Firestore's take-home value`,
      {
        columnLabel,
        hours,
        sheetImpliedRate: hours ? round2(d.legs.SHEET.value / hours) : null,
        fsImpliedRate: hours ? round2(fsValue / hours) : null,
        clientRate: d.legs.ORACLE.meta?.clientRate ?? null,
        takeHomeRate: d.legs.ORACLE.meta?.takeHomeRate ?? null,
        ratio,
      }
    );
  }

  const delta = round2(fsValue - oracleValue);
  return verdict(
    CLASS.DEFECT,
    SEVERITY.defect,
    'crossSystem',
    `oracle ${oracleValue} does not match Firestore ${fsValue} (delta ${delta})`,
    {
      defectId: 'discount-rate-conversion-skipped',
      expected: oracleValue,
      actual: fsValue,
      delta,
      affectedRows: d.legs.SHEET.meta?.rowsRead ?? null,
      why: 'take-home conversion applied only to standard-rate rows; negotiated-rate rows stored at full client value',
    }
  );
}

// -------------------------------------------------------------- 4. schemaGap

const SCHEMA_EVOLUTION_FIELDS = ['clientFilingFees', 'totalEarnings'];
const SCHEMA_CUTOVER = '2026-06-01';

/**
 * A field genuinely ABSENT (not zero) pre-cutover is real schema evolution,
 * not a defect. Absent post-cutover is unexplained and falls through to
 * ruleUnknown — loud, on purpose.
 */
export function ruleSchemaGap(d, ctx = {}) {
  if (d.legs.FS_TOTALS.state !== LEG_STATE.ABSENT) return null;
  if (!SCHEMA_EVOLUTION_FIELDS.includes(d.metric)) return null;

  const syncedAt = d.legs.FS_TOTALS.meta?.syncedAt ?? d.legs.FS_ENTRIES.meta?.syncedAt ?? null;
  const cutover = ctx.schemaCutover ?? SCHEMA_CUTOVER;
  if (!syncedAt || syncedAt >= cutover) return null;

  return verdict(
    CLASS.SCHEMA_GAP,
    SEVERITY.info,
    'schemaGap',
    `${d.metric} key genuinely absent pre-cutover (${cutover}) — schema evolution, not a defect`,
    { field: d.metric, syncedAt, cutover, docsAffected: ctx.schemaGapDocsAffected ?? null }
  );
}

// ------------------------------------------------------- 5. internalConsistency

/**
 * The discriminator. MUST precede ruleStaleness. FS_TOTALS != FS_ENTRIES
 * (both PRESENT) means the doc disagrees with itself — a misparse —
 * regardless of what SHEET says. This is the corrected `>0` guard: 0 is a
 * value like any other via zeroAwareCompare, so (FS_TOTALS=0, FS_ENTRIES=340)
 * is BOTH_PRESENT_DIFFER and gets flagged, unlike the app's own guards at
 * src/context/FirestoreDataContext.js:219,229,280,355.
 */
export function ruleInternalConsistency(d) {
  if (d.legs.FS_TOTALS.state !== LEG_STATE.PRESENT || d.legs.FS_ENTRIES.state !== LEG_STATE.PRESENT) return null;

  const cmp = zeroAwareCompare(d.legs.FS_TOTALS.value, d.legs.FS_ENTRIES.value);
  if (cmp.state !== 'BOTH_PRESENT_DIFFER') return null;

  const delta = round2(d.legs.FS_TOTALS.value - d.legs.FS_ENTRIES.value);
  return verdict(
    CLASS.DEFECT,
    SEVERITY.defect,
    'internalConsistency',
    `FS_TOTALS (${d.legs.FS_TOTALS.value}) != FS_ENTRIES (${d.legs.FS_ENTRIES.value}) — doc is internally ` +
      'inconsistent (misparse), regardless of what SHEET says',
    {
      defectId: 'misparse',
      expected: d.legs.FS_ENTRIES.value,
      actual: d.legs.FS_TOTALS.value,
      delta,
      affectedRows: d.legs.FS_ENTRIES.meta?.entryCount ?? null,
      why: 'FS_TOTALS (frozen sheetTotals) disagrees with entries[] resummed — a parse/sync defect, not staleness',
    }
  );
}

// -------------------------------------------------------------- 6. staleness

/**
 * Runs only once rule 5 has cleared the doc as internally consistent.
 * SHEET differing from the (consistent) Firestore value means the live
 * sheet moved since the last sync — expected, not a bug, since the Apps
 * Script only re-syncs the then-current month. `direction` is 'sheet-grew'
 * / 'sheet-shrank' / 'value-changed' from row-count comparison — reverse
 * staleness (rows deleted post-sync, e.g. Skrodzka 2026-05) is real.
 */
export function ruleStaleness(d) {
  if (d.legs.SHEET.state !== LEG_STATE.PRESENT) return null;
  if (d.legs.FS_ENTRIES.state !== LEG_STATE.PRESENT) return null; // no entries[] to resum here
  if (d.metric === 'earnings' && classifyEarningsLabel(d.legs.SHEET.meta?.columnLabel) === 'UNKNOWN') return null; // ambiguous dollar system — don't guess it's "just stale"

  const fsValue = d.legs.FS_ENTRIES.value;
  const cmp = zeroAwareCompare(d.legs.SHEET.value, fsValue);
  if (cmp.equal !== false) return null; // equal (nothing stale) or absent (shouldn't happen given the guards above)

  const sheetRowCount = d.legs.SHEET.meta?.rowsRead ?? d.legs.SHEET.meta?.sheetRowCount ?? null;
  const fsEntryCount = d.legs.FS_ENTRIES.meta?.entryCount ?? null;
  let direction = 'value-changed';
  if (sheetRowCount !== null && fsEntryCount !== null) {
    if (sheetRowCount > fsEntryCount) direction = 'sheet-grew';
    else if (sheetRowCount < fsEntryCount) direction = 'sheet-shrank';
  }

  return verdict(
    CLASS.STALE_SYNC,
    SEVERITY.info,
    'staleness',
    `doc internally consistent; live sheet has moved since sync (${direction})`,
    {
      direction,
      fsSum: d.legs.FS_TOTALS.state === LEG_STATE.PRESENT ? d.legs.FS_TOTALS.value : fsValue,
      fsStored: fsValue,
      sheetNow: d.legs.SHEET.value,
      fsEntryCount,
      sheetRowCount,
      syncedAt: d.legs.FS_TOTALS.meta?.syncedAt ?? d.legs.FS_ENTRIES.meta?.syncedAt ?? null,
    }
  );
}

// -------------------------------------------------------------- 7. writeback

const WRITEBACK_METRICS = ['status', 'dateReceived'];

/**
 * invoices/all `status` and `dateReceived` are the intended one-way
 * Mercury auto-match writeback target — Firestore is expected to diverge
 * from the sheet here. A status value outside the documented vocabulary
 * (e.g. the sheet's undocumented "Write Off") arrives as its own
 * `metric:'statusVocabulary'` divergence, which this rule does NOT match,
 * so it falls through to ruleKnownDefect/ruleUnknown instead.
 */
export function ruleWriteback(d) {
  if (d.domain !== 'invoicesAll' || !WRITEBACK_METRICS.includes(d.metric)) return null;

  const fsValue = d.legs.FS_TOTALS.state === LEG_STATE.PRESENT ? d.legs.FS_TOTALS.value : d.legs.FS_ENTRIES.value;
  return verdict(
    CLASS.EXPECTED_WRITEBACK,
    SEVERITY.info,
    'writeback',
    'one-way Mercury auto-match writeback field; sheet and Firestore are expected to diverge here',
    { field: d.metric, sheetValue: d.legs.SHEET.value ?? null, fsValue: fsValue ?? null, rowCount: d.legs.SHEET.meta?.rowCount ?? null }
  );
}

// ------------------------------------------------------------ 8. knownDefect

/**
 * Structural pattern recognition for recurring bugs that need a name
 * rather than landing in UNKNOWN. Currently covers the firmProfit
 * pre-OpEx overstatement (monthlyMetrics has no entries[] to resum, so
 * rules 5/6 never apply to it); other named patterns
 * (mcclure-adjustment-*, phantom-template-entries) are collector-tagged
 * via `meta.knownPattern` when a collector already recognizes the shape —
 * out of scope for this build's collectors, so no fixture currently drives
 * that branch, but the hook is here for scripts/verify/collect-*.mjs to use.
 */
export function ruleKnownDefect(d) {
  if (
    d.domain === 'monthlyMetrics' &&
    d.metric === 'firmProfit' &&
    d.legs.SHEET.state === LEG_STATE.PRESENT &&
    d.legs.FS_TOTALS.state === LEG_STATE.PRESENT
  ) {
    const cmp = zeroAwareCompare(d.legs.SHEET.value, d.legs.FS_TOTALS.value);
    if (cmp.equal === false) {
      const delta = round2(d.legs.FS_TOTALS.value - d.legs.SHEET.value);
      return verdict(
        CLASS.DEFECT,
        SEVERITY.defect,
        'knownDefect',
        'monthlyMetrics.firmProfit overstates the live sheet — payout/OpEx lines entered after the sync',
        {
          defectId: 'firmprofit-overstated-pre-opex',
          expected: d.legs.SHEET.value,
          actual: d.legs.FS_TOTALS.value,
          delta,
          affectedRows: null,
          why: 'payout/OpEx lines entered into the sheet after monthlyMetrics synced',
        }
      );
    }
  }

  const knownPattern = d.legs.FS_ENTRIES?.meta?.knownPattern ?? d.legs.FS_TOTALS?.meta?.knownPattern ?? null;
  if (knownPattern) {
    return verdict(CLASS.DEFECT, SEVERITY.defect, 'knownDefect', `collector-tagged known pattern: ${knownPattern}`, {
      defectId: knownPattern,
      expected: d.legs.SHEET?.value ?? null,
      actual: d.legs.FS_ENTRIES?.value ?? d.legs.FS_TOTALS?.value ?? null,
      delta: null,
      affectedRows: d.legs.FS_ENTRIES?.meta?.entryCount ?? null,
      why: `tagged by the collector as ${knownPattern}`,
    });
  }

  return null;
}

// ----------------------------------------------------------------- 9. agree

/** Every PRESENT leg agrees. Needs at least two PRESENT legs to mean anything. */
export function ruleAgree(d) {
  const present = Object.entries(d.legs).filter(([, leg]) => leg.state === LEG_STATE.PRESENT);
  if (present.length < 2) return null;

  const [first, ...rest] = present;
  const allEqual = rest.every(([, leg]) => zeroAwareCompare(first[1].value, leg.value).equal === true);
  if (!allEqual) return null;

  return verdict(CLASS.OK, SEVERITY.ok, 'agree', 'every present leg agrees', {
    legsCompared: present.map(([name]) => name),
  });
}

// --------------------------------------------------------------- 10. unknown

const RULE_IDS = [
  'coverage',
  'modelled',
  'crossSystem',
  'schemaGap',
  'internalConsistency',
  'staleness',
  'writeback',
  'knownDefect',
  'agree',
];

/** The terminal catch-all. ALWAYS claims — this is the entire alarm surface. */
export function ruleUnknown(d) {
  return verdict(CLASS.UNKNOWN, SEVERITY.defect, 'unknown', 'nothing in the chain explained this divergence', {
    signature: d.signature,
    legs: d.legs,
    rulesAttempted: RULE_IDS,
  });
}

export const CHAIN = Object.freeze([
  ruleCoverage,
  ruleModelled,
  ruleCrossSystem,
  ruleSchemaGap,
  ruleInternalConsistency,
  ruleStaleness,
  ruleWriteback,
  ruleKnownDefect,
  ruleAgree,
  ruleUnknown,
]);

/**
 * Attach baseline info to a fresh (pre-baseline) classification. Only
 * severity:'defect' classifications are eligible — 'ok'/'info'/'blind_spot'
 * get inert baselineId/inBand/null and isNew:false. `class:'UNKNOWN'` is
 * ALWAYS isNew:true regardless of any ledger match — see knownDivergences.mjs.
 */
function attachBaseline(classification, divergence, ctx) {
  if (classification.severity !== SEVERITY.defect) {
    return { ...classification, baselineId: null, inBand: null, isNew: false };
  }

  const knownList = ctx.knownDivergences ?? KNOWN_DIVERGENCES;
  const probe = { ...divergence, classification: { ...classification, baselineId: null, inBand: null, isNew: false } };
  const hit = matchBaseline(probe, knownList);

  const baselineId = hit ? hit.id : null;
  const inBand = hit ? hit.inBand : null;
  const isNew = classification.class === CLASS.UNKNOWN || baselineId === null || inBand === false;
  return { ...classification, baselineId, inBand, isNew };
}

/**
 * Classify a Divergence: walk `chain` in order, take the first non-null
 * verdict, attach baseline info, mutate `divergence.classification`, and
 * return the (mutated) divergence. Never throws in practice — ruleUnknown
 * always claims — the throw is a structural guard, not a real code path.
 */
export function classify(divergence, ctx = {}, chain = CHAIN) {
  for (const rule of chain) {
    const result = rule(divergence, ctx);
    if (result) {
      divergence.classification = attachBaseline(result, divergence, ctx);
      return divergence;
    }
  }
  throw new Error(`classify: no rule claimed divergence "${divergence.id}" — CHAIN is missing its ruleUnknown tail`);
}
