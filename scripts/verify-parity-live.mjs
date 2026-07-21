#!/usr/bin/env node
// LIVE Sheets↔Firestore financial-parity verifier — the entry point.
// See BUILD-SPEC-verify.md for the full design. This file wires together
// already-built pieces and makes ZERO decisions about what a divergence
// means — that's entirely classifiers.mjs's job, walked via classify().
//
// READ-ONLY: spreadsheets.readonly + Firestore Admin read. Never writes.
// Credentialed + local-only — never wired into CI (see CLAUDE.md).
//
// Usage: node scripts/verify-parity-live.mjs [--domain timesheets|firm|formulas|all]
//                                             [--strict] [--json out.json] [--verbose]
// Exit codes: see src/utils/verify/report.mjs exitCodeFor().

import { writeFileSync } from 'node:fs';
import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';
import { loadKey, getAccessToken } from './lib/sheetsAuth.mjs';
import { collectTimesheetDivergences } from './verify/collect-timesheets.mjs';
import { collectFirmDivergences } from './verify/collect-firm.mjs';
import { collectFormulaDivergences } from './verify/collect-formulas.mjs';
import { classify } from '../src/utils/verify/classifiers.mjs';
import { modelledDataStats } from '../src/utils/verify/modelledSources.mjs';
import { buildReport, renderConsole, toJSON, exitCodeFor } from '../src/utils/verify/report.mjs';

// --- CLI -----------------------------------------------------------------

function parseArgs(argv) {
  const args = { domain: 'all', strict: false, json: null, verbose: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--domain') args.domain = argv[++i];
    else if (a === '--strict') args.strict = true;
    else if (a === '--json') args.json = argv[++i];
    else if (a === '--verbose') args.verbose = true;
  }
  const valid = ['timesheets', 'firm', 'formulas', 'all'];
  if (!valid.includes(args.domain)) {
    throw new Error(`--domain must be one of ${valid.join('|')}, got "${args.domain}"`);
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const run = {
  timesheets: args.domain === 'all' || args.domain === 'timesheets',
  firm: args.domain === 'all' || args.domain === 'firm',
  formulas: args.domain === 'all' || args.domain === 'formulas',
};

// --- main ------------------------------------------------------------------
//
// Credential/token acquisition is the ONLY thing allowed to hard-fail this
// run. Every per-book failure below that point (403, cap hit, unrecognized
// layout) is already surfaced by the collectors as a returned BLIND_SPOT
// divergence, never a thrown error — see scripts/lib/sheetsAuth.mjs's header
// comment. A try/catch around the whole body is a safety net for genuinely
// unexpected errors (a malformed response, a real bug), not the mechanism
// that turns a 403 into a blind spot — that mechanism lives in the
// collectors themselves and is not duplicated here.

async function main() {
  loadEnvFile(new URL('../.env.local', import.meta.url).pathname);

  const key = loadKey(); // throws on missing/malformed credential — hard fail, correctly
  const token = await getAccessToken(key); // throws on token-exchange failure — hard fail, correctly
  const db = getDb();

  console.log(`Cedar Grove parity — ${new Date().toISOString()}`);
  console.log(`READ-ONLY: spreadsheets.readonly + Firestore Admin read.  as ${key.client_email}`);
  console.log(`domain: ${args.domain}${args.strict ? '  --strict' : ''}\n`);

  const divergences = [];
  const coverage = {};
  let checks = [];
  let periods = [];

  if (run.timesheets) {
    const result = await collectTimesheetDivergences({ token, db });
    divergences.push(...result.divergences);
    coverage.timesheets = result.coverage;
    periods = result.periods ?? [];
  }

  if (run.firm) {
    const result = await collectFirmDivergences({ token, db });
    divergences.push(...result.divergences);
    coverage.firm = result.coverage;
    checks = result.checks ?? [];
  }

  if (run.formulas) {
    const result = await collectFormulaDivergences({ token });
    divergences.push(...result.divergences);
    coverage.formulas = result.coverage;
  }

  // classify() mutates each divergence's .classification in place and
  // returns it — the ordered chain (classifiers.mjs CHAIN) is the only
  // place a divergence's meaning is decided.
  for (const d of divergences) classify(d);

  const modelledStats = modelledDataStats(periods);
  const report = buildReport(divergences, { coverage, modelledStats, checks });

  console.log(`${report.total} divergence records evaluated.\n`);
  console.log(renderConsole(report));

  if (checks.length) {
    console.log('\n━━ CHECKS — collector-computed aggregates outside the classifier chain ' + '━'.repeat(6));
    for (const c of checks) {
      console.log(`  ${c.id}: ${c.description}`);
      console.log(
        `    months=${c.monthsCompared}  stored=${c.allTimeStored}  live=${c.allTimeLive}  `
        + `delta=${c.allTimeDelta}  band<=${c.band?.max}  inBand=${c.inBand}`
      );
    }
  }

  if (args.verbose) {
    console.log('\n━━ VERBOSE — raw coverage summaries per collector ' + '━'.repeat(29));
    console.log(JSON.stringify(coverage, null, 2));
  }

  if (args.json) {
    writeFileSync(args.json, JSON.stringify(toJSON(report), null, 2));
    console.log(`\nwrote ${args.json}`);
  }

  const code = exitCodeFor(report, { strict: args.strict });
  console.log(`\nexit ${code}`);
  process.exit(code);
}

main().catch((err) => {
  console.error('\nFATAL — verify-parity-live.mjs aborted (credential/token failure or unexpected bug):');
  console.error(err?.stack ?? err);
  process.exit(1);
});
