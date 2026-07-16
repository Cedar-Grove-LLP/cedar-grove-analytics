/**
 * Pure rendering: turn a flat list of already-`classify()`d Divergences
 * into a Report object, a console-text rendering, a JSON artifact, and an
 * exit code. Nothing here classifies anything — that's classifiers.mjs's
 * job; this module only buckets and prints. See BUILD-SPEC-verify.md §6.
 *
 * `renderConsole` puts NEW first, then KNOWN, then COVERAGE, then
 * EXPECTED, then DATA QUALITY — a new divergence must be impossible to
 * miss even if the operator only reads the top of the output.
 *
 * Pure module — no React/Firebase imports, no network, no filesystem.
 */

import { CLASS, SEVERITY } from './divergence.mjs';

function fmt(n) {
  if (n === null || n === undefined) return 'n/a';
  const sign = n < 0 ? '-' : '+';
  return `${sign}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Group a flat, classified Divergence[] into the buckets `renderConsole`
 * and `exitCodeFor` read. `coverage`/`modelledStats`/`checks` are passed
 * through verbatim from the caller (collector-produced summaries this
 * module has no way to compute itself from a divergence list alone).
 */
export function buildReport(divergences = [], { coverage = null, modelledStats = null, checks = [] } = {}) {
  const byClass = (cls) => divergences.filter((d) => d.classification?.class === cls);

  const newDefects = divergences.filter((d) => d.classification?.severity === SEVERITY.defect && d.classification.isNew);
  const knownDefects = divergences.filter(
    (d) => d.classification?.severity === SEVERITY.defect && !d.classification.isNew
  );
  const blindSpots = byClass(CLASS.BLIND_SPOT);
  const newBlindSpots = blindSpots.filter((d) => d.classification.evidence?.allowlisted === false);
  const expected = divergences.filter(
    (d) => d.classification?.severity === SEVERITY.info && d.classification.class !== CLASS.MODELLED
  );
  const modelled = byClass(CLASS.MODELLED);
  const ok = divergences.filter((d) => d.classification?.severity === SEVERITY.ok);

  return {
    generatedAt: new Date().toISOString(),
    total: divergences.length,
    divergences,
    newDefects,
    newBlindSpots,
    knownDefects,
    blindSpots,
    expected,
    modelled,
    ok,
    coverage,
    modelledStats,
    checks,
  };
}

function renderNew(report) {
  const lines = ['━━ NEW — un-baselined, needs a human ' + '━'.repeat(45)];
  const items = [...report.newDefects, ...report.newBlindSpots.filter((d) => !report.newDefects.includes(d))];
  if (items.length === 0) {
    lines.push('  (none)');
  } else {
    for (const d of items) {
      const c = d.classification;
      const tag = c.class === CLASS.UNKNOWN ? 'UNKNOWN' : 'DEFECT';
      const defectId = c.evidence?.defectId ? ` [${c.evidence.defectId}]` : '';
      lines.push(`  ▶ ${tag}  ${d.id}${defectId}`);
      lines.push(`      ${c.reason}`);
      if (d.signature) lines.push(`      signature: ${d.signature}`);
    }
  }
  return lines.join('\n');
}

function renderKnown(report) {
  const lines = ['━━ KNOWN — in the ledger, within band (see src/utils/verify/knownDivergences.mjs) ' + '━'.repeat(5)];
  if (report.knownDefects.length === 0) {
    lines.push('  (none)');
  } else {
    for (const d of report.knownDefects) {
      const c = d.classification;
      const delta = c.evidence?.delta !== undefined && c.evidence?.delta !== null ? `  ${fmt(c.evidence.delta)}` : '';
      lines.push(`  DEFECT  ${d.id}  ${c.evidence?.defectId ?? c.ruleId}${delta}  [baseline: ${c.baselineId}]`);
    }
  }
  return lines.join('\n');
}

function renderCoverage(report) {
  const lines = ['━━ COVERAGE — not checked ≠ passed ' + '━'.repeat(44)];
  if (report.blindSpots.length === 0) {
    lines.push('  (none)');
  } else {
    for (const d of report.blindSpots) {
      const c = d.classification;
      lines.push(
        `  BLIND SPOT  ${c.evidence.workbookKey ?? d.id}   ${c.evidence.reason}   ${c.evidence.metricsAffected} metric(s)   ${c.evidence.allowlisted ? 'allowlisted' : 'NEW'}`
      );
    }
  }
  return lines.join('\n');
}

function renderExpected(report) {
  const lines = ['━━ EXPECTED — structural, by rule, no ledger entry needed ' + '━'.repeat(20)];
  const counts = new Map();
  for (const d of [...report.expected, ...report.ok]) {
    const cls = d.classification.class;
    counts.set(cls, (counts.get(cls) ?? 0) + 1);
  }
  if (counts.size === 0) {
    lines.push('  (none)');
  } else {
    for (const [cls, count] of counts) {
      lines.push(`  ${cls.padEnd(18)} ${count} records`);
    }
  }
  return lines.join('\n');
}

function renderDataQuality(report) {
  const lines = ['━━ DATA QUALITY — informational, not drift ' + '━'.repeat(32)];
  const s = report.modelledStats;
  if (!s) {
    lines.push('  (not computed)');
  } else {
    lines.push(`  billable hours   ${s.billableModelled} / ${s.billableHours}  =  ${s.billablePct}% modelled or estimated, never timekept`);
    lines.push(`  ops hours        ${s.opsModelled} / ${s.opsHours}  =  ${s.opsPct}% modelled or estimated, never timekept`);
  }
  return lines.join('\n');
}

function renderResult(report) {
  const unknownCount = report.divergences.filter((d) => d.classification?.class === CLASS.UNKNOWN).length;
  const lines = [
    '━━ RESULT ' + '━'.repeat(68),
    `  ${report.newDefects.length} NEW  ·  ${report.knownDefects.length} known  ·  ${report.blindSpots.length} blind spots  ·  ${unknownCount} unknown`,
  ];
  return lines.join('\n');
}

/** Render the full console report. Order is NEW, KNOWN, COVERAGE, EXPECTED, DATA QUALITY, RESULT. */
export function renderConsole(report) {
  return [
    renderNew(report),
    renderKnown(report),
    renderCoverage(report),
    renderExpected(report),
    renderDataQuality(report),
    renderResult(report),
  ].join('\n\n');
}

/** JSON-safe deep clone of the report (drops functions/RegExps that shouldn't be there anyway). */
export function toJSON(report) {
  return JSON.parse(JSON.stringify(report));
}

/**
 * Exit-code contract (BUILD-SPEC §6), evaluated directly against the full
 * divergence list so it can never drift from buildReport's bucketing:
 *   any class==='UNKNOWN'                                         -> 1
 *   any severity==='defect' with baselineId===null                -> 1
 *   any severity==='defect' with inBand===false                   -> 1
 *   any BLIND_SPOT with allowlisted===false                       -> 1
 *   --strict: any BLIND_SPOT at all                                -> 1
 *   otherwise                                                      -> 0
 * Known-and-in-band defects print under KNOWN and do not fail — but the
 * moment they exceed their band they do. No severity is permanently exempt.
 */
export function exitCodeFor(report, { strict = false } = {}) {
  const all = report.divergences || [];

  if (all.some((d) => d.classification?.class === CLASS.UNKNOWN)) return 1;
  if (all.some((d) => d.classification?.severity === SEVERITY.defect && d.classification.baselineId === null)) return 1;
  if (all.some((d) => d.classification?.severity === SEVERITY.defect && d.classification.inBand === false)) return 1;
  if (all.some((d) => d.classification?.class === CLASS.BLIND_SPOT && d.classification.evidence?.allowlisted === false)) return 1;
  if (strict && all.some((d) => d.classification?.class === CLASS.BLIND_SPOT)) return 1;

  return 0;
}
