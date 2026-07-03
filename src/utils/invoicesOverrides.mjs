// Local "what-if" sandbox for the Invoices (testing) tab. Pure + Node-importable
// (tested). Given a REAL_WORKBOOK-shaped object and a flat map of cell overrides,
// resolveWorkbook returns a NEW workbook with every override applied and every
// derived value recomputed through the same calc chain the sheet uses — plus a
// per-cell meta map so the UI can badge edited / pinned / changed cells.
//
// Overrides live only in React state; nothing here is ever persisted, and a
// refresh discards them. This module never touches the network or the sheet.
//
// ---------------------------------------------------------------------------
// Cell-key scheme (stable string paths; documented once here):
//   wf|<monthKey>|<cell>        waterfall cell — <cell> is an input OR derived
//                               key from WF_ORDER. Overriding an input sets it
//                               absolutely; overriding a derived cell PINS it
//                               (Excel type-over-formula: frozen vs upstream,
//                               still feeds downstream).
//   mx|<monthKey>|<rowIdx>|b<j> matrix client-billing cell (attorney column j)
//   mx|<monthKey>|<rowIdx>|<f>  matrix numeric tail field (e.g. filingFees)
//   cash|<monthKey>|<field>     Cash Accounting input (cashReceived/expenses/
//                               cgfDonation/attorneyPayout)
//   reg|<rowIdx>|amount         Payment Status register amount
// ---------------------------------------------------------------------------

import {
  computeCashProfits,
  computePaymentTotal,
  computeRowSumBillables,
  sumColumn,
} from './invoicesCalc.mjs';

export const wfKey = (month, cell) => `wf|${month}|${cell}`;
export const mxBillKey = (month, row, j) => `mx|${month}|${row}|b${j}`;
export const mxFieldKey = (month, row, field) => `mx|${month}|${row}|${field}`;
export const cashKey = (month, field) => `cash|${month}|${field}`;
export const regKey = (row) => `reg|${row}|amount`;
export const expKey = (row, month) => `exp|${row}|${month}`;

// Expenses V2 P&L tag → the P&L line it feeds (the SUMIF target). Names in
// PNL_CONSULTANTS map to the per-consultant lines instead.
const PNL_TAG_TO_KEY = {
  'Software & Technology': 'software', 'Malpractice Insurance': 'malpractice', 'Franchise Taxes': 'franchiseTaxes',
  'Filing Fees': 'filingFees', Reimbursements: 'reimbursements', 'Misc Expenses': 'misc',
  'Outside Counsel': 'outsideCounsel', 'Payroll Taxes': 'payrollTaxes',
  'Charitable Donations': 'charitable', 'Cedar Grove Foundation': 'cedarGrove',
};
const PNL_CONSULTANTS = new Set(['Valyria', 'Valery Uscanga', 'Martyna Skrodzka', 'Nick Agate', 'David Popkin', 'Paige Wilson', 'Accountants']);

// Waterfall resolution order: inputs first, then derived (each formula reads the
// already-resolved earlier cells, so a pin on a middle cell propagates downward).
export const WF_INPUTS = ['attorneyBillables', 'flatFee83b', 'filingFees', 'outsideCounsel', 'writeOffs', 'deferred', 'attorneyPayout', 'opEx'];
const WF_DERIVED = ['gross', 'netAccrued', 'revenueAccrued', 'cgfDonation', 'revenueMinusCgf', 'netRevenueBeforeOpEx', 'firmProfits'];
export const WF_ORDER = [...WF_INPUTS, ...WF_DERIVED];
const WF_FORMULA = {
  gross: (v) => v.attorneyBillables + v.flatFee83b + v.filingFees + v.outsideCounsel,
  netAccrued: (v) => v.gross - v.writeOffs - v.filingFees - v.outsideCounsel,
  revenueAccrued: (v) => v.netAccrued - v.deferred,
  cgfDonation: (v) => v.revenueAccrued * 0.1,
  revenueMinusCgf: (v) => v.revenueAccrued - v.cgfDonation,
  netRevenueBeforeOpEx: (v) => v.revenueMinusCgf - v.attorneyPayout,
  firmProfits: (v) => v.netRevenueBeforeOpEx - v.opEx,
};

// Matrix column → the waterfall input it feeds (B4=Σ Sum Billables, etc.).
const COL_TO_INPUT = {
  attorneyBillables: (rows) => sumColumn(rows.map((r) => computeRowSumBillables(r.billings, r.priorDeferred, r.priorToggle))),
  flatFee83b: (rows) => sumColumn(rows.map((r) => r.elections83b)),
  filingFees: (rows) => sumColumn(rows.map((r) => r.filingFees)),
  outsideCounsel: (rows) => sumColumn(rows.map((r) => r.outsideCounsel)),
  writeOffs: (rows) => sumColumn(rows.map((r) => r.writeOff)),
  deferred: (rows) => sumColumn(rows.map((r) => r.deferredThisMonth)),
};

const clone = (o) => (typeof structuredClone === 'function' ? structuredClone(o) : JSON.parse(JSON.stringify(o)));
const monthNameToIndex = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
// The Cash Accounting Summary tracks the current invoice year; its Cash Received
// SUMIFS only counts payments received within this year (see sumWhereMonth).
const CASH_YEAR = 2026;

// Resolve one month's matrix + waterfall. Returns the effective inputs, the
// resolved (pinned) waterfall, and meta entries.
function resolveMonth(monthKey, entry, overrides, meta) {
  const hasMatrix = !!entry.matrix;
  const originalRows = hasMatrix ? entry.matrix.rows : [];
  const rows = hasMatrix ? clone(entry.matrix.rows) : [];

  // Apply matrix overrides (billings + numeric tail fields) and recompute the
  // edited row's Sum Billables (Σ attorney cols + billed prior deferrals).
  if (hasMatrix) {
    rows.forEach((row, ri) => {
      let billingChanged = false;
      row.billings.forEach((_, j) => {
        const k = mxBillKey(monthKey, ri, j);
        if (k in overrides) { row.billings[j] = overrides[k]; billingChanged = true; meta.set(k, { state: 'edited', base: originalRows[ri].billings[j], value: overrides[k] }); }
      });
      for (const field of ['elections83b', 'filingFees', 'outsideCounsel', 'writeOff', 'deferredThisMonth', 'priorDeferred']) {
        const k = mxFieldKey(monthKey, ri, field);
        if (k in overrides) { row[field] = overrides[k]; meta.set(k, { state: 'edited', base: originalRows[ri][field], value: overrides[k] }); }
      }
      if (billingChanged || mxFieldKey(monthKey, ri, 'priorDeferred') in overrides) {
        row.sumBillables = computeRowSumBillables(row.billings, row.priorDeferred, row.priorToggle);
      }
    });
  }

  // Effective waterfall inputs = stored inputs + matrix-driven deltas. The delta
  // (recompute overridden − recompute original) preserves the sheet's stored
  // base, including any manual Sum-Billables overrides.
  const effInputs = { ...entry.inputs };
  if (hasMatrix) {
    for (const [input, fn] of Object.entries(COL_TO_INPUT)) {
      const delta = fn(rows) - fn(originalRows);
      if (Math.abs(delta) > 1e-9) effInputs[input] += delta;
    }
  }
  // Direct waterfall-input overrides win absolutely.
  for (const cell of WF_INPUTS) {
    const k = wfKey(monthKey, cell);
    if (k in overrides) { effInputs[cell] = overrides[k]; meta.set(k, { state: 'edited', base: entry.inputs[cell], value: overrides[k] }); }
  }

  // Resolve the waterfall in dependency order, honoring pins on derived cells.
  const base = resolveWaterfallValues(entry.inputs, {}); // baseline (no overrides) for delta display
  const values = resolveWaterfallValues(effInputs, overrides, monthKey, meta, base);

  return { inputs: effInputs, waterfall: values, rows };
}

// Walk WF_ORDER: inputs come from `inputs`; derived come from their formula,
// unless pinned by an override (then the pin value is used and still feeds
// downstream). Records meta for pinned + derived-changed cells.
function resolveWaterfallValues(inputs, overrides, monthKey, meta, base) {
  const v = {};
  for (const cell of WF_ORDER) {
    const isDerived = cell in WF_FORMULA;
    const k = monthKey ? wfKey(monthKey, cell) : null;
    if (isDerived && k && k in overrides) {
      v[cell] = overrides[k];
      if (meta) meta.set(k, { state: 'pinned', base: base ? base[cell] : undefined, value: overrides[k] });
    } else if (isDerived) {
      v[cell] = WF_FORMULA[cell](v);
      if (meta && base && Math.abs(v[cell] - base[cell]) > 1e-9 && !meta.has(k)) {
        meta.set(k, { state: 'derived-changed', base: base[cell], value: v[cell] });
      }
    } else {
      v[cell] = inputs[cell] || 0;
    }
  }
  return v;
}

// resolveWorkbook — apply all overrides across the workbook; return the new
// workbook + a Map(cellKey → { state, base, value }).
export function resolveWorkbook(workbook, overrides = {}) {
  const wb = clone(workbook);
  const meta = new Map();
  const keys = Object.keys(overrides || {});
  const hasAny = keys.length > 0;
  if (!hasAny) return { workbook: wb, meta };

  // Months (+ frozen extra copies) — matrix + waterfall.
  const allMonths = [
    ...Object.keys(wb.months || {}).map((k) => ['months', k]),
    ...Object.keys(wb.monthsExtra || {}).map((k) => ['monthsExtra', k]),
  ];
  for (const [bucket, key] of allMonths) {
    const entry = wb[bucket][key];
    const touched = keys.some((k) => k.startsWith(`wf|${key}|`) || k.startsWith(`mx|${key}|`));
    if (!touched) continue;
    const { inputs, waterfall, rows } = resolveMonth(key, entry, overrides, meta);
    entry.inputs = inputs;
    entry.resolvedWaterfall = waterfall;
    if (entry.matrix) entry.matrix.rows = rows;
    // Reflect the resolved derived cells into the cached `sheet` too (keeps the
    // workbook internally consistent for any consumer reading `.sheet`).
    if (entry.sheet) for (const cell of WF_ORDER) entry.sheet[cell] = waterfall[cell];
  }

  // Register amounts → total + (cross-tab) that month's Cash Received.
  const cashReceivedDelta = {}; // monthIndex → delta
  if (wb.paymentRegister && keys.some((k) => k.startsWith('reg|'))) {
    wb.paymentRegister.forEach((row, ri) => {
      const k = regKey(ri);
      if (k in overrides) {
        const base = row.amount;
        row.amount = overrides[k];
        meta.set(k, { state: 'edited', base, value: overrides[k] });
        if (row.dateReceived) {
          // Bucket the delta into that month's Cash Received, matching the
          // sheet's SUMIFS which is scoped to the current (2026) cash year —
          // 2025-dated payments must NOT move a 2026 cash month. Accept both an
          // ISO string (raw workbook) and a Date (parsed dataset).
          const d = row.dateReceived instanceof Date ? row.dateReceived : new Date(`${row.dateReceived}T00:00:00`);
          if (!Number.isNaN(d.getTime()) && d.getFullYear() === CASH_YEAR) {
            const monthIdx = d.getMonth();
            cashReceivedDelta[monthIdx] = (cashReceivedDelta[monthIdx] || 0) + (row.amount - base);
          }
        }
      }
    });
    wb.paymentTotal = computePaymentTotal(wb.paymentRegister.map((r) => r.amount));
  }

  // Cash inputs (direct overrides) + register-driven Cash Received deltas.
  const cashMonths = Object.keys(wb.cash || {});
  cashMonths.forEach((mKey) => {
    const c = wb.cash[mKey];
    const mi = monthNameToIndex[mKey];
    let changed = false;
    for (const field of ['cashReceived', 'expenses', 'cgfDonation', 'attorneyPayout']) {
      const k = cashKey(mKey, field);
      if (k in overrides) { const base = c.inputs[field]; c.inputs[field] = overrides[k]; meta.set(k, { state: 'edited', base, value: overrides[k] }); changed = true; }
    }
    if (cashReceivedDelta[mi]) { c.inputs.cashReceived += cashReceivedDelta[mi]; changed = true; }
    if (changed) c.sheet.profits = computeCashProfits(c.inputs);
  });

  // Expenses V2 edits → the P&L expense/consultant line they're tagged to
  // (delta only, so the cached baseline — which for CGF isn't a pure SUMIF —
  // is preserved and only the user's change flows to TOTAL EXPENSES → NET
  // INCOME). Expense lines only cover Jan–Jun on the P&L; later-month edits
  // show on the Expenses tab but don't reach the (6-column) P&L.
  if (wb.expenses && keys.some((k) => k.startsWith('exp|'))) {
    const lineDelta = {}; // `${lineKey|consultantName}|${m}` → delta
    wb.expenses.forEach((row, ri) => {
      row.vals.forEach((v, m) => {
        const k = expKey(ri, m);
        if (k in overrides) {
          const base = row.vals[m];
          row.vals[m] = overrides[k];
          meta.set(k, { state: 'edited', base, value: overrides[k] });
          const tag = row.pnlCat;
          if (tag) { const t = `${tag}|${m}`; lineDelta[t] = (lineDelta[t] || 0) + (overrides[k] - base); }
        }
      });
    });
    if (wb.pnl && wb.pnl.lines) {
      for (const [t, delta] of Object.entries(lineDelta)) {
        const sep = t.lastIndexOf('|');
        const tag = t.slice(0, sep);
        const m = Number(t.slice(sep + 1));
        const lineKey = PNL_TAG_TO_KEY[tag];
        if (lineKey && Array.isArray(wb.pnl.lines[lineKey]) && m < wb.pnl.lines[lineKey].length) {
          wb.pnl.lines[lineKey][m] += delta;
        } else if (PNL_CONSULTANTS.has(tag) && wb.pnl.consultants && Array.isArray(wb.pnl.consultants[tag]) && m < wb.pnl.consultants[tag].length) {
          wb.pnl.consultants[tag][m] += delta;
        }
      }
    }
  }

  return { workbook: wb, meta };
}
