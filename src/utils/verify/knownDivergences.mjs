/**
 * The ledger. ~6 entries, each documenting a REAL known-and-tracked defect
 * with a `band` its evidence must stay inside to remain "known" rather than
 * "new". Plain .mjs (not JSON) so entries carry inline `//` evidence
 * comments and diff readably in a PR. See BUILD-SPEC-verify.md §7.
 *
 * This is the ONLY thing that can move a severity:'defect' classification
 * out of the NEW bucket — and only while its evidence value stays inside
 * `band`. A known defect that WORSENS past its band is promoted back to
 * NEW and fails the run; there is no permanent exemption (see §2's
 * rejection of a `PROCESS_GAP`-style always-passing severity).
 *
 * class:'UNKNOWN' is never eligible for this ledger to silence — see
 * exitCodeFor in report.mjs, which fails on any UNKNOWN unconditionally.
 * Baselining an UNKNOWN would defeat the one alarm the whole system exists
 * to keep loud.
 *
 * Pure module — no React/Firebase imports, no network, no filesystem.
 */

const VANLOON_ID = 'colin-van-loon';

export const KNOWN_DIVERGENCES = Object.freeze([
  {
    id: 'discount-rate-conversion-skipped-vanloon-2025h1',
    match: (d) =>
      d.classification?.evidence?.defectId === 'discount-rate-conversion-skipped' &&
      d.subject?.userId === VANLOON_ID &&
      d.subject?.monthKey >= '2025-01' &&
      d.subject?.monthKey <= '2025-06',
    band: { field: 'delta', min: 700, max: 850 }, // Feb +$798.00, Mar +$784.00 — proven to the penny
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      'Apps Script applies the ×0.65 take-home conversion only to rows at the attorney\'s standard ' +
      'client rate; the "Wanrong He" $400/h negotiated rows are stored at full client value, as if ' +
      'already take-home. Parser fix is separate work. FS_TOTALS===FS_ENTRIES at month level so ' +
      'only the ORACLE leg catches it.',
    evidence:
      'BUILD-SPEC-verify.md §1/§5; van Loon 2025 Feb doc total $20,805.00 vs correct $20,007.00 ' +
      '(delta +$798.00), March $36,059.50 vs $35,275.50 (delta +$784.00).',
  },
  {
    id: 'firmprofit-overstated-pre-opex',
    match: (d) =>
      d.domain === 'monthlyMetrics' &&
      d.metric === 'firmProfit' &&
      d.classification?.evidence?.defectId === 'firmprofit-overstated-pre-opex',
    band: [
      { field: 'delta', min: -Infinity, max: 40000 }, // worst single month so far: Jun +$36,175.12
      { field: 'allTimeDelta', min: -Infinity, max: 65000 }, // all-time +$57,964.42 (21.6% high)
    ],
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      "monthlyMetrics/all.firmProfit is synced from the Invoices workbook (B16) before that month's " +
      'payout/OpEx lines are entered — a process-timing gap, not a parser defect. Tracked because it ' +
      'grows every month and is NOT exempt from failing the run once it exceeds the band.',
    evidence:
      'Jan +$787.50, Feb +$4,032.00, Mar +$1,575.00, Apr +$4,725.00, May +$10,669.80, Jun ' +
      '+$36,175.12; all-time +$57,964.42 (21.6% high).',
  },
  {
    id: 'elections-83b-times65-typo',
    match: (d) =>
      d.domain === 'formula' && d.classification?.evidence?.defectId === 'elections-83b-times-0.65-typo',
    band: { field: 'bookCount', min: 0, max: 10 },
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      '9 of 10 books carry =SUM(...)*65 instead of *0.65 on the 83(b) bonus formula (July + Template ' +
      'tabs). Dormant today — no July elections exist, so it evaluates to $0 on every value leg. Only ' +
      'formula-text inspection (checkFormulaText) can see it.',
    evidence:
      'formulaLandmines.mjs FORMULA_LANDMINES[0].booksWithTypo (9 entries); Levin is the one correct ' +
      'book (=SUM(Q:Q)*0.65).',
  },
  {
    id: 'mcclure-adjustment-hours-drift',
    match: (d) =>
      d.subject?.attorney === 'Sam McClure' &&
      ['mcclure-adjustment-hours-inflated', 'mcclure-adjustment-bulk-zeroed'].includes(
        d.classification?.evidence?.defectId
      ),
    band: { field: 'delta', min: -20, max: 20 }, // hours, both directions: +3.75..+16.35 inflated, -11.8 zeroed
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      "Sam McClure's Adjustment ($) column: pre-June-2026 rows backfilled a blank Hours cell as " +
      'earnings÷rate (inflated 3.75/6.4/2.5/7.5/16.35h Jan–May 2026); the June-2026 layout shift then ' +
      'zeroed bulk-adjustment rows entirely (deflated 11.8h / $4,956). Two symptoms of the same ' +
      'Adjustment-column parsing gap.',
    evidence:
      'Jan..May 2026 hours inflated by 3.75/6.4/2.5/7.5/16.35h (earnings matched); Jun 2026 ' +
      'deflated 11.8h / $4,956.',
  },
  {
    id: 'phantom-template-entries',
    match: (d) => d.classification?.evidence?.defectId === 'phantom-template-entries',
    band: { field: 'affectedRows', min: 0, max: 24 }, // McClure 2026-04: 24; Ohta 2025-09: 4
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      'eightThreeB entries fabricated from an empty template block: flatFee holds a sequential loop ' +
      'counter (1..N) with zero matching sheet rows. Re-syncing will not clear it; the doc needs deleting.',
    evidence:
      'McClure 2026-04: 24 entries, flatFee 1..24, sheet Template block blank. Ohta 2025-09: 4 ' +
      'entries, sheet has none.',
  },
  {
    id: 'invoices-status-vocabulary-writeoff',
    match: (d) =>
      d.domain === 'invoicesAll' &&
      d.metric === 'statusVocabulary' &&
      d.classification?.evidence?.value === 'Write Off',
    band: { field: 'rowCount', min: 0, max: 50 },
    owner: 'nmbroom',
    addedOn: '2026-07-16',
    reviewBy: '2026-10-16',
    reason:
      'The Payment Status sheet uses a "Write Off" status value that neither the CLAUDE.md invoices/all ' +
      "schema nor paymentStatus.mjs's status enum documents. Tracked as a documentation gap, not a " +
      'sync defect — undecided whether a written-off invoice should count toward Hold (see ' +
      'BUILD-SPEC-verify.md §10 open question 4).',
    evidence: "src/utils/paymentStatus.mjs status enum; sheet's Payment Status tab uses 'Write Off'.",
  },
]);

/**
 * Does `divergence` match a ledger entry, and if so is its evidence still
 * within the entry's band? `divergence.classification` must already carry
 * `evidence` — `match()` reads `classification.evidence.*`. Called from
 * classifiers.mjs's `classify()` after a rule produces a severity:'defect'
 * classification, never before.
 *
 * A `band` entry with a `field` absent from this divergence's evidence is
 * treated as satisfied (not violated) — e.g. the firmProfit entry's
 * `allTimeDelta` sub-band only applies to an all-time-aggregate divergence,
 * never to a per-month one, and the two must not interfere with each other.
 *
 * @returns {{id:string, inBand:boolean, entry:object}|null}
 */
export function matchBaseline(divergence, list = KNOWN_DIVERGENCES) {
  for (const entry of list) {
    if (!entry.match(divergence)) continue;

    const bands = Array.isArray(entry.band) ? entry.band : [entry.band];
    const inBand = bands.every((b) => {
      if (!b) return true;
      const value = divergence.classification?.evidence?.[b.field];
      if (value === undefined || value === null) return true; // field n/a to this divergence
      const min = b.min ?? -Infinity;
      const max = b.max ?? Infinity;
      return value >= min && value <= max;
    });

    return { id: entry.id, inBand, entry };
  }
  return null;
}
