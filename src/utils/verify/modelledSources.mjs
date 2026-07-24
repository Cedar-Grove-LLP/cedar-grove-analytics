/**
 * Registry of periods that were never timekept — data is modelled/estimated
 * at the source, not synced from a real timesheet row. These periods must
 * never be flagged as drift (Firestore legitimately "matches" a modelled
 * sheet exactly), but they must also never silently classify OK — they are
 * their own MODELLED verdict so the data-quality KPI can count them.
 *
 * Two kinds, both proven against the live books:
 *   LUMPED_IMPORT   — no 2024 workbook exists at all. One lumped entry per
 *                      month (client "Monthly Total (2024 import)" for
 *                      billables, "Monthly ops total" for ops).
 *   MATRIX_ESTIMATE — McClure's 2025 H1 client-matrix tabs (Jan25..June25)
 *                      source hours from the "Hrs Estimate (Val)" column,
 *                      which is itself an estimate, not a logged hour; ops
 *                      is a single lumped 158.56 row. Firestore matches
 *                      these tabs exactly — the SYNC is faithful, the
 *                      SOURCE is modelled.
 *
 * Pure module — no React/Firebase imports; Node-importable.
 */

// monthKey is 'YYYY-MM'; string comparison is safe because the format is
// fixed-width and zero-padded.
const inRange = (monthKey, start, end) => monthKey >= start && monthKey <= end;

const sameAttorney = (a, b) =>
  String(a || '').toLowerCase().trim() === String(b || '').toLowerCase().trim();

export const MODELLED_SOURCES = Object.freeze([
  {
    id: '2024-lumped-import-mcclure',
    kind: 'LUMPED_IMPORT',
    attorney: 'Sam McClure',
    monthStart: '2024-01',
    monthEnd: '2024-12',
    reason: 'no 2024 workbook exists for Sam McClure; one lumped entry/month, client '
      + '"Monthly Total (2024 import)" (ops: "Monthly ops total") — a fixed 15%/85% split '
      + 'of a modelled 150/180/215h month.',
  },
  {
    id: '2024-lumped-import-vanloon',
    kind: 'LUMPED_IMPORT',
    attorney: 'Colin van Loon',
    monthStart: '2024-02',
    monthEnd: '2024-12',
    reason: 'no 2024 workbook exists for Colin van Loon; one lumped entry/month, client '
      + '"Monthly Total (2024 import)" (ops: "Monthly ops total") — earnings ÷ ~$325.',
  },
  {
    id: '2024-lumped-import-weekes',
    kind: 'LUMPED_IMPORT',
    attorney: 'Miika Weekes',
    monthStart: '2024-04',
    monthEnd: '2024-12',
    reason: 'no 2024 workbook exists for Miika Weekes; one lumped entry/month, client '
      + '"Monthly Total (2024 import)" (ops: "Monthly ops total") — earnings ÷ ~$325.',
  },
  {
    id: 'mcclure-2025-h1-matrix',
    kind: 'MATRIX_ESTIMATE',
    attorney: 'Sam McClure',
    monthStart: '2025-01',
    monthEnd: '2025-06',
    reason: 'sourced from client-matrix tabs Jan25..June25; hours column is "Hrs Estimate (Val)" '
      + '(an ESTIMATE, not logged time) and ops is a single lumped 158.56 row. Firestore matches '
      + 'the tabs exactly — the sync is faithful, the SOURCE is modelled.',
  },
]);

/**
 * Does this attorney/month/domain fall inside a modelled-data window?
 * `domain` is accepted for call-site symmetry with the divergence record
 * (billables/ops both draw from the same lumped or matrix source) but is
 * not itself a filter — every registry entry covers both domains.
 *
 * @returns {{id:string, kind:string, reason:string}|null}
 */
export function matchModelledSource({ attorney, monthKey, domain } = {}) {
  void domain;
  if (!attorney || !monthKey) return null;
  const hit = MODELLED_SOURCES.find(
    (src) => sameAttorney(src.attorney, attorney) && inRange(monthKey, src.monthStart, src.monthEnd)
  );
  return hit ? { id: hit.id, kind: hit.kind, reason: hit.reason } : null;
}

/**
 * Data-quality KPI: what fraction of total logged hours were modelled or
 * estimated rather than timekept, by domain.
 *
 * @param {Array<{attorney:string, monthKey:string, domain:'billables'|'ops', hours:number}>} periods
 * @returns {{billableHours:number, billableModelled:number, billablePct:number,
 *            opsHours:number, opsModelled:number, opsPct:number}}
 */
export function modelledDataStats(periods = []) {
  let billableHours = 0;
  let billableModelled = 0;
  let opsHours = 0;
  let opsModelled = 0;

  periods.forEach((p) => {
    const hours = Number(p.hours) || 0;
    const modelled = matchModelledSource({ attorney: p.attorney, monthKey: p.monthKey, domain: p.domain }) !== null;
    if (p.domain === 'ops') {
      opsHours += hours;
      if (modelled) opsModelled += hours;
    } else {
      billableHours += hours;
      if (modelled) billableModelled += hours;
    }
  });

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

  return {
    billableHours,
    billableModelled,
    billablePct: pct(billableModelled, billableHours),
    opsHours,
    opsModelled,
    opsPct: pct(opsModelled, opsHours),
  };
}
