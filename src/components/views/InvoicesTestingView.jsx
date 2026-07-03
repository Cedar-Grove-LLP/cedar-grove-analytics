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
  EXP_ROWS,
  expenseMonthTotal,
  PAYMENT_ROWS,
  PAYMENT_TOTAL,
  MONTH_DATA,
  buildMonthData,
  buildRealDataset,
  FROZEN_REAL_DATASET,
  REAL_WORKBOOK,
  deriveCashRows,
  DUMMY_CASH_ROWS,
  DUMMY_PNL,
  DUMMY_PROFITS_ROWS,
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
const cell = 'border-b border-gray-100 px-3 py-2 text-[13px] leading-[1.45] whitespace-nowrap';
const C = {
  greenHead: 'bg-[#38761d] text-white font-bold',
  medGreenHead: 'bg-[#93c47d] font-bold',
  grayHead: 'bg-[#efefef] font-bold',
  lightGreen: 'bg-[#d9ead3]',
  blueBand: 'bg-[#cfe2f3] font-bold',
  tan: 'bg-[#fff2cc]',
  yellow: 'bg-[#fff200]',
  redItalic: 'text-[#cc0000] italic',
  greenItalic: 'text-[#38761d] italic',
};
// Currency like the sheet: negatives read -$9,389.44 (not $-9,389.44).
const fmt = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`;
const D = (y, m, d) => new Date(y, m - 1, d);
const fmtDate = (d) => (d ? `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}` : '');
const toInputValue = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const SheetWrap = ({ children }) => (
  <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm">{children}</div>
);
const SubHead = ({ children }) => <p className="text-[13px] font-semibold text-cg-dark mb-1">{children}</p>;
const PaymentPill = ({ value }) => {
  const styles = { Paid: 'bg-[#d9ead3] text-[#274e13]', 'Not Paid': 'bg-[#fce5cd] text-[#7f3e00]', 'Payment Initiated': 'bg-[#fff2cc] text-[#7f6000]', 'Write Off': 'bg-[#efefef] text-gray-600' };
  return <span className={cx('inline-flex items-center gap-1 rounded px-2 py-[1px] text-[12px]', styles[value] || 'bg-gray-100')}>{value}<span className="text-[8px] opacity-60">▼</span></span>;
};
const StatCard = ({ label, value, tone }) => (
  <div className={cx('rounded-lg border px-3 py-2 min-w-[120px]', tone === 'red' ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-white')}>
    <div className="text-[11px] uppercase tracking-wide text-gray-500">{label}</div>
    <div className={cx('text-sm font-semibold', tone === 'red' ? 'text-red-700' : 'text-cg-black')}>{value}</div>
  </div>
);
const SourceNote = ({ children }) => <p className="text-[12px] text-gray-500 mb-2">↳ {children}</p>;

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

  if (!canEdit) return <span>{fmtFn(value)}</span>;

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
        className="w-24 border border-cg-green rounded px-1 py-[1px] text-[13px] text-right"
      />
    );
  }
  const delta = changed ? value - base : 0;
  const marker = state === 'pinned' ? 'ring-1 ring-[#1a4d80] bg-[#eaf2fb]' : state === 'edited' ? 'ring-1 ring-[#c78a00] bg-[#fdf6e3]' : state === 'derived-changed' ? 'bg-[#fdf6e3]' : '';
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      {changed && <span className="text-gray-400 line-through text-[10px]">{fmtFn(base)}</span>}
      <button type="button" onClick={() => { setDraft(String(value)); setEditing(true); }} className={cx('rounded px-1 tabular-nums hover:bg-gray-100', marker)} title={pinnable && state !== 'pinned' ? 'Click to override (pins this formula cell)' : 'Click to edit'}>
        {fmtFn(value)}
      </button>
      {changed && <span className={cx('text-[10px]', delta < 0 ? 'text-[#cc0000]' : 'text-[#188038]')}>{delta > 0 ? '+' : ''}{fmtFn(delta)}</span>}
      {state === 'pinned' && <span title="Pinned — overrides the formula; upstream edits no longer change it" className="text-[10px]">📌</span>}
      {(state === 'edited' || state === 'pinned') && (
        <button type="button" onClick={() => edit.onEdit(cellKey, undefined)} title="Clear this override" className="text-[10px] text-gray-400 hover:text-red-600">✕</button>
      )}
    </span>
  );
};

// A read-only number that shows an inline old→new delta when it differs from a
// cached baseline (used for cells that CHANGE from an upstream what-if edit but
// aren't themselves editable — e.g. P&L NET INCOME, Cash Profits/Q Revenue).
const DeltaVal = ({ value, base, fmtFn = fmt }) => {
  const changed = typeof base === 'number' && typeof value === 'number' && Math.abs(value - base) > 0.005;
  if (!changed) return <>{fmtFn(value)}</>;
  const d = value - base;
  return (
    <span className="inline-flex items-center gap-1 justify-end">
      <span className="text-gray-400 line-through text-[10px]">{fmtFn(base)}</span>
      <span className="bg-[#fdf6e3] rounded px-0.5">{fmtFn(value)}</span>
      <span className={cx('text-[10px]', d < 0 ? 'text-[#cc0000]' : 'text-[#188038]')}>{d > 0 ? '+' : ''}{fmtFn(d)}</span>
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

const rateCellRender = (v) => {
  if (typeof v === 'number') return fmt(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return v == null ? '' : String(v);
};

const WF_DERIVED_KEYS = new Set(['gross', 'netAccrued', 'revenueAccrued', 'cgfDonation', 'revenueMinusCgf', 'netRevenueBeforeOpEx', 'firmProfits']);

const MonthTab = ({ data, rolledFrom, realNote, monthKey, edit }) => {
  const wf = data.waterfall || computeMonthlyWaterfall(data.inputs);
  const errs = data.sheetErrors || {};
  const hasDetail = !!data.matrix;
  const wfCellKey = (key) => (edit && monthKey ? wfKey(monthKey, key) : null);
  const waterfallCard = (
    <div>
      <SubHead>Accrual Waterfall</SubHead>
      <SheetWrap>
        <table className="border-collapse w-full">
          <tbody>
            <tr><td className={cx(cell, C.greenHead, 'text-right')}>Category</td><td className={cx(cell, C.greenHead, 'text-right')} style={{ minWidth: 130 }}>$</td></tr>
            {WATERFALL_ROWS.map(([label, key, tag]) => (
              <tr key={key}>
                <td className={cx(cell, 'text-right font-bold', tag === 'hl' && C.lightGreen, tag === 'green' && C.greenItalic)}>{label}</td>
                <td className={cx(cell, 'text-right', tag === 'hl' && cx(C.lightGreen, 'font-bold'), tag === 'red' && C.redItalic, tag === 'green' && C.greenItalic)}>
                  {errs[key] ? <span className={C.redItalic}>{errs[key]}</span> : <EditableNum cellKey={wfCellKey(key)} value={wf[key]} edit={edit} pinnable={WF_DERIVED_KEYS.has(key)} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </SheetWrap>
    </div>
  );

  if (!hasDetail) {
    return (
      <div className="space-y-3">
        {realNote && <div className="rounded-lg border border-[#d9ead3] bg-[#eaf7ea] px-3 py-2 text-[13px] text-cg-dark"><span className="font-semibold">Real data.</span> {realNote}</div>}
        <div className="max-w-xl">{waterfallCard}</div>
      </div>
    );
  }

  const { attorneys, matrix } = data;
  const totalBillings = attorneys.map((_, j) => sumColumn(matrix.map((r) => r.billings[j])));
  const tot = (k) => sumColumn(matrix.map((r) => r[k]));
  return (
    <div className="space-y-6">
      {rolledFrom && <div className="rounded-lg border border-[#cfe2f3] bg-[#eaf2fb] px-3 py-2 text-[13px] text-cg-dark"><span className="font-semibold">Rolled over from {rolledFrom}.</span> Structure cloned; inputs refreshed with new dummy data, so the waterfall recomputes.</div>}
      {realNote && <div className="rounded-lg border border-[#d9ead3] bg-[#eaf7ea] px-3 py-2 text-[13px] text-cg-dark"><span className="font-semibold">Real data.</span> {realNote}</div>}
      {Object.keys(errs).length > 0 && (
        <SourceNote>The sheet itself shows {Object.values(errs)[0]} for some waterfall cells (broken IMPORTRANGE at export time) — rendered as-is.</SourceNote>
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
                      <tr key={i}>
                        <td className={cx(cell, 'font-bold')}>{r.name}</td>
                        {r.vals.map((v, j) => (
                          <td key={j} className={cx(cell, typeof v === 'boolean' ? 'text-center' : 'text-right')}>{rateCellRender(v)}</td>
                        ))}
                      </tr>
                    ))}
                  </>
                ) : (
                  <>
                    <tr>{RATE_TABLE_COLS.map((c, i) => <td key={c} className={cx(cell, C.greenHead, i === 0 ? 'text-left' : 'text-right')}>{c}</td>)}</tr>
                    {data.rateTable.map((r, i) => (
                      <tr key={i}>
                        <td className={cx(cell, 'font-bold')}>{r.name}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.clientRate)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.takeHome)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.billableEarnings)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.earnings83b)}</td>
                        <td className={cx(cell, 'text-right')}>{fmt(r.personalReimb)}</td>
                        <td className={cx(cell, 'text-center')}>{r.check ? 'TRUE' : 'FALSE'}</td>
                        <td className={cx(cell, 'text-right')}>{fmt0(r.diff)}</td>
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
        <SheetWrap>
          <table className="border-collapse">
            <tbody>
              <tr>
                <td className={cx(cell, C.medGreenHead)} style={{ minWidth: 180 }}>Client</td>
                {attorneys.map((a) => <td key={a} className={cx(cell, C.grayHead, 'text-center')} style={{ minWidth: 70 }}>{a}</td>)}
                {MATRIX_TAIL.map((h) => <td key={h} className={cx(cell, h === 'Sum Billables' ? C.medGreenHead : C.grayHead, 'text-center')} style={{ minWidth: 90 }}>{h}</td>)}
              </tr>
              {matrix.map((r, ri) => {
                const bk = (j) => (edit && monthKey ? mxBillKey(monthKey, ri, j) : null);
                const fk = (f) => (edit && monthKey ? mxFieldKey(monthKey, ri, f) : null);
                return (
                  <tr key={r.client}>
                    <td className={cell}><span className="flex items-center justify-between gap-3"><span>{r.client}</span><span className="text-[8px] text-gray-400">▼</span></span></td>
                    {r.billings.map((v, j) => <td key={j} className={cx(cell, 'text-right')}><EditableNum cellKey={bk(j)} value={v} edit={edit} fmtFn={fmt0} /></td>)}
                    <td className={cx(cell, 'text-right italic', C.lightGreen)}>{fmt0(r.sumBillables)}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('elections83b')} value={r.elections83b} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('filingFees')} value={r.filingFees} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cell}>{r.feesNotes}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('outsideCounsel')} value={r.outsideCounsel} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cell}>{r.ocNotes}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('priorDeferred')} value={r.priorDeferred} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cell}>{r.priorToggle}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('deferredThisMonth')} value={r.deferredThisMonth} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}>{fmt0(r.totalDeferred)}</td>
                    <td className={cx(cell, 'text-right')}><EditableNum cellKey={fk('writeOff')} value={r.writeOff} edit={edit} fmtFn={fmt0} /></td>
                    <td className={cx(cell, 'text-right')}>{fmt0(r.invoiced)}</td>
                    <td className={cell}>{r.generalNotes}</td>
                    <td className={cell}>{r.contactName}</td>
                    <td className={cell}>{r.contactEmail}</td>
                    <td className={cx(cell, 'text-right')}>{r.paymentTerms}</td>
                  </tr>
                );
              })}
              <tr className="font-bold">
                <td className={cx(cell, C.lightGreen)}>Totals</td>
                {totalBillings.map((v, j) => <td key={j} className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(v)}</td>)}
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('sumBillables'))}</td>
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('elections83b'))}</td>
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('filingFees'))}</td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('outsideCounsel'))}</td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('priorDeferred'))}</td>
                <td className={cx(cell, C.lightGreen)} />
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('deferredThisMonth'))}</td>
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('totalDeferred'))}</td>
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('writeOff'))}</td>
                <td className={cx(cell, 'text-right', C.lightGreen)}>{fmt0(tot('invoiced'))}</td>
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
// Rate Sheet
// ===========================================================================
const RATE_LEVELS = [
  ['A1', 'A', false], ['A1', 'B', false], ['A2', 'A', false], ['A2', 'B', false],
  ['C1', 'A', false], ['C1', 'B', false], ['C2', 'A', false], ['C2', 'B', false],
  ['C3', 'A', false], ['C3', 'B', false], ['C4', 'A', false], ['C4', 'B', false],
  ['C5', 'A', false], ['C5', 'B', true], ['C6', 'A', true], ['C6', 'B', true],
  ['P1', 'A', true], ['P1', 'B', true], ['P2', 'A', true], ['P2', 'B', true],
];
const DUMMY_RATE_ROWS = RATE_LEVELS.map(([level, tier, hasColin], i) => ({
  level, tier,
  clientRate: 500 + i * 20,
  attorneyRate: 250 + i * 10,
  colinRate: hasColin ? 300 + i * 10 : null,
  salary: level.startsWith('P') ? 'Variable' : 200000 + i * 12000,
  cravath: i % 2 === 0 && !level.startsWith('P') ? 250000 + i * 15000 : null,
}));
const RATE_COLS = ['', '', 'Client Rate', 'Attorney Rate', 'Colin Rate', 'Est. Annual Salary (1200 Billed Hours)', 'Cravath Total Comp'];
const RATE_NOTES = [
  'A1 is equivalent to a Cravath first year.',
  'Leveling at each row is expected but not guaranteed every 6 months (quasi-lockstep).',
  'Leveling opportunity occurs after comprehensive performance reviews during the Q2 and Q4 on-sites, with new rates effective the following month.',
  'For outstanding, sustained performance (book prize) with a very sharp growth curve, discretionary extra leveling may occur at the end of any quarter.',
  'Semi-annual review cycles and leveling ensures the right balance of frequent forward momentum and meaningful feedback (unlike Big Law, annual lockstep).',
  '** Note that partners bill fewer client hours but receive profit share.',
];
const rateBand = (level) => (level.startsWith('C') ? 'bg-[#cfe2f3]' : level.startsWith('P') ? C.lightGreen : '');
const RateSheetScaffold = ({ rows }) => (
  <SheetWrap>
    <table className="border-collapse">
      <tbody>
        <tr>
          {RATE_COLS.map((h, i) => <td key={i} className={cx(cell, 'font-bold underline', i >= 2 ? 'text-right' : 'text-center')} style={{ minWidth: i === 5 ? 210 : 80 }}>{h}</td>)}
          <td className={cell} style={{ minWidth: 340 }} />
        </tr>
        {rows.map((r, i) => {
          const band = rateBand(r.level);
          const variable = r.salary === 'Variable';
          return (
            <tr key={i}>
              <td className={cx(cell, band, 'font-bold')}>{r.level}</td>
              <td className={cx(cell, band)}>{r.tier}</td>
              <td className={cx(cell, band, 'text-right')}>{fmt(r.clientRate)}</td>
              <td className={cx(cell, band, 'text-right')}>{fmt(r.attorneyRate)}</td>
              <td className={cx(cell, band, 'text-right')}>{typeof r.colinRate === 'number' ? fmt(r.colinRate) : ''}</td>
              <td className={cx(cell, band, 'text-right', variable && 'italic')}>{variable ? 'Variable' : fmt0(r.salary)}</td>
              {i % 2 === 0 && <td className={cx(cell, band, 'text-center italic align-middle')} rowSpan={2}>{r.cravath != null ? fmt0(r.cravath) : ''}</td>}
              {i === 0 && <td className={cx(cell, 'align-top text-[12px] leading-[1.5] whitespace-normal')} rowSpan={rows.length}><ul className="space-y-1">{RATE_NOTES.map((n, k) => <li key={k}>*{n}</li>)}</ul></td>}
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
            <tr>{CASH_COLS.map((h) => <td key={h} className={cx(cell, C.lightGreen, 'font-bold whitespace-normal')} style={{ minWidth: 100 }}>{h}</td>)}</tr>
            {withDerived.map((r, i) => (
              <tr key={i}>
                <td className={cell}>{r.month}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'cashReceived')} value={r.cashReceived} edit={edit} /> : fmt(0)}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'expenses')} value={r.expenses} edit={edit} /> : fmt(0)}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'cgfDonation')} value={r.cgfDonation} edit={edit} /> : ''}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <EditableNum cellKey={ck(r, 'attorneyPayout')} value={r.attorneyPayout} edit={edit} /> : ''}</td>
                <td className={cx(cell, 'text-right')}>{r.filled ? <DeltaVal value={r.profits} base={b(i, 'profits')} /> : ''}</td>
                <td className={cx(cell, 'text-right', !r.filled && C.redItalic)}>{r.filled ? <DeltaVal value={r.revenueAccrued} base={b(i, 'revenueAccrued')} /> : '#REF!'}</td>
                <td className={cx(cell, 'text-right')}>{r.qRevenue != null ? <DeltaVal value={r.qRevenue} base={b(i, 'qRevenue')} /> : ''}</td>
              </tr>
            ))}
            <tr className="font-bold">
              <td className={cx(cell, C.lightGreen)}>Totals</td>
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
        <tr>{['Date (UTC)', 'Description', 'Amount', 'Note'].map((h, i) => <td key={h} className={cx(cell, 'font-bold', i === 2 ? 'text-right' : '')} style={{ minWidth: i === 3 ? 320 : 110 }}>{h}</td>)}</tr>
        {rows.map((r, i) => {
          const bg = r.highlight === 'green' ? C.lightGreen : r.highlight === 'tan' ? C.tan : '';
          return (
            <tr key={i}>
              <td className={cx(cell, 'font-bold')}>{r.date}</td>
              <td className={cell}>{r.description}</td>
              <td className={cx(cell, 'text-right')}>{fmt(r.amount)}</td>
              <td className={cx(cell, bg)}>{r.note}</td>
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
    <SheetWrap>
      <table className="border-collapse">
        <tbody>
          <tr>
            <td className={cx(cell, C.greenHead)} style={{ minWidth: 160 }}>Expense Category</td>
            <td className={cx(cell, C.greenHead)} style={{ minWidth: 200 }}>Label</td>
            {MONTHS12.map((m) => <td key={m} className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 80 }}>{m}</td>)}
            <td className={cx(cell, C.greenHead, 'text-center')} style={{ minWidth: 140 }}>P&amp;L Category</td>
          </tr>
          {rows.map((r, i) => (
            <tr key={i} className={r.highlight ? C.yellow : ''}>
              <td className={cx(cell, 'font-bold', r.highlight && C.yellow)}>{r.category}</td>
              <td className={cx(cell, r.highlight && C.yellow)}>{r.label}</td>
              {r.vals.map((v, k) => <td key={k} className={cx(cell, 'text-right', r.highlight && C.yellow)}><EditableNum cellKey={edit ? expKey(i, k) : null} value={v} edit={edit} /></td>)}
              <td className={cx(cell, r.highlight && C.yellow)}>{r.pnlCat || ''}</td>
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
              const bandCls = r.t === 'band' ? C.blueBand : 'font-bold';
              return (
                <tr key={i}>
                  <td className={cx(cell, bandCls)}>{r.label}</td>
                  {months.map((m) => <td key={m} className={cx(cell, r.t === 'band' && C.blueBand)} />)}
                  <td className={cx(cell, r.t === 'band' && C.blueBand)} />
                </tr>
              );
            }
            const strong = r.t === 'total' || r.t === 'lineTotal' || r.t === 'grand';
            const hl = r.t === 'grand' ? C.tan : '';
            const indent = r.t === 'line' || r.t === 'lineTotal';
            const baseVals = baseRows && baseRows[i] ? baseRows[i].vals : null;
            return (
              <tr key={i}>
                <td className={cx(cell, indent && 'pl-6', strong && 'font-bold', hl)}>{r.label}</td>
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
        <SourceNote>Payment terms aren&apos;t stored on this sheet (they live in the clients sheet / Firestore) — Terms and Days Overdue show &quot;—&quot;; reminders use the non-Net-30 default cadence.</SourceNote>
      )}
      <SheetWrap>
        <table className="border-collapse">
          <tbody>
            <tr>
              <td className={cx(cell, 'font-bold underline')} style={{ minWidth: 200 }}>All 2026 Billing</td>
              <td className={cx(cell, 'font-bold underline text-right')} style={{ minWidth: 100 }}>{fmt(total)}</td>
              {PAYMENT_HEADERS.map((h) => <td key={h} className={cx(cell, 'font-bold underline')}>{h}</td>)}
              {REMINDER_HEADERS.map((h) => <td key={h} className={cx(cell, C.lightGreen, 'font-bold text-center')}>{h}</td>)}
            </tr>
            {rows.map((r, i) => (
              <tr key={i}>
                <td className={cell}>{r.client}</td>
                <td className={cx(cell, 'text-right')}><EditableNum cellKey={edit ? regKey(i) : null} value={r.amount} edit={edit} /></td>
                <td className={cell}>{r.year}</td>
                <td className={cell}>{fmtDate(r.dateSent)}</td>
                <td className={cx(cell, 'text-center')}>{r.paymentTerms != null ? `Net ${r.paymentTerms}` : '—'}</td>
                <td className={cell}><PaymentPill value={r.status} /></td>
                <td className={cx(cell, 'text-right')}>{fmtDate(r.lastReminder)}</td>
                <td className={cx(cell, 'text-right')}>{fmtDate(r.dateReceived)}</td>
                <td className={cell}>{r.notes}</td>
                <td className={cx(cell, 'text-right', r.overdue > 0 && C.redItalic)}>{r.overdue > 0 ? `${r.overdue}d` : '—'}</td>
                <td className={cell}>{r.next ? `${r.next.name} · ${fmtDate(r.next.dueDate)}` : '—'}</td>
                <td className={cx(cell, 'text-center')}>{r.next ? (r.due ? <span className="text-[#188038] font-semibold">Due</span> : 'Upcoming') : '—'}</td>
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

  // The workbook backing Real mode: live if we have it, else the frozen snapshot.
  const usingFallback = real && liveStatus === 'error';
  const activeWorkbook = liveWorkbook || FROZEN_WORKBOOK;

  // Apply sandbox overrides, then assemble the view dataset from the result.
  // resolveWorkbook is pure, so memoizing on [workbook, overrides] is safe.
  const { resolvedWorkbook, meta } = useMemo(() => {
    if (!real) return { resolvedWorkbook: null, meta: new Map() };
    const res = resolveWorkbook(activeWorkbook, overrides);
    return { resolvedWorkbook: res.workbook, meta: res.meta };
  }, [real, activeWorkbook, overrides]);
  const realDataset = useMemo(
    () => (real ? buildRealDataset(resolvedWorkbook) : FROZEN_REAL_DATASET),
    [real, resolvedWorkbook],
  );
  // Cached (no-override) dataset — the delta baseline for cells that change from
  // an upstream what-if edit but aren't directly editable (P&L, Cash derived).
  // Only needed once edits exist.
  const baseDataset = useMemo(
    () => (real && editCount > 0 ? buildRealDataset(activeWorkbook) : null),
    [real, editCount, activeWorkbook],
  );
  const edit = real ? { editable: true, meta, onEdit } : null;

  const monthKeys = real ? REAL_MONTH_ORDER : DUMMY_MONTH_KEYS;
  const monthDataFor = (key) => (real ? realDataset.monthData[key] : MONTH_DATA[key]);

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
  const tabs = [...NON_MONTH_LEFT, ...monthTabs, { key: 'copy-payment-status', label: COPY_TAB_LABEL }];

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
      return <MonthTab data={data} monthKey={real ? activeTab : undefined} edit={edit} realNote={real ? `${MONTH_LABEL[activeTab]} 2026 — waterfall recomputed from the live month totals through our calc chain.` : undefined} />;
    }
    const ds = realDataset;
    switch (activeTab) {
      case 'rate-sheet': return <RateSheetScaffold rows={real ? ds.rateSheet : DUMMY_RATE_ROWS} />;
      case 'cash-accounting': return <CashAccountingScaffold rows={real ? ds.cashRows : DUMMY_CASH_ROWS} baseRows={baseDataset ? baseDataset.cashRows : undefined} edit={edit} />;
      case 'profits-paid': return <ProfitsPaidScaffold rows={real ? ds.profitsRows : DUMMY_PROFITS_ROWS} />;
      case 'expenses': return <ExpensesScaffold rows={real ? ds.expenseRows : EXP_ROWS} edit={edit} />;
      case 'pnl': return <PnlScaffold months={(real ? ds.pnl : DUMMY_PNL).months} rows={(real ? ds.pnl : DUMMY_PNL).rows} baseRows={baseDataset ? baseDataset.pnl.rows : undefined} />;
      case 'balance-sheet': return <BalanceSheetScaffold rows={real ? ds.balanceRows.map(classifyBalanceRow) : BALANCE_ROWS} />;
      case 'payment-status':
        return real
          ? <PaymentStatusScaffold register={ds.paymentRows} total={ds.paymentTotal} realTerms={false} edit={edit} />
          : <PaymentStatusScaffold register={PAYMENT_ROWS} total={PAYMENT_TOTAL} />;
      case 'copy-payment-status':
        return real
          ? <PaymentStatusScaffold register={ds.copyRows} total={ds.copyTotal} realTerms={false} />
          : <PaymentStatusScaffold register={PAYMENT_ROWS} total={PAYMENT_TOTAL} />;
      default: return null;
    }
  };

  const loadingLive = real && liveStatus === 'loading' && !liveWorkbook;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-2xl font-bold text-cg-black">Invoices (testing)</h2>
          <p className="text-sm text-cg-dark">Connected replica of the Invoices (2026) workbook — sub-tabs reference each other like the real cross-sheet formulas.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden text-[13px]">
            <button onClick={() => switchMode('dummy')} className={cx('px-3 py-2 font-medium', !real ? 'bg-cg-green text-white' : 'text-gray-600 hover:bg-gray-50')}>Dummy</button>
            <button onClick={() => switchMode('real')} className={cx('px-3 py-2 font-medium border-l border-gray-300', real ? 'bg-cg-green text-white' : 'text-gray-600 hover:bg-gray-50')}>Real (live sheet)</button>
          </div>
          {real && (
            <button
              onClick={() => fetchLive(true)}
              disabled={liveStatus === 'loading'}
              className="px-3 py-2 text-[13px] font-medium rounded-lg border border-gray-300 text-cg-dark hover:bg-gray-50 disabled:opacity-40"
              title="Re-read the Google Sheet (bypasses the 5-minute server cache)"
            >
              {liveStatus === 'loading' ? 'Refreshing…' : '↻ Refresh from sheet'}
            </button>
          )}
          {!real && (
            <button onClick={rollOver} disabled={!next} className="px-3 py-2 text-[13px] font-medium rounded-lg border border-gray-300 text-cg-dark hover:bg-gray-50 disabled:opacity-40" title={next ? `Roll over to ${labelOf(next.name, next.year)}` : ''}>
              + Next month{next ? ` · ${labelOf(next.name, next.year)}` : ''}
            </button>
          )}
        </div>
      </div>

      {real && liveStatus === 'ready' && (
        <div className="rounded-lg border border-[#d9ead3] bg-[#eaf7ea] px-3 py-2 text-[13px] text-cg-dark flex items-center justify-between gap-3 flex-wrap">
          <span><span className="font-semibold">Live from the Google Sheet.</span> Every sub-tab reads the workbook directly and recomputes through our calc chain — edit the sheet, refresh, and it propagates here.</span>
          {fetchedAt && <span className="text-[12px] text-gray-500 whitespace-nowrap">Synced {fmtSyncedAt(fetchedAt)}</span>}
        </div>
      )}
      {usingFallback && (
        <div className="rounded-lg border border-[#f0c36d] bg-[#fdf6e3] px-3 py-2 text-[13px] text-[#7f6000]">
          <span className="font-semibold">Live fetch failed — showing the frozen 7/2 snapshot.</span> {liveError}
          {' '}<button onClick={() => fetchLive(true)} className="underline font-medium">Retry</button>
        </div>
      )}
      {real && editCount > 0 && (
        <div className="sticky top-0 z-10 rounded-lg border border-[#c78a00] bg-[#fdf6e3] px-3 py-2 text-[13px] text-[#7f6000] flex items-center justify-between gap-3 flex-wrap">
          <span>
            <span className="font-semibold">{editCount} local edit{editCount > 1 ? 's' : ''} — sandbox only.</span>{' '}
            Not written to the Google Sheet or anywhere else; refreshing or switching mode discards {editCount > 1 ? 'them' : 'it'}.
          </span>
          <button onClick={() => setOverrides({})} className="rounded-md border border-[#c78a00] px-2.5 py-1 text-[12px] font-medium hover:bg-[#f7ecc9]">Reset all</button>
        </div>
      )}
      {real && liveStatus === 'ready' && editCount === 0 && (
        <p className="text-[12px] text-gray-500">Tip: on the month, Cash Accounting, Expenses V2, and Payment Status tabs you can click any number to model a what-if — the effect ripples through the waterfalls, Cash summary, and P&amp;L (Revenue &amp; expenses → NET INCOME) with old→new deltas, and never touches the sheet.</p>
      )}

      <div className="flex gap-0 border-b border-gray-300 overflow-x-auto">
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key)} className={cx('px-4 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px transition-colors', activeTab === tab.key ? 'text-[#188038] border-[#188038] bg-[#e6f4ea]' : 'text-gray-600 border-transparent hover:bg-gray-50')}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeDrift && (
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-gray-500">vs Google Sheet:</span>
          <DriftChip drift={activeDrift} />
        </div>
      )}

      {loadingLive ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-10 justify-center">
          <span className="h-4 w-4 rounded-full border-2 border-gray-300 border-t-cg-green animate-spin" />
          Reading the Google Sheet…
        </div>
      ) : (
        renderTab()
      )}
    </div>
  );
};

export default InvoicesTestingView;
