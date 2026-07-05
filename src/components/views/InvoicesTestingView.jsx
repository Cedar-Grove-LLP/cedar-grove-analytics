"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import { auth } from '@/firebase/config';
import {
  computeMonthlyWaterfall,
  computeCashProfits,
  WATERFALL_ROWS,
  sumColumn,
  isNet30,
  calculateNextReminder,
  daysOverdue,
  isReminderDue,
  computePaymentRollup,
  nextCalendarMonth,
} from '@/utils/invoicesCalc.mjs';
import {
  MONTHS12,
  expenseMonthTotal,
  MONTH_DATA,
  buildMonthData,
  buildRealDataset,
  FROZEN_REAL_DATASET,
  REAL_WORKBOOK,
  DUMMY_WORKBOOK,
  deriveCashRows,
} from '@/utils/invoicesTestData.mjs';
import {
  resolveWorkbook,
  wfKey,
  mxBillKey,
  mxFieldKey,
  cashKey,
  regKey,
  expKey,
} from '@/utils/invoicesOverrides.mjs';

// The frozen snapshot's raw workbook (used as the drift baseline + fallback).
const FROZEN_WORKBOOK = REAL_WORKBOOK;

// ---------------------------------------------------------------------------
// Invoices (testing) — structural + logical replica of the "Invoices (2026)"
// workbook. Sub-tabs are CONNECTED like the real cross-sheet references; the
// data layer lives in src/utils/invoicesTestData.mjs (pure, tested) with two
// datasets: Dummy (placeholder inputs) and Real Jan–Jun (captured workbook
// figures — regenerate via scripts/extract-invoices-workbook.py).
// Everything is self-contained in this tab — no Firestore, no other dashboard
// logic, no spreadsheet writes.
// ---------------------------------------------------------------------------

const cx = (...a) => a.filter(Boolean).join(' ');
const cell = 'border-b border-gray-100 px-3 py-[7px] text-[13px] leading-[1.5] whitespace-nowrap tabular-nums';
// Refined palette — brand-tinted neutrals instead of raw spreadsheet greens.
// Header tokens include `sticky top-0` so tables inside a max-height SheetWrap
// keep their header row pinned while scrolling.
const C = {
  greenHead: 'bg-[#f3f5ee] text-[11px] uppercase tracking-wider text-cg-dark font-semibold sticky top-0 z-10',
  medGreenHead: 'bg-[#e6ecdb] text-[11px] uppercase tracking-wider text-cg-dark font-semibold sticky top-0 z-10',
  grayHead: 'bg-[#f3f5ee] text-[11px] uppercase tracking-wider text-cg-dark/70 font-semibold sticky top-0 z-10',
  lightGreen: 'bg-[#e9f4ec]',
  blueBand: 'bg-[#eef1f4] text-[11px] uppercase tracking-wider text-cg-dark/80 font-semibold',
  tan: 'bg-[#faf3dd]',
  yellow: 'bg-[#fdf3cd]',
  redItalic: 'text-[#c0392b] italic',
  greenItalic: 'text-cg-green italic',
};
// Currency like the sheet: negatives read -$9,389.44 (not $-9,389.44).
const fmt = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`;
const D = (y, m, d) => new Date(y, m - 1, d);
const fmtDate = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '');
const toInputValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Zeros render as a muted dash (like the sheet's accounting format "-") so the
// eye lands on the numbers that matter.
const Money = ({ v, f = fmt0 }) => (Math.abs(Number(v) || 0) > 0.004 ? <>{f(v)}</> : <span className="text-gray-300">–</span>);

const SheetWrap = ({ children, maxH }) => (
  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm" style={maxH ? { maxHeight: maxH, overflowY: 'auto' } : undefined}>{children}</div>
);
const SubHead = ({ children }) => (
  <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cg-dark/70">
    <span className="inline-block h-3 w-1 rounded-full bg-cg-green" />{children}
  </p>
);
const PaymentPill = ({ value }) => {
  const styles = {
    Paid: 'bg-[#e3f3e7] text-[#186a2f]',
    'Not Paid': 'bg-[#fdeee0] text-[#93500e]',
    'Payment Initiated': 'bg-[#fbf3d4] text-[#7f6000]',
    'Write Off': 'bg-gray-100 text-gray-500',
  };
  const dot = { Paid: 'bg-[#1CA33B]', 'Not Paid': 'bg-[#e08a2e]', 'Payment Initiated': 'bg-[#d3b431]', 'Write Off': 'bg-gray-400' };
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-[2px] text-[12px] font-medium', styles[value] || 'bg-gray-100')}>
      <span className={cx('h-1.5 w-1.5 rounded-full', dot[value] || 'bg-gray-400')} />{value}
    </span>
  );
};
const StatCard = ({ label, value, tone }) => (
  <div className={cx(
    'rounded-xl border px-3.5 py-2.5 min-w-[130px] shadow-sm',
    tone === 'red' ? 'border-red-100 bg-red-50/70' : 'border-gray-200 bg-white',
  )}>
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">{label}</div>
    <div className={cx('mt-0.5 text-[15px] font-bold tabular-nums', tone === 'red' ? 'text-red-700' : 'text-cg-black')}>{value}</div>
  </div>
);
const SourceNote = ({ children }) => <p className="text-[12px] leading-relaxed text-gray-400 mb-2">{children}</p>;

// Parse a user-typed number: strips $ , whitespace; (123) → -123. Returns null
// on empty/invalid so a bad entry is ignored rather than committed.
const parseNum = (s) => {
  if (s == null) return null;
  let t = String(s).trim().replace(/[$,\s]/g, '');
  let neg = false;
  if (/^\((.*)\)$/.test(t)) { neg = true; t = t.replace(/^\(|\)$/g, ''); }
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return neg ? -Math.abs(n) : n;
};

// A numeric cell that becomes an <input> on click when the sandbox is on.
// Shows an old→new inline delta and edited/pinned markers, driven entirely by
// the resolver's `meta` map (edit = { editable, meta, onEdit }).
const EditableNum = ({ cellKey, value, edit, fmtFn = fmt, pinnable = false }) => {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const canEdit = !!(edit && edit.editable && cellKey);
  const m = edit && edit.meta && cellKey ? edit.meta.get(cellKey) : null;
  const state = m ? m.state : null;
  const base = m && typeof m.base === 'number' ? m.base : null;
  const changed = base != null && Math.abs(value - base) > 0.005;

  const isZero = Math.abs(Number(value) || 0) < 0.005;
  if (!canEdit) return isZero ? <span className="text-gray-300">–</span> : <span>{fmtFn(value)}</span>;

  const commit = () => {
    const n = parseNum(draft);
    setEditing(false);
    // Only apply a real change — a no-op commit (click in, click out) must not
    // create an override, which for a derived cell would silently pin it.
    if (n != null && Math.abs(n - value) > 1e-9) edit.onEdit(cellKey, n);
  };
  if (editing) {
    return (
      <input
        autoFocus
        defaultValue={String(value)}
        onChange={(e) => setDraft(e.target.value)}
        onFocus={() => setDraft(String(value))}
        onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
        className="w-24 rounded-md border border-cg-green bg-white px-1.5 py-[2px] text-[13px] text-right shadow-sm outline-none ring-2 ring-cg-green/20"
      />
    );
  }
  const delta = changed ? value - base : 0;
  const marker = state === 'pinned'
    ? 'ring-1 ring-[#4a6fa5] bg-[#eef3f9]'
    : state === 'edited'
      ? 'ring-1 ring-[#dcb75a] bg-[#fbf4de]'
      : state === 'derived-changed' ? 'bg-[#fbf4de]' : '';
  return (
    <span className="inline-flex items-center justify-end gap-1">
      {changed && <span className="text-[10px] text-gray-400 line-through">{fmtFn(base)}</span>}
      <button
        type="button"
        onClick={() => { setDraft(String(value)); setEditing(true); }}
        className={cx('cursor-text rounded-md px-1 tabular-nums transition-colors hover:bg-[#eef2e6] hover:ring-1 hover:ring-gray-200', marker, isZero && !changed && !state && 'text-gray-300')}
        title={pinnable && state !== 'pinned' ? 'Click to override (pins this formula cell)' : 'Click to edit'}
      >
        {isZero && !changed && !state ? '–' : fmtFn(value)}
      </button>
      {changed && <span className={cx('text-[10px] font-semibold', delta < 0 ? 'text-[#c0392b]' : 'text-cg-green')}>{delta > 0 ? '+' : ''}{fmtFn(delta)}</span>}
      {state === 'pinned' && <span title="Pinned — overrides the formula; upstream edits no longer change it" className="text-[10px]">📌</span>}
      {(state === 'edited' || state === 'pinned') && (
        <button type="button" onClick={() => edit.onEdit(cellKey, undefined)} title="Clear this override" className="text-[10px] text-gray-400 transition-colors hover:text-red-600">✕</button>
      )}
    </span>
  );
};

// A read-only number that shows an inline old→new delta when it differs from a
// cached baseline (used for cells that CHANGE from an upstream what-if edit but
// aren't themselves editable — e.g. P&L NET INCOME, Cash Profits/Q Revenue).
const DeltaVal = ({ value, base, fmtFn = fmt }) => {
  const changed = typeof base === 'number' && typeof value === 'number' && Math.abs(value - base) > 0.005;
  if (!changed) return Math.abs(Number(value) || 0) < 0.005 ? <span className="text-gray-300">–</span> : <>{fmtFn(value)}</>;
  const d = value - base;
  return (
    <span className="inline-flex items-center justify-end gap-1">
      <span className="text-[10px] text-gray-400 line-through">{fmtFn(base)}</span>
      <span className="rounded-md bg-[#fbf4de] px-1">{fmtFn(value)}</span>
      <span className={cx('text-[10px] font-semibold', d < 0 ? 'text-[#c0392b]' : 'text-cg-green')}>{d > 0 ? '+' : ''}{fmtFn(d)}</span>
    </span>
  );
};

// ===========================================================================
// Month tab
// ===========================================================================
const MATRIX_TAIL = [
  'Sum Billables', '83(b) Elections', 'Filing Fees', 'Fees Notes', 'Outside Counsel',
  'Outside Counsel Notes', 'Prior Deferred', 'Prior Deferral Toggle', 'Deferred This Month',
  'Total Deferred', 'Write Off', 'Invoiced', 'General Notes', 'Contact Name', 'Contact Email', 'Payment Terms',
];
const RATE_TABLE_COLS = ['Attorney', 'Client Rate', 'Take-Home Rate', 'Billable Earnings', '83(b) Earnings (Cash Bonus)', 'Personal Reimbursements', 'Check', 'Diff'];

const CheckBadge = ({ ok }) => (
  <span className={cx(
    'inline-flex h-[18px] w-[18px] items-center justify-center rounded-full text-[11px] font-bold',
    ok ? 'bg-[#e3f3e7] text-cg-green' : 'bg-[#fdeaea] text-[#c0392b]',
  )}>
    {ok ? '✓' : '✕'}
  </span>
);
const rateCellRender = (v) => {
  if (typeof v === 'number') return <Money v={v} f={fmt} />;
  if (typeof v === 'boolean') return <CheckBadge ok={v} />;
  return v == null ? '' : String(v);
};

const WF_DERIVED_KEYS = new Set(['gross', 'netAccrued', 'revenueAccrued', 'cgfDonation', 'revenueMinusCgf', 'netRevenueBeforeOpEx', 'firmProfits']);
// Component rows of Gross / deductions — indented under their derived parent.
const WF_INDENT_KEYS = new Set(['writeOffs', 'attorneyBillables', 'flatFee83b', 'filingFees', 'outsideCounsel', 'deferred', 'attorneyPayout', 'opEx']);

const MonthTab = ({ data, rolledFrom, monthKey, edit }) => {
  const wf = data.waterfall || computeMonthlyWaterfall(data.inputs);
  const errs = data.sheetErrors || {};
  const hasDetail = !!data.matrix;
  const wfCellKey = (key) => (edit && monthKey ? wfKey(monthKey, key) : null);
  const waterfallCard = (
    <div>
      <SubHead>Accrual Waterfall</SubHead>
      <SheetWrap>
        <table className="w-full border-collapse">
          <tbody>
            {WATERFALL_ROWS.map(([label, key, tag]) => {
              const derived = WF_DERIVED_KEYS.has(key);
              const hl = tag === 'hl';
              return (
                <tr key={key} className={cx(hl && C.lightGreen)}>
                  <td className={cx(cell, hl ? 'font-bold text-cg-black' : derived ? 'font-semibold text-cg-black' : 'text-cg-dark', WF_INDENT_KEYS.has(key) && 'pl-7', tag === 'green' && C.greenItalic)}>
                    {label.replace(/:$/, '')}
                  </td>
                  <td className={cx(cell, 'text-right', hl && 'font-bold', tag === 'red' && C.redItalic, tag === 'green' && C.greenItalic)} style={{ minWidth: 130 }}>
                    {errs[key]
                      ? <span className={cx(C.redItalic, 'whitespace-normal text-[11px]')}>{String(errs[key]).split(' (')[0]}</span>
                      : <EditableNum cellKey={wfCellKey(key)} value={wf[key]} edit={edit} pinnable={WF_DERIVED_KEYS.has(key)} />}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SheetWrap>
    </div>
  );

  if (!hasDetail) {
    return (
      <div className="space-y-3">
        <div className="max-w-xl">{waterfallCard}</div>
      </div>
    );
  }

  const { attorneys, matrix } = data;
  const totalBillings = attorneys.map((_, j) => sumColumn(matrix.map((r) => r.billings[j])));
  const tot = (k) => sumColumn(matrix.map((r) => r[k]));
  return (
    <div className="space-y-6">
      {rolledFrom && <div className="rounded-xl border border-[#cfdcee] bg-[#eef3f9] px-3.5 py-2 text-[13px] text-cg-dark"><span className="font-semibold">Rolled over from {rolledFrom}.</span> Structure cloned; inputs refreshed with new dummy data, so the waterfall recomputes.</div>}
      {Object.keys(errs).length > 0 && (
        <SourceNote>The sheet itself shows {String(Object.values(errs)[0]).split(' (')[0]} for some waterfall cells (broken IMPORTRANGE) — rendered as-is.</SourceNote>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
        {waterfallCard}
        <div>
          <SubHead>Attorney Rate Table</SubHead>
          <SheetWrap>
            <table className="border-collapse w-full">
              <tbody>
                {data.rateHeaders ? (
                  <>
                    <tr>
                      <td className={cx(cell, C.greenHead)}>Attorney</td>
                      {data.rateHeaders.map((h, i) => <td key={i} className={cx(cell, C.greenHead, 'text-right')}>{h}</td>)}
                    </tr>
                    {data.rateRows.map((r, i) => (
                      <tr key={i} className="transition-colors hover:bg-[#f8faf5]">
                        <td className={cx(cell, 'font-semibold')}>{r.name}</td>
                        {r.vals.map((v, j) => {
                          const isDiff = data.rateHeaders[j] === 'Diff';
                          const badDiff = isDiff && typeof v === 'number' && Math.abs(v) > 0.02;
                          return (
                            <td key={j} className={cx(cell, typeof v === 'boolean' ? 'text-center' : 'text-right', badDiff && 'font-semibold text-[#c0392b]')}>
                              {rateCellRender(v)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </>
                ) : (
                  <>
                    <tr>{RATE_TABLE_COLS.map((c, i) => <td key={c} className={cx(cell, C.greenHead, i === 0 ? 'text-left' : 'text-right')}>{c}</td>)}</tr>
                    {data.rateTable.map((r, i) => (
                      <tr key={i} className="transition-colors hover:bg-[#f8faf5]">
                        <td className={cx(cell, 'font-semibold')}>{r.name}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.clientRate)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.takeHome)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.billableEarnings)}</td>
                        <td className={cx(cell, 'text-right')}><Money v={r.earnings83b} f={fmt} /></td>
                        <td className={cx(cell, 'text-right')}><Money v={r.personalReimb} f={fmt} /></td>
                        <td className={cx(cell, 'text-center')}><CheckBadge ok={r.check} /></td>
                        <td className={cx(cell, 'text-right')}><Money v={r.diff} /></td>
                      </tr>
                    ))}
                  </>
                )}
              </tbody>
            </table>
          </SheetWrap>
        </div>
      </div>
      <div>
        <SubHead>Client Billings Matrix</SubHead>
        {data.matrixTotalRows != null && (
          <SourceNote>Showing {matrix.length} active clients of {data.matrixTotalRows} (all-zero rows omitted; totals unaffected). Sum Billables = Σ attorney columns + prior deferrals billed this month.</SourceNote>
        )}
        <SheetWrap maxH="65vh">
          <table className="border-collapse">
            <tbody>
              <tr>
                <td className={cx(cell, 'sticky left-0 top-0 z-30 bg-[#e6ecdb] text-[11px] font-semibold uppercase tracking-wider text-cg-dark')} style={{ minWidth: 190 }}>Client</td>
                {attorneys.map((a) => <td key={a} className={cx(cell, C.grayHead, 'text-center')} style={{ minWidth: 70 }}>{a}</td>)}
                {MATRIX_TAIL.map((h) => <td key={h} className={cx(cell, h === 'Sum Billables' ? C.medGreenHead : C.grayHead, 'text-center')} style={{ minWidth: 90 }}>{h}</td>)}
              </tr>
              {matrix.map((r, ri) => {
                const bk = (j) => (edit && monthKey ? mxBillKey(monthKey, ri, j) : null);
                const fk = (f) => (edit && monthKey ? mxFieldKey(monthKey, ri, f) : null);
                return (
                  <tr key={r.client} className="group transition-colors hover:bg-[#f8faf5]">
                    <td className={cx(cell, 'sticky left-0 z-[5] bg-white font-medium text-cg-black transition-colors group-hover:bg-[#f8faf5]')}>{r.client}</td>
                    {r.billings.map((v, j) => <td key={j} className={cx(cell, 'text-right')}><EditableNum cellKey={bk(j)} value={v} edit={edit} fmtFn={fmt0} /></td>)}
                    <td className={cx(cell, 'text-right font-medium', C.lightGreen)}><Money v={r.sumBillables} /></td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('elections83b')} value={r.elections83b} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('filingFees')} value={r.filingFees} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cell}>{r.feesNotes}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('outsideCounsel')} value={r.outsideCounsel} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cell}>{r.ocNotes}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('priorDeferred')} value={r.priorDeferred} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-center')}>{r.priorToggle && <span className="rounded-full bg-[#eef3f9] px-2 py-[1px] text-[11px] font-medium text-[#3b5d8f]">{r.priorToggle}</span>}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('deferredThisMonth')} value={r.deferredThisMonth} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}><Money v={r.totalDeferred} /></td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('writeOff')} value={r.writeOff} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}><Money v={r.invoiced} /></td>
                    <td className={cx(cell, 'max-w-[240px] truncate')} title={r.generalNotes}>{r.generalNotes}</td>
                    <td className={cell}>{r.contactName}</td>
                    <td className={cx(cell, 'text-gray-500')}>{r.contactEmail}</td>
                    <td className={cx(cell, 'text-center')}>{r.paymentTerms ? `Net ${r.paymentTerms}` : ''}</td>
                  </tr>
                );
              })}
              <tr className="font-bold">
                <td className={cx(cell, C.lightGreen, 'sticky left-0 z-[5] text-[12px] uppercase tracking-wide')}>Totals</td>
                {totalBillings.map((v, j) => <td key={j} className={cx(cell, 'text-right', C.lightGreen)}><Money v={v} /></td>)}
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('sumBillables')} /></td>
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('elections83b')} /></td>
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('filingFees')} /></td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('outsideCounsel')} /></td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('priorDeferred')} /></td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('deferredThisMonth')} /></td>
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('totalDeferred')} /></td>
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('writeOff')} /></td>
                <td className={cx(cell, 'text-right', C.lightGreen)}><Money v={tot('invoiced')} /></td>
                <td className={cx(cell, C.lightGreen)} colSpan={4} />
              </tr>
            </tbody>
          </table>
        </SheetWrap>
      </div>
    </div>
  );
};

// ===========================================================================
// Rate Sheet (dummy rows live in the data layer as DUMMY_WORKBOOK.rateSheet)
// ===========================================================================
const RATE_COLS = ['', '', 'Client Rate', 'Attorney Rate', 'Colin Rate', 'Est. Annual Salary (1200 Billed Hours)', 'Cravath Total Comp'];
const RATE_NOTES = [
  'A1 is equivalent to a Cravath first year.',
  'Leveling at each row is expected but not guaranteed every 6 months (quasi-lockstep).',
  'Leveling opportunity occurs after comprehensive performance reviews during the Q2 and Q4 on-sites, with new rates effective the following month.',
  'For outstanding, sustained performance (book prize) with a very sharp growth curve, discretionary extra leveling may occur at the end of any quarter.',
  'Semi-annual review cycles and leveling ensures the right balance of frequent forward momentum and meaningful feedback (unlike Big Law, annual lockstep).',
  '** Note that partners bill fewer client hours but receive profit share.',
];
const rateBand = (level) => (level.startsWith('C') ? 'bg-[#eef3f9]' : level.startsWith('P') ? C.lightGreen : '');
const RateSheetScaffold = ({ rows }) => (
  <SheetWrap>
    <table className="border-collapse">
      <tbody>
        <tr>
          {RATE_COLS.map((h, i) => <td key={i} className={cx(cell, C.greenHead, i >= 2 ? 'text-right' : 'text-center')} style={{ minWidth: i === 5 ? 210 : 80 }}>{h}</td>)}
          <td className={cx(cell, C.greenHead)} style={{ minWidth: 340 }} />
        </tr>
        {rows.map((r, i) => {
          const band = rateBand(r.level);
          const variable = r.salary === 'Variable';
          return (
            <tr key={i} className="transition-colors hover:bg-[#f8faf5]">
              <td className={cx(cell, band, 'font-bold text-cg-black')}>{r.level}</td>
              <td className={cx(cell, band, 'text-gray-500')}>{r.tier}</td>
              <td className={cx(cell, band, 'text-right font-medium')}>{fmt(r.clientRate)}</td>
              <td className={cx(cell, band, 'text-right')}>{fmt(r.attorneyRate)}</td>
              <td className={cx(cell, band, 'text-right')}>{typeof r.colinRate === 'number' ? fmt(r.colinRate) : <span className="text-gray-300">–</span>}</td>
              <td className={cx(cell, band, 'text-right', variable && 'italic text-gray-500')}>{variable ? 'Variable' : fmt0(r.salary)}</td>
              {i % 2 === 0 && <td className={cx(cell, band, 'text-center italic align-middle text-gray-500')} rowSpan={2}>{r.cravath != null ? fmt0(r.cravath) : ''}</td>}
              {i === 0 && <td className={cx(cell, 'align-top text-[12px] leading-[1.6] whitespace-normal text-gray-500')} rowSpan={rows.length}><ul className="list-disc space-y-1.5 pl-4 marker:text-cg-green">{RATE_NOTES.map((n, k) => <li key={k}>{n}</li>)}</ul></td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  </SheetWrap>
);

// ===========================================================================
// Cash Accounting Summary (dataset-driven)
// ===========================================================================
const CASH_COLS = ['Month', 'Cash Received', 'Expenses (Outside Counsel, Filing Fees, Software, Etc.)', 'CGF Donation', 'Attorney Payout', 'Profits', 'Revenue', 'Q Revenue'];
const CashAccountingScaffold = ({ rows, baseRows, edit }) => {
  const withDerived = deriveCashRows(rows);
  const baseDerived = baseRows ? deriveCashRows(baseRows) : null;
  const b = (i, k) => (baseDerived && baseDerived[i] ? baseDerived[i][k] : undefined);
  const t = (k) => sumColumn(withDerived.map((r) => (r.filled ? r[k] : 0)));
  const bt = (k) => (baseDerived ? sumColumn(baseDerived.map((r) => (r.filled ? r[k] : 0))) : undefined);
  const ck = (r, field) => (edit && r.filled ? cashKey(r.month.toLowerCase(), field) : null);
  return (
    <div className="space-y-2">
      <SourceNote>
        Cash Received ← Payment Status (by Date Received) · Expenses ← Expenses V2 · Attorney Payout ← month rate tables (1 month in arrears) ·
        Revenue ← each month tab&apos;s Revenue (Accrued) · Profits &amp; Q Revenue computed here.
      </SourceNote>
      <SheetWrap>
        <table className="border-collapse">
          <tbody>
            <tr>{CASH_COLS.map((h) => <td key={h} className={cx(cell, C.greenHead, 'whitespace-normal')} style={{ minWidth: 100 }}>{h}</td>)}</tr>
            {withDerived.map((r, i) => (
              <tr key={i} className={cx('transition-colors hover:bg-[#f8faf5]', !r.filled && 'opacity-50')}>
                <td className={cx(cell, 'font-medium text-cg-black')}>{r.month}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'cashReceived')} value={r.cashReceived} edit={edit} /> : <span className="text-gray-300">–</span>}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'expenses')} value={r.expenses} edit={edit} /> : <span className="text-gray-300">–</span>}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'cgfDonation')} value={r.cgfDonation} edit={edit} /> : ''}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'attorneyPayout')} value={r.attorneyPayout} edit={edit} /> : ''}</td>
                <td className={cx(cell, 'text-right font-medium', r.filled && r.profits < 0 && 'text-[#c0392b]')}>{r.filled ? <DeltaVal value={r.profits} base={b(i, 'profits')} /> : ''}</td>
                <td className={cx(cell, 'text-right', !r.filled && C.redItalic)}>{r.filled ? <DeltaVal value={r.revenueAccrued} base={b(i, 'revenueAccrued')} /> : '#REF!'}</td>
                <td className={cx(cell, 'text-right font-medium')}>{r.qRevenue != null ? <DeltaVal value={r.qRevenue} base={b(i, 'qRevenue')} /> : ''}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={cx(cell, C.lightGreen, 'text-[12px] uppercase tracking-wide')}>Totals</td>
              <td className={cx(cell, 'text-right', C.lightGreen)}><DeltaVal value={t('cashReceived')} base={bt('cashReceived')} /></td>
              <td className={cx(cell, 'text-right', C.lightGreen)}><DeltaVal value={t('expenses')} base={bt('expenses')} /></td>
              <td className={cx(cell, 'text-right', C.lightGreen)}><DeltaVal value={t('cgfDonation')} base={bt('cgfDonation')} /></td>
              <td className={cx(cell, 'text-right', C.lightGreen)}><DeltaVal value={t('attorneyPayout')} base={bt('attorneyPayout')} /></td>
              <td className={cx(cell, 'text-right', C.lightGreen)}><DeltaVal value={t('profits')} base={bt('profits')} /></td>
              <td className={cx(cell, C.lightGreen)} colSpan={2} />
            </tr>
          </tbody>
        </table>
      </SheetWrap>
    </div>
  );
};

// ===========================================================================
// Profits Paid (Sam) — dataset-driven manual ledger
// ===========================================================================
const ProfitsPaidScaffold = ({ rows }) => (
  <SheetWrap>
    <table className="border-collapse">
      <tbody>
        <tr>{['Date (UTC)', 'Description', 'Amount', 'Note'].map((h, i) => <td key={h} className={cx(cell, C.greenHead, i === 2 ? 'text-right' : '')} style={{ minWidth: i === 3 ? 320 : 120 }}>{h}</td>)}</tr>
        {rows.map((r, i) => {
          const bg = r.highlight === 'green' ? C.lightGreen : r.highlight === 'tan' ? C.tan : '';
          return (
            <tr key={i} className="transition-colors hover:bg-[#f8faf5]">
              <td className={cx(cell, 'font-medium text-cg-black')}>{r.date}</td>
              <td className={cx(cell, 'text-gray-500')}>{r.description}</td>
              <td className={cx(cell, 'text-right font-medium', r.amount < 0 && 'text-[#c0392b]')}>{fmt(r.amount)}</td>
              <td className={cx(cell, bg, 'whitespace-normal text-gray-600')}>{r.note}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </SheetWrap>
);

// ===========================================================================
// Expenses V2
// ===========================================================================
const ExpensesScaffold = ({ rows, edit }) => (
  <div className="space-y-2">
    <SourceNote>Each vendor is tagged to a P&amp;L category (col O); column totals feed Cash Accounting Expenses and the P&amp;L expense lines.{edit ? ' Click a monthly cell to model a what-if — the change flows to that P&L line → NET INCOME.' : ''}</SourceNote>
    <SheetWrap maxH="70vh">
      <table className="border-collapse">
        <tbody>
          <tr>
            <td className={cx(cell, 'sticky left-0 top-0 z-30 bg-[#f3f5ee] text-[11px] font-semibold uppercase tracking-wider text-cg-dark')} style={{ minWidth: 170 }}>Expense Category</td>
            <td className={cx(cell, C.greenHead)} style={{ minWidth: 200 }}>Label</td>
            {MONTHS12.map((m) => <td key={m} className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 84 }}>{m}</td>)}
            <td className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 140 }}>P&amp;L Category</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={i} className={cx('group transition-colors hover:bg-[#f8faf5]', r.highlight && C.yellow)}>
              <td className={cx(cell, 'sticky left-0 z-[5] font-medium text-cg-black transition-colors group-hover:bg-[#f8faf5]', r.highlight ? C.yellow : 'bg-white')}>{r.category}</td>
              <td className={cx(cell, 'text-gray-500', r.highlight && C.yellow)}>{r.label}</td>
              {r.vals.map((v, k) => <td key={k} className={cx(cell, 'text-right', r.highlight && C.yellow)}><EditableNum cellKey={edit ? expKey(i, k) : null} value={v} edit={edit} /></td>)}
              <td className={cx(cell, r.highlight && C.yellow)}>{r.pnlCat ? <span className="rounded-full bg-[#eef2e6] px-2 py-[1px] text-[11px] font-medium text-cg-dark">{r.pnlCat}</span> : ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </SheetWrap>
  </div>
);

// ===========================================================================
// P&L (dataset-driven)
// ===========================================================================
const PnlScaffold = ({ months, rows, baseRows }) => (
  <div className="space-y-2">
    <SourceNote>Revenue ← Cash Accounting (Cash Received) · expense lines ← Expenses V2 (by category) · Totals &amp; NET INCOME computed here.</SourceNote>
    <SheetWrap>
      <table className="border-collapse">
        <tbody>
          <tr>
            <td className={cx(cell, C.greenHead)} style={{ minWidth: 220 }}>Category</td>
            {months.map((m) => <td key={m} className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 85 }}>{m}</td>)}
            <td className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 100 }}>2025 Total</td>
          </tr>
          {rows.map((r, i) => {
            if (r.t === 'band' || r.t === 'sub') {
              return (
                <tr key={i}>
                  <td className={cx(cell, r.t === 'band' ? C.blueBand : 'pt-3 text-[12px] font-semibold text-cg-dark/80')}>{r.label}</td>
                  {months.map((m) => <td key={m} className={cx(cell, r.t === 'band' && C.blueBand)} />)}
                  <td className={cx(cell, r.t === 'band' && C.blueBand)} />
                </tr>
              );
            }
            const strong = r.t === 'total' || r.t === 'lineTotal' || r.t === 'grand';
            const grand = r.t === 'grand';
            const hl = grand ? (r.label === 'NET INCOME' ? C.lightGreen : C.tan) : '';
            const indent = r.t === 'line' || r.t === 'lineTotal';
            const baseVals = baseRows && baseRows[i] ? baseRows[i].vals : null;
            return (
              <tr key={i} className={cx(!strong && 'transition-colors hover:bg-[#f8faf5]', r.t === 'lineTotal' && 'border-t border-gray-200')}>
                <td className={cx(cell, indent && 'pl-6', strong && 'font-bold', grand && 'text-[12px] uppercase tracking-wide', hl, r.t === 'line' && 'text-cg-dark')}>{r.label}</td>
                {r.vals.map((v, k) => <td key={k} className={cx(cell, 'text-right', strong && 'font-bold', hl)}><DeltaVal value={v || 0} base={baseVals ? baseVals[k] || 0 : undefined} /></td>)}
                <td className={cx(cell, 'text-right font-bold', hl || C.lightGreen)}><DeltaVal value={sumColumn(r.vals)} base={baseVals ? sumColumn(baseVals) : undefined} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </SheetWrap>
  </div>
);

// ===========================================================================
// Balance Sheet
// ===========================================================================
const NET_INCOME_YTD = sumColumn(FROZEN_REAL_DATASET.pnl.rows.find((r) => r.label === 'NET INCOME').vals);
const BALANCE_ROWS = [
  { t: 'title', label: 'Cedar Grove LLP - 2025 Balance Sheet' },
  { t: 'asof', label: 'As of: [X]' },
  { t: 'head' },
  { t: 'band', label: 'ASSETS' },
  { t: 'group', label: 'Current Assets' },
  { t: 'row', label: 'Cash - Operating Account' }, { t: 'row', label: 'Cash - Savings' },
  { t: 'row', label: 'Accounts Receivable - Client Fees' }, { t: 'row', label: 'Other Current Assets' },
  { t: 'total', label: 'Total Current Assets', val: '$0.00', note: '-' },
  { t: 'grand', label: 'TOTAL ASSETS', val: '$0.00', note: '-' },
  { t: 'spacer' },
  { t: 'band', label: 'LIABILITIES' }, { t: 'group', label: 'Current Liabilities' },
  { t: 'row', label: 'Accounts Payable', note: '1099 contractors and third party software' },
  { t: 'row', label: 'Credit Cards Payable' },
  { t: 'row', label: 'Accrued Expenses (Filing Fee Reimbursements, Outside Counsel Fees, etc.)' },
  { t: 'row', label: 'Payroll Liabilities' }, { t: 'row', label: 'Accrued but Unpaid CGF Donations' },
  { t: 'total', label: 'Total Current Liabilities', val: '$0.00', note: '-' },
  { t: 'group', label: 'Long-Term Liabilities' }, { t: 'row', label: 'Promissory Note (Sam)' },
  { t: 'total', label: 'Total Long-term Liabilities', val: '$0.00', note: '-' },
  { t: 'grand', label: 'TOTAL LIABILITIES', val: '$0.00', note: '-' },
  { t: 'spacer' },
  { t: 'band', label: 'EQUITY' }, { t: 'row', label: 'Owner Capital / Partner Equity' }, { t: 'row', label: 'Retained Earnings' },
  { t: 'row', label: 'Current Year Net Income', dynamic: NET_INCOME_YTD, note: '← Σ P&L NET INCOME' },
  { t: 'grand', label: 'TOTAL EQUITY', val: fmt(NET_INCOME_YTD), note: '-' },
  { t: 'spacer' },
  { t: 'grand', label: 'TOTAL LIABILITIES & EQUITY', val: fmt(NET_INCOME_YTD), note: '-' },
  { t: 'grand', label: 'BALANCE CHECK (Should be $0)', val: '$0.00', note: '-' },
];
// Convert captured Balance Sheet rows (label/value/note) into styled rows.
const classifyBalanceRow = (r) => {
  const val = typeof r.value === 'number' ? fmt(r.value) : r.value || '';
  const note = r.note || '';
  if (r.row === 1) return { t: 'title', label: r.label };
  if (r.row === 2) return { t: 'asof', label: r.label };
  if (r.row === 3) return { t: 'head' };
  if (!r.label) return { t: 'spacer' };
  if (['ASSETS', 'LIABILITIES', 'EQUITY'].includes(r.label)) return { t: 'band', label: r.label };
  if (/^(Current Assets|Current Liabilities|Long-Term Liabilities)$/.test(r.label)) return { t: 'group', label: r.label };
  if (/^(TOTAL|BALANCE CHECK)/.test(r.label)) return { t: 'grand', label: r.label, val, note };
  if (/^Total /.test(r.label)) return { t: 'total', label: r.label, val, note };
  return { t: 'row', label: r.label, val, note };
};

const BalanceSheetScaffold = ({ rows }) => (
  <SheetWrap>
    <table className="border-collapse">
      <tbody>
        {rows.map((r, i) => {
          if (r.t === 'title') return <tr key={i}><td className={cx(cell, 'font-bold text-[15px]')} colSpan={3} style={{ minWidth: 360 }}>{r.label}</td></tr>;
          if (r.t === 'asof') return <tr key={i}><td className={cx(cell, C.yellow, 'italic')} colSpan={3}>{r.label}</td></tr>;
          if (r.t === 'head') return <tr key={i}><td className={cx(cell, C.greenHead)}>Account</td><td className={cx(cell, C.greenHead, 'text-right')} style={{ minWidth: 130 }}>Current Period</td><td className={cx(cell, C.greenHead)} style={{ minWidth: 300 }}>Notes</td></tr>;
          if (r.t === 'spacer') return <tr key={i}><td className={cell} /><td className={cell} /><td className={cell} /></tr>;
          if (r.t === 'band') return <tr key={i}><td className={cx(cell, C.blueBand)}>{r.label}</td><td className={cx(cell, C.blueBand)} /><td className={cx(cell, C.blueBand)} /></tr>;
          if (r.t === 'group') return <tr key={i}><td className={cx(cell, 'font-bold')}>{r.label}</td><td className={cell} /><td className={cell} /></tr>;
          const strong = r.t === 'total' || r.t === 'grand';
          const hl = r.t === 'grand' ? C.tan : '';
          const val = r.dynamic != null ? fmt(r.dynamic) : r.val || '';
          return (
            <tr key={i}>
              <td className={cx(cell, !strong && 'pl-5', strong && 'font-bold', hl, 'whitespace-normal')}>{r.label}</td>
              <td className={cx(cell, 'text-right', strong && 'font-bold', hl)}>{val}</td>
              <td className={cx(cell, hl)}>{r.note || ''}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </SheetWrap>
);

// ===========================================================================
// Payment Status (register + reminder engine + roll-up)
// ===========================================================================
const PAYMENT_HEADERS = ['Year', 'Date Sent', 'Terms', 'Status', 'Last Reminder', 'Date Received', 'Notes'];
const REMINDER_HEADERS = ['Days Overdue', 'Next Reminder', 'Reminder Due?'];
const PaymentStatusScaffold = ({ register, total, realTerms, edit }) => {
  const [asOf, setAsOf] = useState(D(2026, 7, 15));
  const rollup = computePaymentRollup(register, asOf);
  const rows = register.map((r) => {
    const settled = r.status === 'Paid' || r.status === 'Write Off';
    const next = settled || !r.dateSent ? null : calculateNextReminder(r.dateSent, r.lastReminder, isNet30(r.paymentTerms));
    const overdue = r.paymentTerms == null ? 0 : daysOverdue(r.dateSent, r.paymentTerms, asOf, r.status);
    return { ...r, overdue, next, due: isReminderDue(next, asOf) };
  });
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <StatCard label="Total Billed" value={fmt(rollup.total)} />
        <StatCard label="Outstanding" value={fmt(rollup.outstanding)} />
        <StatCard label="Overdue" value={`${rollup.overdueCount} · ${fmt(rollup.overdueAmount)}`} tone="red" />
        {Object.entries(rollup.byStatus).map(([s, v]) => <StatCard key={s} label={s} value={`${v.count} · ${fmt(v.amount)}`} />)}
        <label className="ml-auto flex items-center gap-2 text-sm text-cg-dark">As of:
          <input type="date" value={toInputValue(asOf)} onChange={(e) => { const [y, m, d] = e.target.value.split('-').map(Number); if (y) setAsOf(D(y, m, d)); }} className="border border-gray-300 rounded px-2 py-1 text-sm" />
        </label>
      </div>
      {realTerms === false && (
        <SourceNote>Payment terms aren&apos;t stored on this sheet (they live in the clients sheet / Firestore) — Terms and Days Overdue show &quot;–&quot;; reminders use the non-Net-30 default cadence.</SourceNote>
      )}
      <SheetWrap maxH="65vh">
        <table className="border-collapse">
          <tbody>
            <tr>
              <td className={cx(cell, C.greenHead)} style={{ minWidth: 220 }}>All 2026 Billing</td>
              <td className={cx(cell, C.greenHead, 'text-right')} style={{ minWidth: 110 }}>{fmt(total)}</td>
              {PAYMENT_HEADERS.map((h) => <td key={h} className={cx(cell, C.greenHead)}>{h}</td>)}
              {REMINDER_HEADERS.map((h) => <td key={h} className={cx(cell, C.medGreenHead, 'text-center')}>{h}</td>)}
            </tr>
            {rows.map((r, i) => (
              <tr key={i} className="transition-colors hover:bg-[#f8faf5]">
                <td className={cx(cell, 'font-medium text-cg-black')}>{r.client}</td>
                <td className={cx(cell, 'text-right')}><EditableNum cellKey={edit ? regKey(i) : null} value={r.amount} edit={edit} /></td>
                <td className={cx(cell, 'text-gray-500')}>{r.year}</td>
                <td className={cell}>{fmtDate(r.dateSent)}</td>
                <td className={cx(cell, 'text-center text-gray-500')}>{r.paymentTerms != null ? `Net ${r.paymentTerms}` : <span className="text-gray-300">–</span>}</td>
                <td className={cell}><PaymentPill value={r.status} /></td>
                <td className={cx(cell, 'text-right text-gray-500')}>{fmtDate(r.lastReminder)}</td>
                <td className={cx(cell, 'text-right')}>{fmtDate(r.dateReceived)}</td>
                <td className={cx(cell, 'max-w-[220px] truncate text-gray-500')} title={r.notes}>{r.notes}</td>
                <td className={cx(cell, 'text-right', r.overdue > 0 ? 'font-semibold text-[#c0392b]' : 'text-gray-300')}>{r.overdue > 0 ? `${r.overdue}d` : '–'}</td>
                <td className={cx(cell, !r.next && 'text-gray-300')}>{r.next ? `${r.next.name} · ${fmtDate(r.next.dueDate)}` : '–'}</td>
                <td className={cx(cell, 'text-center')}>
                  {r.next
                    ? (r.due
                        ? <span className="rounded-full bg-[#e3f3e7] px-2 py-[1px] text-[11px] font-semibold text-cg-green">Due</span>
                        : <span className="text-[12px] text-gray-400">Upcoming</span>)
                    : <span className="text-gray-300">–</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SheetWrap>
    </div>
  );
};

// ===========================================================================
// Drift indicator — recompute every derived cell from the fetched INPUTS via
// invoicesCalc and compare to the sheet's own cached values. A match confirms
// our replica reproduces the sheet; a mismatch (or the sheet's own broken
// cells) surfaces here. Also counts the sheet's own Check/Diff failures (where
// the workbook's input bugs — e.g. a mis-pointed IMPORTRANGE — show up).
// ===========================================================================
const DRIFT_EPS = 0.01;

// entry = a RAW workbook month object (workbook.months[key] / monthsExtra[key]),
// which carries .inputs, .sheet (cached derived cells), .sheetErrors, and
// .attorneyTable { headers, rows }.
const monthDrift = (entry) => {
  if (!entry) return null;
  const diffs = [];
  const errs = entry.sheetErrors || {};
  const wf = computeMonthlyWaterfall(entry.inputs);
  for (const [label, key] of WATERFALL_ROWS) {
    if (errs[key]) continue; // sheet cell is itself an error (broken IMPORTRANGE)
    const sheetVal = entry.sheet ? entry.sheet[key] : undefined;
    if (typeof sheetVal !== 'number') continue;
    if (Math.abs(wf[key] - sheetVal) > DRIFT_EPS) diffs.push({ label, ours: wf[key], sheet: sheetVal });
  }
  // The sheet's own self-check (Diff column ≠ 0) — this is where input bugs live.
  let checkFails = 0;
  const table = entry.attorneyTable;
  if (table && table.headers && table.rows) {
    const di = table.headers.indexOf('Diff');
    if (di >= 0) checkFails = table.rows.filter((r) => typeof r.vals[di] === 'number' && Math.abs(r.vals[di]) > DRIFT_EPS).length;
  }
  const errCount = Object.keys(errs).length;
  return { diffs, checkFails, errCount };
};

// A raw workbook month entry by key (months or the frozen monthsExtra copies).
const rawMonthEntry = (workbook, key) => (workbook && ((workbook.months && workbook.months[key]) || (workbook.monthsExtra && workbook.monthsExtra[key]))) || null;

const cashDrift = (workbook) => {
  if (!workbook || !workbook.cash) return null;
  const diffs = [];
  for (const [key, entry] of Object.entries(workbook.cash)) {
    const profits = computeCashProfits(entry.inputs);
    if (typeof entry.sheet.profits === 'number' && Math.abs(profits - entry.sheet.profits) > DRIFT_EPS) {
      diffs.push({ label: `${key} Profits`, ours: profits, sheet: entry.sheet.profits });
    }
    const monthWf = workbook.months[key] ? computeMonthlyWaterfall(workbook.months[key].inputs) : null;
    if (monthWf && typeof entry.sheet.revenue === 'number' && Math.abs(monthWf.revenueAccrued - entry.sheet.revenue) > DRIFT_EPS) {
      diffs.push({ label: `${key} Revenue`, ours: monthWf.revenueAccrued, sheet: entry.sheet.revenue });
    }
  }
  return { diffs, checkFails: 0, errCount: 0 };
};

const DriftChip = ({ drift }) => {
  const [open, setOpen] = useState(false);
  if (!drift) return null;
  const { diffs, checkFails, errCount } = drift;
  const clean = diffs.length === 0 && errCount === 0;
  const tone = diffs.length || errCount ? 'amber' : checkFails ? 'blue' : 'green';
  const styles = {
    green: 'border-[#b7dfb7] bg-[#eaf7ea] text-[#1e6b2e]',
    amber: 'border-[#f0d38a] bg-[#fdf6e3] text-[#7f6000]',
    blue: 'border-[#bcd6f5] bg-[#eaf2fb] text-[#1a4d80]',
  };
  const label = diffs.length
    ? `${diffs.length} cell${diffs.length > 1 ? 's' : ''} differ from sheet`
    : errCount
      ? `${errCount} sheet error cell${errCount > 1 ? 's' : ''}`
      : checkFails
        ? `matches sheet ✓ · ${checkFails} row${checkFails > 1 ? 's' : ''} fail the sheet's own Check`
        : 'matches sheet ✓';
  const expandable = diffs.length > 0;
  return (
    <div className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => expandable && setOpen((v) => !v)}
        className={cx('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[12px] font-medium', styles[tone], expandable ? 'cursor-pointer' : 'cursor-default')}
        title={clean ? 'Recomputed from the sheet inputs; every derived cell matches the sheet.' : ''}
      >
        <span className={cx('h-1.5 w-1.5 rounded-full', tone === 'amber' ? 'bg-[#c78a00]' : tone === 'blue' ? 'bg-[#1a4d80]' : 'bg-[#1e6b2e]')} />
        {label}{expandable ? (open ? ' ▲' : ' ▼') : ''}
      </button>
      {open && expandable && (
        <div className="mt-1 rounded-lg border border-[#f0d38a] bg-white px-3 py-2 text-[12px] shadow-sm">
          {diffs.map((d, i) => (
            <div key={i} className="flex gap-3 whitespace-nowrap">
              <span className="font-medium">{d.label}</span>
              <span className="text-gray-500">sheet {fmt(d.sheet)}</span>
              <span className="text-[#7f6000]">recomputed {fmt(d.ours)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

// ===========================================================================
// Root
// ===========================================================================
const NON_MONTH_LEFT = [
  { key: 'rate-sheet', label: 'Rate Sheet' },
  { key: 'cash-accounting', label: 'Cash Accounting Summary' },
  { key: 'profits-paid', label: 'Profits Paid (Sam)' },
  { key: 'expenses', label: 'Expenses V2' },
  { key: 'pnl', label: 'P&L' },
  { key: 'balance-sheet', label: 'Balance Sheet' },
  { key: 'payment-status', label: 'Payment Status' },
];
const MONTH_LABEL = { july: 'July', june: 'June', may: 'May', april: 'April', march: 'March', february: 'February', january: 'January', 'june-original': 'June - original' };
const DUMMY_MONTH_KEYS = ['july', 'june', 'may', 'april', 'march', 'february', 'january', 'june-original'];
const REAL_MONTH_ORDER = ['july', 'june', 'may', 'april', 'march', 'february', 'january', 'june-original'];
const COPY_TAB_LABEL = '06/30 Copy of Payment Status';

const fmtSyncedAt = (iso) => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
};

const InvoicesTestingView = () => {
  const [mode, setMode] = useState('dummy'); // 'dummy' | 'real'
  const [activeTab, setActiveTab] = useState('rate-sheet');
  const [rolled, setRolled] = useState([]);
  const real = mode === 'real';

  // Live sheet mirror (Real mode). liveWorkbook holds the assembled REAL_WORKBOOK
  // shape fetched from /api/invoices-workbook; on failure we fall back to the
  // frozen snapshot. Nothing here is persisted.
  const [liveWorkbook, setLiveWorkbook] = useState(null);
  const [liveStatus, setLiveStatus] = useState('idle'); // idle | loading | ready | error
  const [liveError, setLiveError] = useState(null);
  const [fetchedAt, setFetchedAt] = useState(null);

  // Local what-if sandbox (Real mode). Overrides live only here; never persisted.
  const [overrides, setOverrides] = useState({});
  const editCount = Object.keys(overrides).length;
  const onEdit = useCallback((cellKey, value) => {
    setOverrides((o) => {
      const next = { ...o };
      if (value == null) delete next[cellKey]; else next[cellKey] = value;
      return next;
    });
  }, []);

  const fetchLive = useCallback(async (refresh) => {
    setLiveStatus('loading');
    setLiveError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('Not signed in');
      const token = await user.getIdToken();
      const res = await fetch(`/api/invoices-workbook${refresh ? '?refresh=1' : ''}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `Fetch failed (${res.status})`);
      setOverrides({}); // fresh sheet data discards any sandbox edits
      setLiveWorkbook(json.workbook);
      setFetchedAt(json.fetchedAt || null);
      setLiveStatus('ready');
    } catch (err) {
      setLiveError(String(err.message || err));
      setLiveStatus('error');
    }
  }, []);

  // First switch to Real triggers a fetch (once).
  useEffect(() => {
    if (real && liveStatus === 'idle') fetchLive(false);
  }, [real, liveStatus, fetchLive]);

  // The workbook backing the current mode: dummy placeholders, or (Real mode)
  // the live fetch with the frozen snapshot as fallback. Both are the same
  // shape, so ONE resolver/dataset pipeline serves both — the what-if sandbox
  // works identically on dummy and live data.
  const usingFallback = real && liveStatus === 'error';
  const activeWorkbook = real ? (liveWorkbook || FROZEN_WORKBOOK) : DUMMY_WORKBOOK;

  // Apply sandbox overrides, then assemble the view dataset from the result.
  // resolveWorkbook is pure, so memoizing on [workbook, overrides] is safe.
  const { resolvedWorkbook, meta } = useMemo(() => {
    const res = resolveWorkbook(activeWorkbook, overrides);
    return { resolvedWorkbook: res.workbook, meta: res.meta };
  }, [activeWorkbook, overrides]);
  const dataset = useMemo(() => buildRealDataset(resolvedWorkbook), [resolvedWorkbook]);
  // Cached (no-override) dataset — the delta baseline for cells that change from
  // an upstream what-if edit but aren't directly editable (P&L, Cash derived).
  // Only needed once edits exist.
  const baseDataset = useMemo(
    () => (editCount > 0 ? buildRealDataset(activeWorkbook) : null),
    [editCount, activeWorkbook],
  );
  const edit = { editable: true, meta, onEdit };

  const monthKeys = real ? REAL_MONTH_ORDER : DUMMY_MONTH_KEYS;
  const monthDataFor = (key) => dataset.monthData[key];

  // Rollover (dummy only)
  const latest = rolled.length ? rolled[rolled.length - 1] : { name: 'July', year: 2026, data: MONTH_DATA.july };
  const next = nextCalendarMonth(latest.name, latest.year);
  const labelOf = (name, year) => (year === 2026 ? name : `${name} ${year}`);
  const rollOver = () => {
    if (!next) return;
    const data = buildMonthData(latest.data.attorneys, 8 + rolled.length, expenseMonthTotal(6));
    const key = `roll-${next.year}-${next.name.toLowerCase()}`;
    setRolled((prev) => [...prev, { key, name: next.name, year: next.year, data, fromLabel: labelOf(latest.name, latest.year) }]);
    setActiveTab(key);
  };
  const rolledMap = Object.fromEntries(rolled.map((r) => [r.key, r]));

  const switchMode = (m) => { setMode(m); setActiveTab('cash-accounting'); setOverrides({}); };

  const monthTabs = real
    ? monthKeys.map((k) => ({ key: k, label: MONTH_LABEL[k] }))
    : [...[...rolled].reverse().map((r) => ({ key: r.key, label: labelOf(r.name, r.year) })), ...monthKeys.map((k) => ({ key: k, label: MONTH_LABEL[k] }))];

  // Drift for the active sub-tab (Real mode only): recompute vs the sheet.
  const activeDrift = useMemo(() => {
    if (!real) return null;
    if (monthKeys.includes(activeTab)) return monthDrift(rawMonthEntry(activeWorkbook, activeTab));
    if (activeTab === 'cash-accounting') return cashDrift(activeWorkbook);
    return null;
  }, [real, activeTab, activeWorkbook, monthKeys]);

  const renderTab = () => {
    if (rolledMap[activeTab]) return <MonthTab data={rolledMap[activeTab].data} rolledFrom={rolledMap[activeTab].fromLabel} />;
    if (monthKeys.includes(activeTab)) {
      const data = monthDataFor(activeTab);
      if (!data) return null;
      return <MonthTab data={data} monthKey={activeTab} edit={edit} />;
    }
    const ds = dataset;
    switch (activeTab) {
      case 'rate-sheet': return <RateSheetScaffold rows={ds.rateSheet} />;
      case 'cash-accounting': return <CashAccountingScaffold rows={ds.cashRows} baseRows={baseDataset ? baseDataset.cashRows : undefined} edit={edit} />;
      case 'profits-paid': return <ProfitsPaidScaffold rows={ds.profitsRows} />;
      case 'expenses': return <ExpensesScaffold rows={ds.expenseRows} edit={edit} />;
      case 'pnl': return <PnlScaffold months={ds.pnl.months} rows={ds.pnl.rows} baseRows={baseDataset ? baseDataset.pnl.rows : undefined} />;
      case 'balance-sheet': return <BalanceSheetScaffold rows={real ? ds.balanceRows.map(classifyBalanceRow) : BALANCE_ROWS} />;
      case 'payment-status':
        return <PaymentStatusScaffold register={ds.paymentRows} total={ds.paymentTotal} realTerms={real ? false : undefined} edit={edit} />;
      case 'copy-payment-status':
        return <PaymentStatusScaffold register={ds.copyRows} total={ds.copyTotal} realTerms={real ? false : undefined} />;
      default: return null;
    }
  };

  const loadingLive = real && liveStatus === 'loading' && !liveWorkbook;

  const pill = (active) => cx(
    'rounded-full px-3.5 py-1.5 text-[13px] font-medium whitespace-nowrap transition-colors',
    active ? 'bg-cg-dark text-white shadow-sm' : 'text-cg-dark hover:bg-[#e4e7da] hover:text-cg-black',
  );
  const groupDivider = <span className="mx-1.5 h-4 w-px shrink-0 self-center bg-gray-300" />;
  const copyTab = { key: 'copy-payment-status', label: COPY_TAB_LABEL };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-cg-black">Invoices (testing)</h2>
          <p className="mt-0.5 text-sm text-cg-dark/80">A connected replica of the Invoices (2026) workbook — sub-tabs reference each other like the real cross-sheet formulas.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {real && liveStatus === 'ready' && fetchedAt && (
            <span className="inline-flex items-center gap-2 rounded-full border border-[#cbe5d2] bg-[#f0f9f2] px-3 py-1.5 text-[12px] font-medium text-[#186a2f]" title="Reading the Google Sheet directly — every sub-tab recomputes from the live workbook.">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-cg-green opacity-50" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-cg-green" />
              </span>
              Live · synced {fmtSyncedAt(fetchedAt)}
            </span>
          )}
          <div className="inline-flex rounded-full bg-[#e2e5d6] p-[3px] text-[13px] font-medium">
            <button onClick={() => switchMode('dummy')} className={cx('rounded-full px-4 py-1.5 transition-all', !real ? 'bg-white text-cg-black shadow-sm' : 'text-cg-dark/70 hover:text-cg-black')}>Dummy</button>
            <button onClick={() => switchMode('real')} className={cx('rounded-full px-4 py-1.5 transition-all', real ? 'bg-white text-cg-black shadow-sm' : 'text-cg-dark/70 hover:text-cg-black')}>Live sheet</button>
          </div>
          {real && (
            <button
              onClick={() => fetchLive(true)}
              disabled={liveStatus === 'loading'}
              className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-[12px] font-medium text-cg-dark shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40"
              title="Re-read the Google Sheet (bypasses the 5-minute server cache)"
            >
              <span className={cx(liveStatus === 'loading' && 'inline-block animate-spin')}>↻</span>
              {liveStatus === 'loading' ? 'Refreshing…' : 'Refresh'}
            </button>
          )}
          {!real && (
            <button onClick={rollOver} disabled={!next} className="inline-flex items-center gap-1.5 rounded-full border border-gray-300 bg-white px-3.5 py-1.5 text-[12px] font-medium text-cg-dark shadow-sm transition-colors hover:bg-gray-50 disabled:opacity-40" title={next ? `Roll over to ${labelOf(next.name, next.year)}` : ''}>
              + Next month{next ? ` · ${labelOf(next.name, next.year)}` : ''}
            </button>
          )}
        </div>
      </div>

      {usingFallback && (
        <div className="rounded-xl border border-[#ecd9a4] bg-[#fbf4de] px-3.5 py-2.5 text-[13px] text-[#7f6000]">
          <span className="font-semibold">Live fetch failed — showing the frozen 7/2 snapshot.</span> {liveError}
          {' '}<button onClick={() => fetchLive(true)} className="font-semibold underline underline-offset-2">Retry</button>
        </div>
      )}
      {editCount > 0 && (
        <div className="sticky top-0 z-40 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#e6c980] bg-[#fbf4de]/95 px-3.5 py-2.5 text-[13px] text-[#7f6000] shadow-sm backdrop-blur">
          <span className="flex items-center gap-2">
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-[#d9a514] px-1.5 text-[11px] font-bold text-white">{editCount}</span>
            <span><span className="font-semibold">Sandbox — local edit{editCount > 1 ? 's' : ''} only.</span> Nothing is written to the Google Sheet; refresh or switch mode to discard.</span>
          </span>
          <button onClick={() => setOverrides({})} className="rounded-full border border-[#d9a514] px-3 py-1 text-[12px] font-semibold transition-colors hover:bg-[#f5e7bb]">Reset all</button>
        </div>
      )}

      <div className="flex items-stretch overflow-x-auto rounded-full bg-[#eceee4] p-1.5">
        {NON_MONTH_LEFT.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={pill(activeTab === tab.key)}>{tab.label}</button>
        ))}
        {groupDivider}
        {monthTabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={pill(activeTab === tab.key)}>{tab.label}</button>
        ))}
        {groupDivider}
        <button onClick={() => setActiveTab(copyTab.key)} className={pill(activeTab === copyTab.key)} title="Frozen 06/30 backup of the register">{copyTab.label}</button>
      </div>

      {!loadingLive && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {activeDrift ? (
            <div className="flex items-center gap-2">
              <span className="text-[12px] text-gray-400">vs Google Sheet:</span>
              <DriftChip drift={activeDrift} />
            </div>
          ) : <span />}
          {editCount === 0 && (!real || liveStatus === 'ready') && (
            <p className="text-[12px] text-gray-400">Click any number on the month, Cash, Expenses, or Payment Status tabs to model a what-if — deltas ripple through to the P&amp;L, and the sheet is never touched.</p>
          )}
        </div>
      )}

      {loadingLive ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-200 bg-white py-16 shadow-sm">
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-cg-green" />
          <span className="text-sm text-gray-500">Reading the Google Sheet…</span>
        </div>
      ) : (
        renderTab()
      )}
    </div>
  );
};

export default InvoicesTestingView;
