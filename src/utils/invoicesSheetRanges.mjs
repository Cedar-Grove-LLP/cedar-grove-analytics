// Range manifest + pure assembler for the LIVE read of the Cedar Grove
// "Invoices (2026)" Google Sheet. This is the JS port of
// scripts/extract-invoices-workbook.py — given the raw value grids returned by
// the Sheets API `values.batchGet` (valueRenderOption=UNFORMATTED_VALUE), it
// produces the exact same shape as the frozen `REAL_WORKBOOK` object so the
// dashboard tab + tests can consume live and frozen data identically.
//
// READ-ONLY: this module only describes ranges to READ; it never mutates.
// Numeric parity with the Python extractor is guaranteed by round-to-6-decimals
// and the same region layout (waterfall A1:B16, attorney table row 1 anchored
// at "Attorney", client matrix header row 20 / data rows 21+, etc).

export const WORKBOOK_ID = '1Qkqc4zsqMzP9lN4qTYiDpdJEbQAWQq88j3p23SVxNq8';

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july'];
const SHEET_NAME = {
  january: 'January', february: 'February', march: 'March', april: 'April',
  may: 'May', june: 'June', july: 'July',
};
const EXTRA_MONTHS = { 'june-original': 'June - original' };
const CASH_MONTHS = ['january', 'february', 'march', 'april', 'may', 'june'];

// Monthly tab column B rows 2..16, in order (matches invoicesCalc WATERFALL_ROWS).
const WF_KEYS = [
  'gross', 'writeOffs', 'attorneyBillables', 'flatFee83b', 'filingFees',
  'outsideCounsel', 'netAccrued', 'deferred', 'revenueAccrued', 'cgfDonation',
  'revenueMinusCgf', 'attorneyPayout', 'netRevenueBeforeOpEx', 'opEx', 'firmProfits',
];
const WF_INPUT_KEYS = [
  'attorneyBillables', 'flatFee83b', 'filingFees', 'outsideCounsel',
  'writeOffs', 'deferred', 'attorneyPayout', 'opEx',
];

// Month-tab matrix: header-row-20 tail columns → dataset field names.
const MATRIX_FIELD = {
  'Sum Billables': 'sumBillables', '83(b) Elections': 'elections83b', 'Filing Fees': 'filingFees',
  'Fees Notes': 'feesNotes', 'Outside Counsel': 'outsideCounsel', 'Outside Counsel Notes': 'ocNotes',
  'Prior Deferred': 'priorDeferred', 'Prior Deferral Toggle': 'priorToggle',
  'Deferred This Month': 'deferredThisMonth', 'Total Deferred': 'totalDeferred',
  'Write Off': 'writeOff', 'Invoiced': 'invoiced', 'General Notes': 'generalNotes',
  'Contact Name': 'contactName', 'Contact Email': 'contactEmail', 'Payment Terms': 'paymentTerms',
};
const MATRIX_NUMERIC = new Set(['sumBillables', 'elections83b', 'filingFees', 'outsideCounsel',
  'priorDeferred', 'deferredThisMonth', 'totalDeferred', 'writeOff', 'invoiced']);
const MATRIX_TEXT = new Set(['feesNotes', 'ocNotes', 'priorToggle', 'generalNotes', 'contactName', 'contactEmail']);

// P&L line rows (1-indexed sheet rows) → dataset keys. Values cols B..G (Jan-Jun).
const PNL_LINE_ROWS = {
  revenue: 4, software: 9, malpractice: 12, franchiseTaxes: 13, filingFees: 14,
  reimbursements: 17, misc: 20, outsideCounsel: 23, attorneys: 26, payrollTaxes: 38,
  charitable: 43, cedarGrove: 44,
};
const PNL_CONSULTANT_ROWS = {
  Valyria: 29, 'Valery Uscanga': 30, 'Martyna Skrodzka': 31, 'Nick Agate': 32,
  'David Popkin': 33, 'Paige Wilson': 34, Accountants: 35,
};
const PNL_SHEET_ROWS = { totalRevenue: 5, totalExpenses: 40, cgfTotal: 45, netIncome: 47 };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

// ---------------------------------------------------------------------------
// The list of ranges to fetch. One big block per month tab (covers waterfall,
// attorney table, and matrix); one block per report tab. Order matters — the
// route zips batchGet's valueRanges back to these keys by index.
// ---------------------------------------------------------------------------
export const RANGES = [
  ...MONTHS.map((m) => ({ key: `month:${m}`, range: `'${SHEET_NAME[m]}'!A1:AB200` })),
  ...Object.entries(EXTRA_MONTHS).map(([k, name]) => ({ key: `monthExtra:${k}`, range: `'${name}'!A1:AB200` })),
  { key: 'cash', range: "'Cash Accounting Summary'!A1:H12" },
  { key: 'pnl', range: "'P&L'!A1:H50" },
  { key: 'paymentStatus', range: "'Payment Status'!A1:H2000" },
  // NB: the live Google tab is "06/30 Copy of Payment Status" (with a slash);
  // the xlsx export sanitized it to "0630..." (Excel forbids "/" in tab names).
  { key: 'paymentStatusCopy', range: "'06/30 Copy of Payment Status'!A1:H2000" },
  { key: 'profitsPaid', range: "'Profits Paid (Sam)'!A1:D200" },
  { key: 'rateSheet', range: "'Rate Sheet'!A1:H22" },
  { key: 'expenses', range: "'Expenses V2'!A1:O200" },
  { key: 'balanceSheet', range: "'Balance Sheet'!A1:C41" },
];

// ---------------------------------------------------------------------------
// Cell helpers — 1-based (to mirror the openpyxl-based Python extractor line
// for line). A Sheets API grid omits trailing empty cells/rows, so out-of-range
// reads return null.
// ---------------------------------------------------------------------------
const cellAt = (grid, row1, col1) => {
  const r = grid[row1 - 1];
  if (!r) return null;
  const v = r[col1 - 1];
  return v === undefined ? null : v;
};
const isBlank = (v) => v === null || v === undefined || v === '';
const round6 = (v) => Math.round(v * 1e6) / 1e6;
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? round6(v) : 0.0);
const isErr = (v) => typeof v === 'string' && v.startsWith('#');

// raw value — matches the extractor's raw_val (bool passthrough, number rounded,
// else string|null). No date columns pass through here.
const rawVal = (v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return round6(v);
  return v == null ? null : String(v);
};

// Sheets serial date (days since 1899-12-30) → ISO "YYYY-MM-DD".
export const serialToISO = (n) => {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const ms = Math.round((n - 25569) * 86400000);
  return new Date(ms).toISOString().slice(0, 10);
};
// Date cell → ISO string (register uses this; matches extractor's ISO output).
const toISO = (v) => {
  if (isBlank(v)) return null;
  if (typeof v === 'number') return serialToISO(v);
  return String(v);
};
// Profits Paid date column formats as MM-DD-YYYY in the extractor.
const toMDY = (v) => {
  if (typeof v !== 'number') return v == null ? '' : String(v);
  const iso = serialToISO(v);
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${m}-${d}-${y}`;
};
// Profits Paid note column: a date cell displays as "Month YYYY"; otherwise text.
// A bare serial in the plausible-date range is treated as a date (the note
// column holds either free text or a month marker, never a dollar amount —
// amounts live in col C).
const displayNote = (v) => {
  if (v == null) return '';
  if (typeof v === 'number' && v >= 40000 && v <= 60000) {
    const iso = serialToISO(v);
    if (iso) {
      const [y, m] = iso.split('-').map(Number);
      return `${MONTH_NAMES[m - 1]} ${y}`;
    }
  }
  return String(v);
};

// ---------------------------------------------------------------------------
// Per-region extractors (ported 1:1 from the Python extractor).
// ---------------------------------------------------------------------------
function extractMonthTab(grid) {
  const colB = {};
  const errors = {};
  WF_KEYS.forEach((k, i) => {
    const v = cellAt(grid, i + 2, 2); // rows 2..16, col B
    if (isErr(v)) { errors[k] = v; colB[k] = 0.0; } else { colB[k] = num(v); }
  });
  const inputs = {};
  WF_INPUT_KEYS.forEach((k) => { inputs[k] = colB[k]; });
  const month = { inputs, sheet: colB, sheetErrors: errors };

  // Attorney rate table — header row 1, anchored at the 'Attorney' cell.
  let start = null;
  for (let c = 2; c < 30; c += 1) {
    if (cellAt(grid, 1, c) === 'Attorney') { start = c; break; }
  }
  const table = { headers: [], rows: [] };
  if (start) {
    let c = start + 1;
    while (!isBlank(cellAt(grid, 1, c))) { table.headers.push(String(cellAt(grid, 1, c))); c += 1; }
    let r = 2;
    while (!isBlank(cellAt(grid, r, start))) {
      table.rows.push({
        name: String(cellAt(grid, r, start)),
        vals: table.headers.map((_, k) => rawVal(cellAt(grid, r, start + 1 + k))),
      });
      r += 1;
    }
  }
  month.attorneyTable = table;

  // Client billings matrix — header row 20, data rows 21+.
  const headers = [];
  let c = 1;
  while (!isBlank(cellAt(grid, 20, c))) { headers.push(String(cellAt(grid, 20, c))); c += 1; }
  if (headers.includes('Sum Billables')) {
    const sb = headers.indexOf('Sum Billables');
    const attorneys = headers.slice(1, sb);
    const rows = [];
    let totalRows = 0;
    let r = 21;
    while (!isBlank(cellAt(grid, r, 1))) {
      totalRows += 1;
      const billings = attorneys.map((_, j) => num(cellAt(grid, r, 2 + j)));
      const obj = { client: String(cellAt(grid, r, 1)), billings };
      for (let k = sb; k < headers.length; k += 1) {
        const field = MATRIX_FIELD[headers[k]];
        if (!field) continue;
        const v = cellAt(grid, r, k + 1);
        if (MATRIX_NUMERIC.has(field)) obj[field] = num(v);
        else if (MATRIX_TEXT.has(field)) obj[field] = v == null ? '' : displayNote(v);
        else obj[field] = rawVal(v);
      }
      const anyBill = billings.some((x) => x);
      const anyNum = [...MATRIX_NUMERIC].some((f) => obj[f]);
      if (anyBill || anyNum) rows.push(obj);
      r += 1;
    }
    month.matrix = { attorneys, rows, totalRows };
  }
  return month;
}

function extractRegister(grid) {
  const register = [];
  const maxRow = grid.length;
  for (let r = 2; r <= maxRow; r += 1) {
    const client = cellAt(grid, r, 1);
    const amount = cellAt(grid, r, 2);
    if (client == null && amount == null) continue;
    const y = cellAt(grid, r, 3);
    register.push({
      client: String(client || ''),
      amount: num(amount),
      year: typeof y === 'number' ? Math.trunc(y) : null,
      dateSent: toISO(cellAt(grid, r, 4)),
      status: String(cellAt(grid, r, 5) || ''),
      lastReminder: toISO(cellAt(grid, r, 6)),
      dateReceived: toISO(cellAt(grid, r, 7)),
      notes: String(cellAt(grid, r, 8) || ''),
    });
  }
  return register;
}

// ---------------------------------------------------------------------------
// assembleWorkbook — turn the keyed grids into a REAL_WORKBOOK-shaped object.
// opts.fetchedAt sets extractedOn; opts.profitHighlights (Map keyed by
// `${date}|${amount}`) restores the Profits Paid cell fills the values API
// can't return.
// ---------------------------------------------------------------------------
export function assembleWorkbook(gridsByKey, opts = {}) {
  const g = (key) => gridsByKey[key] || [];
  const out = {
    source: opts.source || 'Cedar Grove LLP - Invoices (2026) [live]',
    extractedOn: opts.fetchedAt || null,
    months: {}, monthsExtra: {}, cash: {},
    pnl: { lines: {}, consultants: {}, sheet: {} },
    paymentTotal: 0.0,
  };

  MONTHS.forEach((m) => { out.months[m] = extractMonthTab(g(`month:${m}`)); });
  Object.keys(EXTRA_MONTHS).forEach((k) => { out.monthsExtra[k] = extractMonthTab(g(`monthExtra:${k}`)); });

  const cash = g('cash');
  CASH_MONTHS.forEach((m, i) => {
    const r = 3 + i;
    const q = cellAt(cash, r, 8);
    out.cash[m] = {
      inputs: {
        cashReceived: num(cellAt(cash, r, 2)),
        expenses: num(cellAt(cash, r, 3)),
        cgfDonation: num(cellAt(cash, r, 4)),
        attorneyPayout: num(cellAt(cash, r, 5)),
      },
      sheet: {
        profits: num(cellAt(cash, r, 6)),
        revenue: num(cellAt(cash, r, 7)),
        qRevenue: typeof q === 'number' ? num(q) : null,
      },
    };
  });

  const pnl = g('pnl');
  const prow = (r) => Array.from({ length: 6 }, (_, c) => num(cellAt(pnl, r, 2 + c)));
  Object.entries(PNL_LINE_ROWS).forEach(([key, r]) => { out.pnl.lines[key] = prow(r); });
  Object.entries(PNL_CONSULTANT_ROWS).forEach(([key, r]) => { out.pnl.consultants[key] = prow(r); });
  Object.entries(PNL_SHEET_ROWS).forEach(([key, r]) => { out.pnl.sheet[key] = prow(r); });

  const ps = g('paymentStatus');
  out.paymentTotal = num(cellAt(ps, 1, 2));
  out.paymentRegister = extractRegister(ps);
  const psc = g('paymentStatusCopy');
  out.paymentRegisterCopy = extractRegister(psc);
  out.paymentTotalCopy = num(cellAt(psc, 1, 2));

  // Profits Paid (Sam) — manual ledger, headers row 2, data from row 3.
  const pp = g('profitsPaid');
  const highlights = opts.profitHighlights || null;
  const ledger = [];
  for (let r = 3; ; r += 1) {
    const d = cellAt(pp, r, 1);
    if (isBlank(d)) break;
    const date = toMDY(d);
    const amount = num(cellAt(pp, r, 3));
    ledger.push({
      date,
      description: String(cellAt(pp, r, 2) || ''),
      amount,
      note: displayNote(cellAt(pp, r, 4)),
      highlight: highlights ? (highlights.get(`${date}|${amount}`) || '') : '',
    });
  }
  out.profitsPaid = ledger;

  // Rate Sheet — levels A1..P2, rows 2..21.
  const rs = g('rateSheet');
  const rateRows = [];
  for (let r = 2; r <= 21; r += 1) {
    const level = cellAt(rs, r, 1);
    if (isBlank(level)) break;
    const gg = cellAt(rs, r, 7);
    rateRows.push({
      level: String(level),
      tier: String(cellAt(rs, r, 2) || ''),
      clientRate: num(cellAt(rs, r, 3)),
      attorneyRate: num(cellAt(rs, r, 4)),
      colinRate: rawVal(cellAt(rs, r, 5)),
      salary: rawVal(cellAt(rs, r, 6)),
      cravath: typeof gg === 'number' ? num(gg) : null,
    });
  }
  out.rateSheet = rateRows;

  // Expenses V2 — vendor rows: category, label, Jan–Dec, P&L tag (col O).
  const ex = g('expenses');
  const expRows = [];
  for (let r = 2; r <= ex.length; r += 1) {
    const cat = cellAt(ex, r, 1);
    if (cat == null) continue;
    const tag = cellAt(ex, r, 15);
    expRows.push({
      category: String(cat),
      label: String(cellAt(ex, r, 2) || ''),
      vals: Array.from({ length: 12 }, (_, m) => num(cellAt(ex, r, 3 + m))),
      pnlCat: tag == null ? null : String(tag),
    });
  }
  out.expenses = expRows;

  // Balance Sheet — label / current period / note rows 1..40.
  const bs = g('balanceSheet');
  const balRows = [];
  for (let r = 1; r <= 40; r += 1) {
    const label = cellAt(bs, r, 1);
    const val = cellAt(bs, r, 2);
    const note = cellAt(bs, r, 3);
    if (label == null && val == null && note == null) continue;
    balRows.push({
      row: r,
      label: label == null ? '' : String(label),
      value: rawVal(val),
      note: rawVal(note),
    });
  }
  out.balanceSheet = balRows;

  return out;
}
