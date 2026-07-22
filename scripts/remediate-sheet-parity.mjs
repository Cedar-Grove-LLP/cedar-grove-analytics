#!/usr/bin/env node
/**
 * LIVE remediation shell for reconciling Firestore timesheet month docs to
 * their Google Sheets source. The default mode is a read-only dry run that
 * writes local change-set and backup artifacts. Production writes consume a
 * separately reviewed, frozen change-set via the guarded --apply-from flow;
 * the legacy --apply mode is permanently rejected.
 *
 * IO module — Sheets reads, Firestore reads, local artifact writes, and
 * explicitly guarded Firestore writes. Classification remains in the pure
 * remediationClassifier.mjs module. Importing this module performs no IO.
 *
 * Usage: node scripts/remediate-sheet-parity.mjs [--user "Name"] [--year 2025]
 *   [--include-empty-mirrors] [--out <path>]
 * Apply: node scripts/remediate-sheet-parity.mjs --apply-from <changeset.json>
 *   --i-understand-this-writes-production-data [--exclude-bucket A,B]
 *   [--out <path>]
 */

import {
  appendFileSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadEnvFile } from './lib/env.mjs';
import { getDb } from './lib/firestore.mjs';
import { loadKey, getAccessToken, listTabs, batchGet, capGuard } from './lib/sheetsAuth.mjs';
import {
  MONTH_NAMES, monthDocId, countRows, buildRatesMap,
} from './verify/collect-timesheets.mjs';
import { round2, sumColumn } from './verify/subject.mjs';
import { WORKBOOKS } from '../src/utils/verify/workbooks.mjs';
import { resolveLayout, resolveTabToMonth } from '../src/utils/verify/sheetLayout.mjs';
import { resolveSummaryCells } from '../src/utils/verify/summaryCells.mjs';
import {
  CLASSIFICATION,
  DOC_PRECEDENCE,
  classifyField,
  computeDrift,
  expandUpdatePayload,
  convertOrSuppressClientBilledStaleness,
  demoteEmptyMirrorCreation,
  isPhantomDeleteEligible,
  prepareEarningsLegs,
  rollupDocClassification,
} from '../src/utils/verify/remediationClassifier.mjs';
import { matchModelledSource } from '../src/utils/verify/modelledSources.mjs';
import { detectPhantomTemplateEntries } from '../src/utils/verify/phantoms.mjs';
import { parseMoney } from '../src/utils/entryNormalize.mjs';
import { oracleEarnings } from '../src/utils/verify/currency.mjs';

const DEFAULT_OUTPUT_DIR = '/private/tmp/claude-501/-Users-noah-github-cedar-grove-analytics--claude-worktrees-firestore-calculation-tests-e24846/aa3ff975-acc0-402d-bffd-c8d331c55528/scratchpad';
const APPLY_ACK = '--i-understand-this-writes-production-data';
const RETRYABLE_HTTP = new Set([429, 503]);
const SHEETS_ERROR = /^#(?:N\/A|REF!|ERROR!|VALUE!|DIV\/0!|NAME\?|NUM!|NULL!)/i;
const TOTALS_FIELD = Object.freeze({
  hours: 'totalBillableHours',
  earnings: 'billableEarnings',
  clientFilingFees: 'clientFilingFees',
  opsHours: 'opsHours',
  totalHours: 'totalHours',
  flatFee: 'totalFlatFees',
});
const UNIT = Object.freeze({
  hours: 'hours',
  opsHours: 'hours',
  totalHours: 'hours',
  earnings: 'dollars',
  clientFilingFees: 'dollars',
  flatFee: 'dollars',
  entries: 'count',
});

function requiredValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) throw new Error(`${flag} requires a value`);
  return value;
}

export function parseArgs(argv) {
  // Reject this legacy mode before validating anything else: it recomputed a
  // live payload instead of applying the exact artifact a human reviewed.
  if (argv.includes('--apply')) {
    throw new Error('--apply no longer applies live. Use the two-step flow: 1) dry run (no flags) to produce a change-set artifact, 2) after human review, --apply-from <changeset.json> --i-understand-this-writes-production-data.');
  }

  const args = {
    applyFrom: null,
    acknowledged: false,
    excludeBuckets: new Set(),
    includeEmptyMirrors: false,
    user: null,
    year: null,
    out: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply-from') args.applyFrom = requiredValue(argv, i++, arg);
    else if (arg === '--exclude-bucket') {
      const values = requiredValue(argv, i++, arg).split(',').map((value) => value.trim()).filter(Boolean);
      if (values.length === 0) throw new Error('--exclude-bucket requires a classification name');
      for (const value of values) args.excludeBuckets.add(value);
    } else if (arg === '--include-empty-mirrors') args.includeEmptyMirrors = true;
    else if (arg === APPLY_ACK) args.acknowledged = true;
    else if (arg === '--user') args.user = requiredValue(argv, i++, arg);
    else if (arg === '--year') args.year = Number(requiredValue(argv, i++, arg));
    else if (arg === '--out') args.out = requiredValue(argv, i++, arg);
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (args.year !== null && (!Number.isInteger(args.year) || args.year < 2000 || args.year > 2100)) {
    throw new Error('--year must be an integer from 2000 through 2100');
  }
  if (args.applyFrom && !args.acknowledged) {
    throw new Error(`--apply-from requires the literal ${APPLY_ACK} flag`);
  }
  if (!args.applyFrom && args.acknowledged) {
    throw new Error(`${APPLY_ACK} is only valid together with --apply-from`);
  }
  if (!args.applyFrom && args.excludeBuckets.size > 0) {
    throw new Error('--exclude-bucket is only valid together with --apply-from');
  }
  if (args.applyFrom && args.includeEmptyMirrors) {
    throw new Error('--include-empty-mirrors is only valid in dry-run collection mode');
  }
  return args;
}

const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

// Sheets API enforces a per-minute per-user read-request quota
// (scripts/lib/sheetsAuth.mjs issues one fetch per listTabs/batchGet with no
// pacing of its own). A full remediation pass makes ~250+ Sheets calls
// across 19 workbooks; unpaced, that reliably trips sustained 429s (see the
// live divergence survey). MIN_CALL_INTERVAL_MS throttles every raw Sheets
// HTTP call (including retries) to stay under the quota; override via env
// for local iteration against a mock.
const MIN_CALL_INTERVAL_MS = Number(process.env.REMEDIATE_SHEETS_PACE_MS ?? 1100);
let lastSheetsCallAt = 0;

async function paceSheetsCall(fn) {
  const wait = lastSheetsCallAt + MIN_CALL_INTERVAL_MS - Date.now();
  if (wait > 0) await delay(wait);
  lastSheetsCallAt = Date.now();
  return fn();
}

function gridHasSheetError(grids) {
  return Object.values(grids || {}).some((grid) =>
    grid.some((row) => row.some((cell) => typeof cell === 'string' && SHEETS_ERROR.test(cell.trim())))
  );
}

// Retries are paced too (each retry re-invokes `operation`, which the call
// sites wrap in paceSheetsCall) and given a generous attempt/backoff budget
// since sustained per-minute quota exhaustion needs longer cooldowns than a
// single burst of jittered retries.
async function retrySheetRead(operation, { attempts = 6, baseDelayMs = 500 } = {}) {
  let lastResult;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    lastResult = await paceSheetsCall(operation);
    const retryableStatus = RETRYABLE_HTTP.has(lastResult?.blindSpot?.httpStatus);
    const hasCellError = lastResult?.grids && gridHasSheetError(lastResult.grids);
    if (!retryableStatus && !hasCellError) return lastResult;
    if (attempt < attempts - 1) await delay(baseDelayMs * (2 ** attempt));
  }
  if (lastResult?.grids && gridHasSheetError(lastResult.grids)) {
    return { blindSpot: { status: 'SHEETS_CELL_ERROR', reason: 'Sheets error cell remained after retries', httpStatus: null } };
  }
  return lastResult;
}

const present = (value) => value !== undefined && value !== null;
const nonBlank = (value) => value !== undefined && value !== null && String(value).trim() !== '';
const rawCell = (row, index) => index === null || index === undefined ? undefined : row?.[index];
const textCell = (row, index) => String(rawCell(row, index) ?? '').trim();
const moneyCell = (row, index) => parseMoney(rawCell(row, index));

function sheetDate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return value ?? '';
  const date = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
}

function dataRows(grid, headerRowIndex) {
  return grid.slice(headerRowIndex + 1).map((row, index) => ({ row, sheetRowNumber: headerRowIndex + index + 2 }));
}

function buildBillableEntries(grid, layout, earnings) {
  const { columns, headerRowIndex } = layout;
  return dataRows(grid, headerRowIndex).flatMap(({ row, sheetRowNumber }) => {
    const client = textCell(row, columns.client);
    const rawDate = rawCell(row, columns.date);
    const rawHours = rawCell(row, columns.hours);
    if (![client, rawDate, rawHours].some(nonBlank)) return [];
    const rawEarnings = moneyCell(row, columns.earnings);
    const convertedEarnings = oracleEarnings({
      sheetEarnings: rawEarnings,
      labelSystem: earnings.labelSystem,
      ratio: earnings.ratio,
    });
    if (convertedEarnings === null) return [];
    return [{
      client,
      date: sheetDate(rawDate),
      hours: moneyCell(row, columns.hours),
      earnings: convertedEarnings,
      adjustment: moneyCell(row, columns.adjustment),
      billingCategory: textCell(row, columns.billingCategory),
      matter: textCell(row, columns.matter),
      clientFilingFees: moneyCell(row, columns.clientFilingFees),
      reimbursements: moneyCell(row, columns.reimbursement),
      notes: textCell(row, columns.notes) || textCell(row, columns.generalNotes),
      sheetRowNumber,
    }];
  });
}

function buildOpsEntries(grid, layout) {
  const { columns, headerRowIndex } = layout;
  return dataRows(grid, headerRowIndex).flatMap(({ row, sheetRowNumber }) => {
    const description = textCell(row, columns.ops);
    const rawDate = rawCell(row, columns.opsDate);
    const rawHours = rawCell(row, columns.opsHours);
    if (![description, rawDate, rawHours].some(nonBlank)) return [];
    return [{
      description,
      category: textCell(row, columns.opsCategory),
      date: sheetDate(rawDate),
      hours: moneyCell(row, columns.opsHours),
      sheetRowNumber,
    }];
  });
}

function buildEightThreeBEntries(grid, layout) {
  const { columns, headerRowIndex } = layout;
  return dataRows(grid, headerRowIndex).flatMap(({ row, sheetRowNumber }) => {
    const company = textCell(row, columns.company);
    const name = textCell(row, columns.name);
    const rawFlatFee = rawCell(row, columns.flatFee);
    if (![company, name, rawFlatFee].some(nonBlank)) return [];
    return [{ company, name, flatFee: parseMoney(rawFlatFee), sheetRowNumber }];
  });
}

function sumEntries(entries, field) {
  return round2((entries || []).reduce((sum, entry) => sum + parseMoney(entry[field]), 0));
}

export function storedTotal(data, key) {
  if (data?.sheetTotals && Object.prototype.hasOwnProperty.call(data.sheetTotals, key)) {
    return parseMoney(data.sheetTotals[key]);
  }
  // Live eightThreeB docs keep the flat-fee FACE VALUE at the document root,
  // while sheetTotals.eightThreeBFeeEarnings is the distinct take-home bonus.
  // Prefer the normalized nested key above if it ever exists, but preserve
  // compatibility with the proven root-level schema instead of manufacturing
  // a missing-rollup proposal for every otherwise-clean 83(b) month.
  if (key === 'totalFlatFees' && Object.prototype.hasOwnProperty.call(data ?? {}, key)) {
    return parseMoney(data[key]);
  }
  return undefined;
}

function timestampedTarget(out, defaultDirectory = DEFAULT_OUTPUT_DIR) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const target = resolve(out || defaultDirectory);
  const isFile = extname(target).toLowerCase() === '.json'
    || (existsSync(target) && statSync(target).isFile());
  if (isFile) {
    mkdirSync(dirname(target), { recursive: true });
    const bareName = basename(target, extname(target));
    return { directory: dirname(target), stem: `${bareName}-${timestamp}`, isFile: true };
  }
  mkdirSync(target, { recursive: true });
  return { directory: target, stem: timestamp, isFile: false };
}

export function outputPaths(out) {
  const target = timestampedTarget(out);
  const build = (suffix = '') => {
    const stem = `${target.stem}${suffix}`;
    if (!target.isFile) {
      return {
        changeset: join(target.directory, `remediation-changeset-${stem}.json`),
        backup: join(target.directory, `remediation-backup-${stem}.json`),
        coverage: join(target.directory, `remediation-coverage-${stem}.json`),
      };
    }
    return {
      changeset: join(target.directory, `${stem}.json`),
      backup: join(target.directory, `${stem}.backup.json`),
      coverage: join(target.directory, `${stem}.coverage.json`),
    };
  };
  let suffixNumber = 0;
  let paths = build();
  while (Object.values(paths).some(existsSync)) {
    suffixNumber += 1;
    paths = build(`-${suffixNumber}`);
  }
  return paths;
}

function applyOutputPaths(out) {
  const target = timestampedTarget(out);
  const prefix = target.isFile ? target.stem : `remediation-apply-${target.stem}`;
  const build = (suffix = '') => ({
    backup: join(target.directory, `${prefix}${suffix}.applied-backup.json`),
    journal: join(target.directory, `${prefix}${suffix}.journal.jsonl`),
  });
  let suffixNumber = 0;
  let paths = build();
  while (Object.values(paths).some(existsSync)) {
    suffixNumber += 1;
    paths = build(`-${suffixNumber}`);
  }
  return paths;
}

function ensureDoc(docMap, { docPath, data, exists, replacementEntries, monthKey, domain }) {
  if (!docMap.has(docPath)) {
    docMap.set(docPath, {
      docPath, data, exists, replacementEntries, monthKey, domain, results: [], changes: [],
    });
  }
  return docMap.get(docPath);
}

function addFieldResult(doc, { field, result, sheetRows, sheetSummary, fsTotals, fsEntries }) {
  doc.results.push({ ...result, field });
  if (![
    CLASSIFICATION.FIXABLE_ROLLUP,
    CLASSIFICATION.STALE_ENTRIES,
    CLASSIFICATION.EMPTY_MIRROR_SKIPPED,
  ].includes(result.classification)) return;
  doc.changes.push({
    docPath: doc.docPath,
    field,
    unit: UNIT[field],
    currentValue: result.classification === CLASSIFICATION.FIXABLE_ROLLUP ? fsTotals : fsEntries,
    sheetValue: sheetRows ?? sheetSummary,
    entriesSumValue: fsEntries,
    proposedValue: result.proposedValue,
    classification: result.classification,
    agreement: result.agreement,
  });
}

function classifyAndAdd(doc, input) {
  const result = classifyField(input);
  addFieldResult(doc, { ...input, result });
  return result;
}

function blindDoc(docMap, id, reason) {
  const doc = ensureDoc(docMap, {
    docPath: `blindSpot/${id}`, data: null, exists: false, replacementEntries: [], monthKey: null, domain: 'coverage',
  });
  doc.results.push({ classification: CLASSIFICATION.BLIND_SPOT, proposedValue: null, reason, agreement: {} });
}

function suppressUnsafeBillableStaleness(doc, reason) {
  doc.results = doc.results.map((result) => result.classification === CLASSIFICATION.STALE_ENTRIES
    ? { ...result, classification: CLASSIFICATION.BLIND_SPOT, proposedValue: null, reason }
    : result);
  doc.changes = doc.changes.filter((change) => change.classification !== CLASSIFICATION.STALE_ENTRIES);
}

export function applyPayload(doc) {
  const payload = {};
  const totals = {};
  const stale = doc.changes.some((change) => [
    CLASSIFICATION.STALE_ENTRIES,
    CLASSIFICATION.STALE_ENTRIES_CONVERTED,
  ].includes(change.classification));
  if (stale) {
    payload.entries = doc.replacementEntries;
    payload.entryCount = payload.entries.length;
    const [year, monthNumber] = (doc.monthKey || '').split('-').map(Number);
    if (!doc.data?.year && year) payload.year = year;
    if (!doc.data?.month && monthNumber) payload.month = MONTH_NAMES[monthNumber - 1];
  }
  for (const change of doc.changes) {
    const totalsField = TOTALS_FIELD[change.field];
    if (totalsField) {
      totals[totalsField] = change.proposedValue;
    }
  }
  if (Object.keys(totals).length) payload.sheetTotals = totals;
  return payload;
}

function artifactValue(value) {
  return value === undefined ? null : value;
}

export function serializeChanges(docMap) {
  return [...docMap.values()].flatMap((doc) => {
    const bucket = rollupDocClassification(doc.results);
    return doc.changes.map((change) => ({
      ...change,
      bucket,
      currentValue: artifactValue(change.currentValue),
      sheetValue: artifactValue(change.sheetValue),
      entriesSumValue: artifactValue(change.entriesSumValue),
    }));
  });
}

const WRITE_ELIGIBLE_BUCKETS = new Set([
  CLASSIFICATION.STALE_ENTRIES,
  CLASSIFICATION.STALE_ENTRIES_CONVERTED,
  CLASSIFICATION.FIXABLE_ROLLUP,
  CLASSIFICATION.PHANTOM_83B,
]);

/** Freeze the complete write contract and its comparison backup in one row. */
export function serializeDocsForApply(docMap) {
  return [...docMap.values()].flatMap((doc) => {
    const bucket = rollupDocClassification(doc.results);
    if (!WRITE_ELIGIBLE_BUCKETS.has(bucket) || doc.changes.length === 0) return [];
    const phantom = bucket === CLASSIFICATION.PHANTOM_83B;
    return [{
      docPath: doc.docPath,
      domain: doc.domain,
      bucket,
      op: phantom ? 'delete' : doc.exists ? 'update' : 'create',
      payload: phantom ? null : applyPayload(doc),
      priorState: { exists: doc.exists, data: doc.data ?? null },
    }];
  });
}

function serializeCoverage(docMap) {
  return [...docMap.values()].map((doc) => ({
    docPath: doc.docPath,
    domain: doc.domain,
    monthKey: doc.monthKey,
    docClassification: rollupDocClassification(doc.results),
    fields: doc.results.map((r) => ({
      field: r.field ?? null,
      classification: r.classification ?? (r.isPhantom ? CLASSIFICATION.PHANTOM_83B : null),
      reason: r.reason ?? null,
      proposedValue: artifactValue(r.proposedValue),
    })),
  }));
}

async function collectRemediation({ token, db, args }) {
  const docs = new Map();
  let modelledFlagged = 0;
  const workbooks = WORKBOOKS.filter((workbook) => workbook.attorney)
    .filter((workbook) => !args.user || workbook.attorney === args.user)
    .filter((workbook) => !args.year || workbook.year === args.year);
  if (args.user && workbooks.length === 0) throw new Error(`no workbook registered for --user "${args.user}"`);

  for (const workbook of workbooks) {
    const tabsResult = await retrySheetRead(() => listTabs(token, workbook.spreadsheetId));
    if (tabsResult.blindSpot) {
      blindDoc(docs, `${workbook.key}:book`, tabsResult.blindSpot.reason);
      continue;
    }
    const userSnap = await db.doc(`users/${workbook.attorney}`).get();
    const ratesMap = buildRatesMap(userSnap.exists ? userSnap.data().rates : []);

    for (const tabName of tabsResult.tabs) {
      const tabResult = resolveTabToMonth(workbook.key, tabName);
      if (tabResult.status !== 'matched') continue;
      const { monthKey } = tabResult;
      const range = workbook.tabRange.replace('{tab}', tabName);
      const gridResult = await retrySheetRead(() => batchGet(token, workbook.spreadsheetId, [range]));
      if (gridResult.blindSpot) {
        blindDoc(docs, `${workbook.key}:${monthKey}`, gridResult.blindSpot.reason);
        continue;
      }
      const grid = gridResult.grids[range];
      const cap = capGuard(range, grid.length);
      if (cap.hit) {
        blindDoc(docs, `${workbook.key}:${monthKey}`, `range cap hit at ${cap.bound} rows`);
        continue;
      }
      const layout = resolveLayout(grid);
      if (layout.signatureId === null) {
        blindDoc(docs, `${workbook.key}:${monthKey}`, 'unrecognized tab layout');
        continue;
      }

      const summaries = resolveSummaryCells(grid, layout.headerRowIndex);
      const { columns } = layout;
      const earnings = prepareEarningsLegs({
        sheetSummary: summaries.billableEarnings?.value,
        sheetRows: columns.earnings === null ? undefined : sumColumn(grid, layout.headerRowIndex, columns.earnings),
        earningsLabel: layout.earningsLabel,
        // The summary cell (e.g. "Billable Earnings") is a separate sheet
        // location from the row-level earnings column (e.g. "Client
        // Invoice") and is not guaranteed to share its dollar system — see
        // prepareEarningsLegs' docstring. Pass its own resolved label so
        // each leg converts independently instead of double-converting an
        // already-take-home summary cell.
        summaryLabel: summaries.billableEarnings?.label,
        ratesMap,
        monthKey,
      });
      const billableEntries = earnings.isEarningsUnresolvable
        ? []
        : buildBillableEntries(grid, layout, earnings);
      const opsEntries = buildOpsEntries(grid, layout);
      const e83bEntries = buildEightThreeBEntries(grid, layout);
      const docId = monthDocId(monthKey);
      const paths = {
        billables: `users/${workbook.attorney}/billables/${docId}`,
        ops: `users/${workbook.attorney}/ops/${docId}`,
        eightThreeB: `users/${workbook.attorney}/eightThreeB/${docId}`,
      };
      const [billableSnap, opsSnap, e83bSnap] = await Promise.all(Object.values(paths).map((path) => db.doc(path).get()));
      const snapshots = { billables: billableSnap, ops: opsSnap, eightThreeB: e83bSnap };
      const entriesByDomain = { billables: billableEntries, ops: opsEntries, eightThreeB: e83bEntries };
      const docByDomain = {};
      for (const domain of Object.keys(paths)) {
        const snap = snapshots[domain];
        docByDomain[domain] = ensureDoc(docs, {
          docPath: paths[domain],
          data: snap.exists ? snap.data() : null,
          exists: snap.exists,
          replacementEntries: entriesByDomain[domain],
          monthKey,
          domain,
        });
      }

      const bDoc = docByDomain.billables;
      const bEntries = bDoc.data?.entries;
      const billableModelled = matchModelledSource({ attorney: workbook.attorney, monthKey, domain: 'billables' });
      if (billableModelled) modelledFlagged += 1;
      classifyAndAdd(bDoc, {
        field: 'hours',
        sheetSummary: summaries.totalBillableHours?.value,
        sheetRows: columns.hours === null ? undefined : sumColumn(grid, layout.headerRowIndex, columns.hours),
        fsTotals: storedTotal(bDoc.data, 'totalBillableHours'),
        fsEntries: bDoc.exists ? sumEntries(bEntries, 'hours') : undefined,
        modelledHit: billableModelled,
        sheetReadable: true,
      });
      classifyAndAdd(bDoc, {
        field: 'earnings',
        sheetSummary: earnings.sheetSummary,
        sheetRows: earnings.sheetRows,
        fsTotals: storedTotal(bDoc.data, 'billableEarnings'),
        fsEntries: bDoc.exists ? sumEntries(bEntries, 'earnings') : undefined,
        isEarningsUnresolvable: earnings.isEarningsUnresolvable,
        modelledHit: billableModelled,
        sheetReadable: true,
      });
      if (columns.clientFilingFees !== null) {
        classifyAndAdd(bDoc, {
          field: 'clientFilingFees',
          sheetSummary: summaries.clientFilingFees?.value,
          sheetRows: sumColumn(grid, layout.headerRowIndex, columns.clientFilingFees),
          fsTotals: storedTotal(bDoc.data, 'clientFilingFees'),
          fsEntries: bDoc.exists ? sumEntries(bEntries, 'clientFilingFees') : undefined,
          modelledHit: billableModelled,
          sheetReadable: true,
        });
      }
      if (earnings.isEarningsUnresolvable) {
        suppressUnsafeBillableStaleness(bDoc, 'billable entries replacement requires resolvable earnings conversion');
      } else if (earnings.labelSystem === 'CLIENT_BILLED') {
        const relabelled = convertOrSuppressClientBilledStaleness({
          results: bDoc.results,
          changes: bDoc.changes,
          summaryCellValue: earnings.sheetSummary,
          convertedEntriesSum: sumEntries(billableEntries, 'earnings'),
          ratio: earnings.ratio,
          rateInfo: earnings.rateInfo,
          eps: 0.02,
        });
        bDoc.results = relabelled.results;
        bDoc.changes = relabelled.changes;
      }

      const oDoc = docByDomain.ops;
      const oEntries = oDoc.data?.entries;
      const opsModelled = matchModelledSource({ attorney: workbook.attorney, monthKey, domain: 'ops' });
      if (opsModelled) modelledFlagged += 1;
      const sheetOpsHours = columns.opsHours === null
        ? undefined
        : sumColumn(grid, layout.headerRowIndex, columns.opsHours);
      const fsOpsHours = oDoc.exists ? sumEntries(oEntries, 'hours') : undefined;
      classifyAndAdd(oDoc, {
        field: 'opsHours',
        sheetSummary: summaries.opsHours?.value,
        sheetRows: sheetOpsHours,
        fsTotals: storedTotal(oDoc.data, 'opsHours'),
        fsEntries: fsOpsHours,
        modelledHit: opsModelled,
        sheetReadable: true,
      });
      classifyAndAdd(oDoc, {
        field: 'totalHours',
        sheetSummary: undefined,
        sheetRows: undefined,
        fsTotals: storedTotal(oDoc.data, 'totalHours'),
        fsEntries: bDoc.exists && oDoc.exists ? round2(sumEntries(bEntries, 'hours') + fsOpsHours) : undefined,
        modelledHit: opsModelled,
        sheetReadable: true,
      });

      const eDoc = docByDomain.eightThreeB;
      const eEntries = eDoc.data?.entries ?? [];
      const phantom = detectPhantomTemplateEntries(eEntries);
      if (isPhantomDeleteEligible({
        isPhantom: phantom.isPhantom,
        liveSheetEntryCount: e83bEntries.length,
      })) {
        eDoc.results.push(phantom);
        eDoc.changes.push({
          docPath: eDoc.docPath,
          field: 'entries',
          unit: UNIT.entries,
          currentValue: eEntries,
          sheetValue: e83bEntries,
          entriesSumValue: sumEntries(eEntries, 'flatFee'),
          proposedValue: [],
          classification: CLASSIFICATION.PHANTOM_83B,
          agreement: { affectedRows: phantom.affectedRows },
        });
      } else if (columns.flatFee !== null) {
        const flatFeeInput = {
          field: 'flatFee',
          sheetSummary: undefined,
          sheetRows: sumColumn(grid, layout.headerRowIndex, columns.flatFee),
          fsTotals: storedTotal(eDoc.data, 'totalFlatFees'),
          fsEntries: eDoc.exists ? sumEntries(eEntries, 'flatFee') : undefined,
          modelledHit: null,
          sheetReadable: true,
        };
        const flatFeeResult = demoteEmptyMirrorCreation(classifyField(flatFeeInput), {
          docExists: eDoc.exists,
          sheetEmpty: e83bEntries.length === 0,
          includeEmptyMirrors: args.includeEmptyMirrors,
        });
        addFieldResult(eDoc, { ...flatFeeInput, result: flatFeeResult });
      }
      void countRows(grid, layout.headerRowIndex, columns.client);
    }
  }
  return { docs, modelledFlagged };
}

function renderSummary(docMap, modelledFlagged) {
  const counts = Object.fromEntries(DOC_PRECEDENCE.map((classification) => [classification, 0]));
  const blindReasons = new Map();
  for (const doc of docMap.values()) {
    counts[rollupDocClassification(doc.results)] += 1;
    for (const r of doc.results) {
      if (r.classification !== CLASSIFICATION.BLIND_SPOT) continue;
      const key = r.reason ?? 'unknown reason';
      blindReasons.set(key, (blindReasons.get(key) ?? 0) + 1);
    }
  }
  console.log('\nDoc-level classification summary');
  for (const classification of DOC_PRECEDENCE) console.log(`  ${classification}: ${counts[classification]}`);
  console.log(`  blind spots flagged-only: ${counts[CLASSIFICATION.BLIND_SPOT]}`);
  console.log(`  modelled-window fields flagged-only: ${modelledFlagged}`);
  if (blindReasons.size) {
    console.log('\nBlind-spot reasons (doc/field-level result count, not doc count above)');
    for (const [reason, count] of [...blindReasons.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x — ${reason}`);
    }
  }
}

function appendJournalLine(path, line) {
  // appendFileSync opens, writes, and closes for every record, so a process
  // death cannot strand later journal state solely in an in-memory buffer.
  appendFileSync(path, `${JSON.stringify(line)}\n`, { encoding: 'utf8', flag: 'a' });
}

function writeDurableBackup(path, backup) {
  const json = JSON.stringify(backup, null, 2);
  const fd = openSync(path, 'w');
  try {
    writeSync(fd, json);
    // This is the last-known-good production snapshot. It must reach durable
    // storage before the first mutation, not merely the OS write buffer.
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

export async function runApplyFrom(args, db = getDb()) {
  const artifactPath = resolve(args.applyFrom);
  const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
  if (!Array.isArray(artifact?.docs)) {
    throw new Error('change-set artifact is missing the current top-level docs array; regenerate it with the current dry run before using --apply-from');
  }

  const paths = applyOutputPaths(args.out);
  const attemptedDocs = artifact.docs.filter((doc) => !args.excludeBuckets.has(doc.bucket));
  const backup = Object.fromEntries(attemptedDocs.map((doc) => [doc.docPath, doc.priorState?.data ?? null]));
  writeDurableBackup(paths.backup, backup);
  closeSync(openSync(paths.journal, 'a'));

  const counts = {
    applied: 0,
    skipped_excluded: 0,
    skipped_drifted: 0,
    failed: 0,
  };
  const journal = (doc, status, reason = null) => {
    counts[status] += 1;
    appendJournalLine(paths.journal, {
      docPath: doc.docPath,
      bucket: doc.bucket,
      op: doc.op,
      status,
      reason,
      timestamp: new Date().toISOString(),
    });
  };

  for (const doc of artifact.docs) {
    if (args.excludeBuckets.has(doc.bucket)) {
      journal(doc, 'skipped_excluded');
      continue;
    }

    try {
      const ref = db.doc(doc.docPath);
      const snap = await ref.get();
      const drift = computeDrift({
        liveExists: snap.exists,
        liveData: snap.exists ? snap.data() : null,
        priorState: doc.priorState,
        op: doc.op,
        payload: doc.payload,
      });
      if (drift.drifted) {
        journal(doc, 'skipped_drifted', drift.reason);
        continue;
      }

      // Delete is reserved for a whole phantom doc. Create uses a full,
      // frozen new-doc payload because no prior state exists. Existing docs
      // use update because the payload is intentionally partial and unrelated
      // fields must survive; update also fails if the doc disappears despite
      // the drift guard.
      if (doc.op === 'delete') await ref.delete();
      else if (doc.op === 'create') await ref.set(doc.payload, { merge: false });
      else if (doc.op === 'update') await ref.update(expandUpdatePayload(doc.payload));
      else throw new Error(`unsupported artifact op: ${doc.op}`);
      journal(doc, 'applied');
    } catch (error) {
      journal(doc, 'failed', error?.message ?? String(error));
    }
  }

  console.log('\nApply-from summary');
  for (const [status, count] of Object.entries(counts)) console.log(`  ${status}: ${count}`);
  console.log(`  journal: ${paths.journal}`);
  return { counts, paths };
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadEnvFile(new URL('../.env.local', import.meta.url).pathname);
  if (args.applyFrom) {
    return runApplyFrom(args);
  }

  const key = loadKey();
  const token = await getAccessToken(key);
  const db = getDb();
  const { docs, modelledFlagged } = await collectRemediation({ token, db, args });
  const fields = serializeChanges(docs);
  const applyDocs = serializeDocsForApply(docs);
  const artifact = {
    meta: {
      generatedAt: new Date().toISOString(),
      args: {
        user: args.user,
        year: args.year,
        includeEmptyMirrors: args.includeEmptyMirrors,
      },
      tool: 'remediate-sheet-parity',
    },
    fields,
    docs: applyDocs,
  };
  const backups = Object.fromEntries([...docs.values()]
    .filter((doc) => doc.changes.length > 0)
    .map((doc) => [doc.docPath, doc.data]));
  const paths = outputPaths(args.out);

  const coverage = serializeCoverage(docs);
  writeFileSync(paths.changeset, JSON.stringify(artifact, null, 2));
  writeFileSync(paths.backup, JSON.stringify(backups, null, 2));
  writeFileSync(paths.coverage, JSON.stringify(coverage, null, 2));
  console.log(`wrote change-set: ${paths.changeset}`);
  console.log(`wrote backup: ${paths.backup}`);
  console.log(`wrote coverage: ${paths.coverage}`);

  console.log('DRY RUN: no Firestore mutation calls were made');
  renderSummary(docs, modelledFlagged);
  return { artifact, fields, docs: applyDocs, backups, paths };
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(`FATAL — remediation aborted: ${error?.message ?? error}`);
    process.exitCode = 1;
  });
}
