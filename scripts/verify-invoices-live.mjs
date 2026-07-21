#!/usr/bin/env node
// LIVE parity verification for the "Invoices (testing)" tab.
//
// Fetches the Invoices (2026) workbook read-only (same ranges, render options,
// and assembly as /api/invoices-workbook), then re-runs every relationship the
// tab's calc chain (src/utils/invoicesCalc.mjs) guarantees and compares each
// derived value against the sheet's own evaluated cells — the live-data
// counterpart of tests/invoices-workbook-verify.test.mjs, which runs the same
// checks against the frozen snapshot.
//
// READ-ONLY: spreadsheets.readonly scope, no Firestore access, no writes.
// Usage: node scripts/verify-invoices-live.mjs [--verbose]
// Exit codes: 0 all checks pass; 1 at least one mismatch.

import { createSign } from 'node:crypto';
import { loadEnvFile } from './lib/env.mjs';
import {
  WORKBOOK_ID, RANGES, assembleWorkbook,
} from '../src/utils/invoicesSheetRanges.mjs';
import {
  computeMonthlyWaterfall, computeCashProfits, computeQuarterRevenue,
  computeRowSumBillables, sumWhereMonth, derivePnlNetIncome,
} from '../src/utils/invoicesCalc.mjs';

loadEnvFile(new URL('../.env.local', import.meta.url).pathname);
const VERBOSE = process.argv.includes('--verbose');

// --- auth (same key fallback chain as the API route) ------------------------
function loadKey() {
  for (const name of ['GOOGLE_SERVICE_ACCOUNT_KEY', 'FIREBASE_SERVICE_ACCOUNT_KEY']) {
    if (process.env[name]) return JSON.parse(process.env[name]);
  }
  throw new Error('no service-account key (GOOGLE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT_KEY)');
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

async function getAccessToken(key) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({
    iss: key.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token;
}

// --- fetch (mirrors the API route: skip ranges whose tab no longer exists) --
async function fetchGrids(token) {
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${WORKBOOK_ID}?fields=sheets.properties.title`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const meta = await metaRes.json();
  if (!metaRes.ok) throw new Error(`spreadsheets.get failed: ${JSON.stringify(meta.error)}`);
  const tabs = new Set(meta.sheets.map((s) => s.properties.title));
  const tabOf = (range) => range.slice(1, range.indexOf("'!", 1));
  const live = RANGES.filter((r) => tabs.has(tabOf(r.range)));
  const skipped = RANGES.filter((r) => !tabs.has(tabOf(r.range)));
  const qs = live.map((r) => `ranges=${encodeURIComponent(r.range)}`).join('&')
    + '&valueRenderOption=UNFORMATTED_VALUE';
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${WORKBOOK_ID}/values:batchGet?${qs}`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`values.batchGet failed: ${JSON.stringify(data.error)}`);
  const grids = {};
  live.forEach((r, i) => { grids[r.key] = data.valueRanges[i].values || []; });
  return { grids, skipped: skipped.map((r) => r.key) };
}

// --- diff-reporting harness --------------------------------------------------
const failures = [];
let checks = 0;
const near = (actual, expected, label, eps = 0.02) => {
  checks += 1;
  if (Math.abs((actual ?? 0) - (expected ?? 0)) > eps) {
    failures.push({ label, computed: actual, sheet: expected });
  } else if (VERBOSE) {
    console.log(`  ok  ${label}  ${expected}`);
  }
};

const key = loadKey();
console.log(`workbook ${WORKBOOK_ID} as ${key.client_email}`);
const token = await getAccessToken(key);
const { grids, skipped } = await fetchGrids(token);
if (skipped.length) console.log(`(skipped missing tabs: ${skipped.join(', ')})`);
// No-silent-caps guard: a grid that fills its entire requested window means the
// tab's data likely continues past the range bound — widen the range in RANGES.
for (const r of RANGES) {
  const grid = grids[r.key];
  if (!grid) continue;
  const bound = Number((r.range.match(/(\d+)$/) || [])[1]);
  checksCapGuard(r.key, r.range, grid.length, bound);
}
function checksCapGuard(key, range, got, bound) {
  checks += 1;
  if (bound && got >= bound) {
    failures.push({ label: `range cap hit: ${key} (${range})`, computed: `${got} rows returned`, sheet: `< ${bound} expected` });
  }
}

const wb = assembleWorkbook(grids, { fetchedAt: new Date().toISOString() });
console.log(`assembled live workbook — months: ${Object.keys(wb.months).join(', ')}\n`);

const DERIVED_WF_KEYS = ['gross', 'netAccrued', 'revenueAccrued', 'cgfDonation',
  'revenueMinusCgf', 'netRevenueBeforeOpEx', 'firmProfits'];

// 1. Monthly waterfall: recompute B2–B16 from inputs, diff vs the sheet's cells.
for (const [m, entry] of Object.entries(wb.months)) {
  const errs = entry.sheetErrors || {};
  const wf = computeMonthlyWaterfall(entry.inputs);
  for (const k of DERIVED_WF_KEYS) if (!errs[k]) near(wf[k], entry.sheet[k], `waterfall ${m}.${k}`);
  for (const k of Object.keys(entry.inputs)) if (!errs[k]) near(wf[k], entry.sheet[k], `waterfall ${m}.${k} (input round-trip)`);
  if (Object.keys(errs).length) console.log(`  note: ${m} sheet errors on [${Object.keys(errs).join(', ')}] — skipped those cells`);
}

// 2. Matrix: column totals feed the waterfall inputs; per-row Sum Billables law.
const MATRIX_LINKS = [
  ['sumBillables', 'attorneyBillables'], ['elections83b', 'flatFee83b'],
  ['filingFees', 'filingFees'], ['outsideCounsel', 'outsideCounsel'],
  ['deferredThisMonth', 'deferred'], ['writeOff', 'writeOffs'],
];
for (const [m, entry] of Object.entries({ ...wb.months, ...(wb.monthsExtra || {}) })) {
  if (!entry.matrix) continue;
  const errs = entry.sheetErrors || {};
  const S = (f) => entry.matrix.rows.reduce((s, r) => s + (r[f] || 0), 0);
  for (const [field, input] of MATRIX_LINKS) {
    if (!errs[input]) near(S(field), entry.inputs[input], `matrix ${m}: Σ${field} → ${input}`);
  }
  let overrides = 0;
  for (const r of entry.matrix.rows) {
    const expect = computeRowSumBillables(r.billings, r.priorDeferred, r.priorToggle);
    if (Math.abs((r.sumBillables || 0) - expect) > 0.01) {
      if (r.sumBillables === 0) { overrides += 1; continue; } // blanked-L manual override
      failures.push({ label: `matrix ${m} row "${r.client}": Sum Billables law`, computed: expect, sheet: r.sumBillables });
    }
    checks += 1;
  }
  if (overrides > 2) failures.push({ label: `matrix ${m}: manual overrides`, computed: overrides, sheet: '≤2 expected' });

  if (entry.attorneyTable?.headers?.includes('Billable Earnings') && !errs.attorneyPayout) {
    const idx = entry.attorneyTable.headers.indexOf('Billable Earnings');
    const sum = entry.attorneyTable.rows.reduce((s, r) => s + (typeof r.vals[idx] === 'number' ? r.vals[idx] : 0), 0);
    near(sum, entry.inputs.attorneyPayout, `attorney table ${m}: Σ Billable Earnings → attorneyPayout (B13)`);
  }
}

// 3. Cash Accounting: Profits formula, Revenue link, quarter revenue.
const cashKeys = Object.keys(wb.cash);
for (const m of cashKeys) {
  const { inputs, sheet } = wb.cash[m];
  near(computeCashProfits(inputs), sheet.profits, `cash ${m}.profits`);
  if (wb.months[m]) near(wb.months[m].sheet.revenueAccrued, sheet.revenue, `cash ${m}.revenue = ${m}!B10 link`);
}
cashKeys.forEach((m, i) => {
  const q = wb.cash[m].sheet.qRevenue;
  if (q == null || i < 2) return;
  const rev = (k) => wb.cash[k].sheet.revenue;
  near(computeQuarterRevenue([rev(cashKeys[i - 2]), rev(cashKeys[i - 1]), rev(m)]), q, `cash ${m}.qRevenue`);
});

// 4. Payment register: SUM(amounts) reproduces B1; SUMIFS reproduces Cash Received.
if (wb.paymentRegister) {
  near(wb.paymentRegister.reduce((s, r) => s + r.amount, 0), wb.paymentTotal, 'payment register: Σamount → B1');
  const rows = wb.paymentRegister.map((r) => ({
    ...r,
    dateReceived: r.dateReceived ? new Date(`${r.dateReceived}T00:00:00`) : null,
  }));
  cashKeys.forEach((m, i) => {
    near(sumWhereMonth(rows, 'dateReceived', 'amount', i, 2026), wb.cash[m].inputs.cashReceived,
      `cash ${m}.cashReceived = SUMIFS(register by Date Received)`);
  });
}
if (wb.paymentRegisterCopy?.length) {
  near(wb.paymentRegisterCopy.reduce((s, r) => s + r.amount, 0), wb.paymentTotalCopy, '06/30 register copy: Σamount → B1');
}

// 5. P&L: recompute the section totals + NET INCOME from the line inputs and
//    diff against the sheet's own TOTAL rows (rows 5/40/45/47), per month.
if (wb.pnl?.lines?.revenue) {
  const L = wb.pnl.lines;
  const nMonths = L.revenue.length;
  const consultants = Object.values(wb.pnl.consultants || {});
  for (let i = 0; i < nMonths; i += 1) {
    const lineSum = (keys) => keys.reduce((s, k) => s + ((L[k] || [])[i] || 0), 0);
    const totalExp = lineSum(['software', 'malpractice', 'franchiseTaxes', 'filingFees',
      'reimbursements', 'misc', 'outsideCounsel', 'attorneys', 'payrollTaxes'])
      + consultants.reduce((s, arr) => s + (arr[i] || 0), 0);
    const cgf = lineSum(['charitable', 'cedarGrove']);
    near(L.revenue[i], wb.pnl.sheet.totalRevenue[i], `pnl month[${i}] TOTAL REVENUE`);
    near(totalExp, wb.pnl.sheet.totalExpenses[i], `pnl month[${i}] TOTAL EXPENSES`);
    near(cgf, wb.pnl.sheet.cgfTotal[i], `pnl month[${i}] CGF total`);
    near(derivePnlNetIncome(L.revenue[i], totalExp, cgf), wb.pnl.sheet.netIncome[i], `pnl month[${i}] NET INCOME`);
  }
}

// --- report -------------------------------------------------------------------
console.log(`\n${checks} checks, ${failures.length} mismatches`);
if (failures.length) {
  console.log('\nMISMATCHES (computed by site calc chain vs live sheet cell):');
  for (const f of failures) {
    console.log(`  FAIL ${f.label}\n       site=${JSON.stringify(f.computed)} sheet=${JSON.stringify(f.sheet)}`);
  }
  process.exit(1);
}
console.log('CONFIRMED: the Invoices (testing) calc chain reproduces every checked live-sheet value.');
