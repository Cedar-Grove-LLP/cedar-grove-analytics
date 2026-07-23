"use client";

import { useState, useMemo, useEffect } from 'react';
import { collection, onSnapshot, addDoc, deleteDoc, doc, getDocs, serverTimestamp, Timestamp } from 'firebase/firestore';
import { db, auth } from '@/firebase/config';
import {
  useUsers,
  useUserBillableEntries,
  useUserOpsEntries,
  useUserEightThreeBEntries,
  useUserSheetTotals,
  useDataWarnings,
  useClients,
} from '@/hooks/useFirestoreData';
import { useFirestoreCache } from '@/context/FirestoreDataContext';
import { CalcTooltip } from '@/components/shared';
import { getEntryDate } from '@/utils/dateHelpers';
import { findRateInfo } from '@/utils/rateLookup.mjs';
import { OPS_CATEGORIES, BILLING_CATEGORIES } from '@/utils/constants';

// ---------------------------------------------------------------------------
// Timesheets (testing) — read-only mirror of per-attorney timesheet workbook
// rows as synced to Firestore (users/{name}/billables|ops|eightThreeB).
// ---------------------------------------------------------------------------

const cx = (...a) => a.filter(Boolean).join(' ');
const cell = 'border-b border-gray-100 px-3 py-[7px] text-[13px] leading-[1.5] whitespace-nowrap tabular-nums';
const C = {
  greenHead: 'bg-[#f3f5ee] text-[11px] uppercase tracking-wider text-cg-dark font-semibold sticky top-0 z-10',
  lightGreen: 'bg-[#e9f4ec]',
};
const fmt = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Number(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmt0 = (n) => `${Number(n) < 0 ? '-' : ''}$${Math.abs(Math.round(Number(n))).toLocaleString('en-US')}`;

// Cents matter on a mirror page (e.g. a $125.99 reimbursement), so money
// defaults to the cents formatter here, unlike InvoicesTestingView's fmt0.
const Money = ({ v, f = fmt }) => (Math.abs(Number(v) || 0) > 0.004 ? <>{f(v)}</> : <span className="text-gray-300">–</span>);

const Hrs = ({ v }) => {
  const n = Number(v) || 0;
  if (Math.abs(n) < 0.0001) return <span className="text-gray-300">–</span>;
  const r = Math.round((n + Number.EPSILON) * 100) / 100;
  return <>{r.toString()}</>;
};

const SheetWrap = ({ children, maxH }) => (
  <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm" style={maxH ? { maxHeight: maxH, overflowY: 'auto' } : undefined}>{children}</div>
);
const SubHead = ({ children }) => (
  <p className="mb-1.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-cg-dark/70">
    <span className="inline-block h-3 w-1 rounded-full bg-cg-green" />{children}
  </p>
);
const StatCard = ({ label, value, tone, calcKey }) => (
  <div className={cx(
    'rounded-xl border px-3.5 py-2.5 min-w-[130px] shadow-sm',
    tone === 'red' ? 'border-red-100 bg-red-50/70' : tone === 'amber' ? 'border-amber-200 bg-amber-50' : 'border-gray-200 bg-white',
  )}>
    <div className="text-[10px] font-semibold uppercase tracking-wider text-gray-600 inline-flex items-center gap-1">
      {label}
      {calcKey ? <CalcTooltip calcKey={calcKey} position="bottom" /> : null}
    </div>
    <div className={cx(
      'mt-0.5 text-[15px] font-bold tabular-nums',
      tone === 'red' ? 'text-red-700' : tone === 'amber' ? 'text-amber-800' : 'text-cg-black',
    )}>{value}</div>
  </div>
);
const SourceNote = ({ children }) => <p className="text-[12px] leading-relaxed text-gray-600 mb-2">{children}</p>;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthIndex = (name) => MONTHS.indexOf(name);

const buildMonthKey = (year, month) => `${year}_${month}`;
const parseMonthKey = (key) => {
  const idx = key.indexOf('_');
  if (idx < 0) return { year: 0, month: '' };
  return { year: Number(key.slice(0, idx)), month: key.slice(idx + 1) };
};

const sortMonthKeysDesc = (keys) => [...keys].sort((a, b) => {
  const pa = parseMonthKey(a);
  const pb = parseMonthKey(b);
  if (pb.year !== pa.year) return pb.year - pa.year;
  return monthIndex(pb.month) - monthIndex(pa.month);
});

const collectMonthKeys = (billables, ops, eightThreeB, sheetTotals) => {
  const keys = new Set(Object.keys(sheetTotals || {}));
  for (const entry of [...billables, ...ops, ...eightThreeB]) {
    if (entry?.year != null && entry?.month) keys.add(buildMonthKey(entry.year, entry.month));
  }
  return sortMonthKeysDesc([...keys]);
};

const fmtHrsText = (n) => {
  const v = Number(n) || 0;
  if (Math.abs(v) < 0.0001) return '–';
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  return `${r.toString()}h`;
};

const fmtDeltaHrs = (d) => {
  const v = Number(d) || 0;
  const r = Math.round((v + Number.EPSILON) * 100) / 100;
  const s = r.toString();
  return v >= 0 ? `+${s}` : s;
};

const fmtDeltaMoney = (d) => {
  const v = Number(d) || 0;
  return v >= 0 ? `+${fmt(v)}` : fmt(v);
};

const NotSynced = () => <span className="text-gray-500">–</span>;

// Synced `date` values are a mix of strings and Firestore Timestamps
// ({seconds, nanoseconds}), so always normalize through getEntryDate before
// rendering — a raw Timestamp object crashes React.
const EntryDate = ({ entry }) => {
  const d = getEntryDate(entry);
  if (!d || isNaN(d.getTime())) return <span className="text-gray-300">–</span>;
  return <>{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</>;
};

const DriftStatCard = ({ label, sheetVal, computed, formatValue, formatDelta }) => {
  if (sheetVal == null || (Number(sheetVal) === 0 && Math.abs(computed) > 0.0001)) {
    return <StatCard label={label} value={<NotSynced />} />;
  }
  const delta = computed - Number(sheetVal);
  if (Math.abs(delta) > 0.005) {
    return (
      <StatCard
        label={label}
        tone="amber"
        calcKey="timesheetMirrorDrift"
        value={`${formatValue(sheetVal)} (Δ ${formatDelta(delta)})`}
      />
    );
  }
  return (
    <StatCard
      label={label}
      calcKey="timesheetMirrorSheetTotals"
      value={formatValue(sheetVal)}
    />
  );
};

const SheetOnlyStatCard = ({ label, value, formatValue = fmt, calcKey = 'timesheetMirrorSheetTotals' }) => (
  <StatCard
    label={label}
    calcKey={calcKey}
    value={value == null ? <NotSynced /> : formatValue(value)}
  />
);

const sortBySheetRow = (rows) => [...rows].sort((a, b) => (a.sheetRowNumber ?? Infinity) - (b.sheetRowNumber ?? Infinity));

// Legal-ops staff (role like "Legal Operations Associate") log almost entirely
// ops time, so the tab opens them on Ops; every attorney role opens on
// Billables. Matches on the role string so a future "Legal Ops" / "Operations
// Manager" title lands the same way without a code change.
const isOpsFirstRole = (role) => {
  const r = (role || '').toLowerCase();
  return r.includes('operations') || r.includes('legal ops') || /\bops\b/.test(r);
};

const pad2 = (n) => String(n).padStart(2, '0');
const toLocalIso = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// Newest date first; falls back to createdAt so two entries on the same day keep
// the most recently added on top.
const sortByDateDesc = (rows) => [...rows].sort((a, b) => {
  const ta = getEntryDate(a)?.getTime() || 0;
  const tb = getEntryDate(b)?.getTime() || 0;
  if (tb !== ta) return tb - ta;
  const ca = a.createdAt?.seconds || 0;
  const cb = b.createdAt?.seconds || 0;
  return cb - ca;
});

const TimesheetsTestingView = () => {
  const { users, loading: usersLoading } = useUsers();
  const warnings = useDataWarnings();
  const { clients } = useClients();
  const { allRates } = useFirestoreCache();

  const sortedUsers = useMemo(
    () => [...(users || [])].sort((a, b) => (a.name || a.id).localeCompare(b.name || b.id)),
    [users],
  );

  const [selectedUserName, setSelectedUserName] = useState('');
  const [selectedMonthKey, setSelectedMonthKey] = useState('');

  const effectiveUserName = selectedUserName || (sortedUsers[0]?.name || sortedUsers[0]?.id || '');

  // Resolve the selected user's Firestore doc id (doc ids ARE display names in
  // this schema, but resolve through the user object so we never guess).
  const selectedUser = useMemo(
    () => sortedUsers.find((u) => (u.name || u.id) === effectiveUserName),
    [sortedUsers, effectiveUserName],
  );
  const selectedUserId = selectedUser?.id || effectiveUserName;

  // Which entry surface shows — 'billables' | 'ops', one at a time. The
  // default follows the person's function: legal-ops staff (e.g. Valery,
  // role "Legal Operations Associate") log almost entirely ops, so they open
  // on Ops; attorneys — part-time, full-time, and the ops-heavy partners
  // alike — open on Billables. A manual toggle overrides until the user
  // switches (derived-default + override, matching the reset-on-change
  // pattern used for the entry forms below).
  const defaultEntryMode = isOpsFirstRole(selectedUser?.role) ? 'ops' : 'billables';
  const [entryModeOverride, setEntryModeOverride] = useState(null);
  const entryMode = entryModeOverride || defaultEntryMode;

  // Manual ops entries (users/{id}/opsManual) — the app's own write target,
  // kept separate from the sheet-synced ops/. Live listener so adds/deletes
  // reflect instantly without a full cache refetch.
  const [manualOps, setManualOps] = useState([]);
  const [manualBillables, setManualBillables] = useState([]);
  const [manualError, setManualError] = useState('');

  useEffect(() => {
    if (!selectedUserId) { setManualOps([]); setManualBillables([]); return undefined; }
    setManualError('');
    const onErr = (err) => setManualError(err?.code === 'permission-denied'
      ? 'Cannot read manual entries — the opsManual/billablesManual Firestore rules may not be deployed yet.'
      : (err?.message || 'Failed to load manual entries.'));
    const unsubOps = onSnapshot(
      collection(db, 'users', selectedUserId, 'opsManual'),
      (snap) => setManualOps(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      onErr,
    );
    const unsubBill = onSnapshot(
      collection(db, 'users', selectedUserId, 'billablesManual'),
      (snap) => setManualBillables(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      onErr,
    );
    return () => { unsubOps(); unsubBill(); };
  }, [selectedUserId]);

  // Matters (managed by the Sheets Apps Script for the timesheet dropdowns)
  // drive the Matter suggestions, filtered by the chosen client. One-shot
  // fetch — the list changes rarely.
  const [matters, setMatters] = useState([]);
  useEffect(() => {
    let cancelled = false;
    getDocs(collection(db, 'matters'))
      .then((snap) => { if (!cancelled) setMatters(snap.docs.map((d) => d.data())); })
      .catch(() => {}); // suggestions only — the field still accepts free text
    return () => { cancelled = true; };
  }, []);

  const { data: billableEntries, loading: billablesLoading, error: billablesError } = useUserBillableEntries(effectiveUserName);
  const { data: opsEntries, loading: opsLoading, error: opsError } = useUserOpsEntries(effectiveUserName);
  const { data: eightThreeBEntries, loading: eightThreeBLoading, error: eightThreeBError } = useUserEightThreeBEntries(effectiveUserName);
  const { data: sheetTotals, loading: sheetTotalsLoading } = useUserSheetTotals(effectiveUserName);

  const monthKeys = useMemo(() => {
    const set = new Set(collectMonthKeys(billableEntries, opsEntries, eightThreeBEntries, sheetTotals));
    // Months that only have manual entries must still be selectable.
    [...manualOps, ...manualBillables].forEach((e) => { if (e.year != null && e.month) set.add(buildMonthKey(e.year, e.month)); });
    // Always allow entering into the current month, even for a user with no
    // synced history yet — otherwise the entry bar would be unreachable.
    const now = new Date();
    set.add(buildMonthKey(now.getFullYear(), MONTHS[now.getMonth()]));
    return sortMonthKeysDesc([...set]);
  }, [billableEntries, opsEntries, eightThreeBEntries, sheetTotals, manualOps, manualBillables]);

  const effectiveMonthKey = (selectedMonthKey && monthKeys.includes(selectedMonthKey))
    ? selectedMonthKey
    : (monthKeys[0] || '');

  const { year: selectedYear, month: selectedMonth } = useMemo(
    () => parseMonthKey(effectiveMonthKey),
    [effectiveMonthKey],
  );

  const filteredBillables = useMemo(
    () => sortBySheetRow(billableEntries.filter((e) => e.year === selectedYear && e.month === selectedMonth)),
    [billableEntries, selectedYear, selectedMonth],
  );
  const filteredOps = useMemo(
    () => sortBySheetRow(opsEntries.filter((e) => e.year === selectedYear && e.month === selectedMonth)),
    [opsEntries, selectedYear, selectedMonth],
  );
  const filteredEightThreeB = useMemo(
    () => sortBySheetRow(eightThreeBEntries.filter((e) => e.year === selectedYear && e.month === selectedMonth)),
    [eightThreeBEntries, selectedYear, selectedMonth],
  );

  const showAdjustmentCol = filteredBillables.some((e) => Math.abs(Number(e.adjustment) || 0) > 0.005);
  const showEightThreeBSection = filteredEightThreeB.length > 0;

  const sumBillableHours = filteredBillables.reduce((s, e) => s + (Number(e.billableHours) || 0), 0);
  const sumEarnings = filteredBillables.reduce((s, e) => s + (Number(e.earnings) || 0), 0);
  const sumAdjustment = filteredBillables.reduce((s, e) => s + (Number(e.adjustment) || 0), 0);
  const sumReimbursements = filteredBillables.reduce((s, e) => s + (Number(e.reimbursements) || 0), 0);
  const sumOpsHours = filteredOps.reduce((s, e) => s + (Number(e.opsHours) || 0), 0);
  const sumTotalHours = sumBillableHours + sumOpsHours;
  const sumFlatFee = filteredEightThreeB.reduce((s, e) => s + (Number(e.flatFee) || 0), 0);

  // Manual ops for the selected month, normalized to the same shape the ops
  // table renders (opsHours + __manual flag), merged with the synced (mirror)
  // rows and sorted newest-date-first.
  const filteredManualOps = useMemo(
    () => manualOps
      .filter((e) => e.year === selectedYear && e.month === selectedMonth)
      .map((e) => ({ ...e, opsHours: Number(e.hours) || 0, __manual: true })),
    [manualOps, selectedYear, selectedMonth],
  );
  const sumManualOpsHours = filteredManualOps.reduce((s, e) => s + (Number(e.opsHours) || 0), 0);
  const mergedOps = useMemo(
    () => sortByDateDesc([...filteredOps.map((e) => ({ ...e, __manual: false })), ...filteredManualOps]),
    [filteredOps, filteredManualOps],
  );
  // Footer reflects what's in the table (synced mirror + manual); the drift
  // stat cards above stay synced-only so the sheet comparison stays faithful.
  const sumOpsHoursDisplayed = sumOpsHours + sumManualOpsHours;

  // Manual billables, merged with the synced mirror rows the same way.
  const filteredManualBillables = useMemo(
    () => manualBillables
      .filter((e) => e.year === selectedYear && e.month === selectedMonth)
      .map((e) => ({ ...e, billableHours: Number(e.hours) || 0, earnings: Number(e.earnings) || 0, adjustment: 0, reimbursements: 0, __manual: true })),
    [manualBillables, selectedYear, selectedMonth],
  );
  const sumManualBillableHours = filteredManualBillables.reduce((s, e) => s + (Number(e.billableHours) || 0), 0);
  const sumManualEarnings = filteredManualBillables.reduce((s, e) => s + (Number(e.earnings) || 0), 0);
  const mergedBillables = useMemo(
    () => sortByDateDesc([...filteredBillables.map((e) => ({ ...e, __manual: false })), ...filteredManualBillables]),
    [filteredBillables, filteredManualBillables],
  );
  const sumBillableHoursDisplayed = sumBillableHours + sumManualBillableHours;
  const sumEarningsDisplayed = sumEarnings + sumManualEarnings;

  // Date bounds for the entry picker: constrain to the selected month so a new
  // entry always lands in the month whose table is on screen. Default to today
  // when viewing the current month, else the 1st of the selected month.
  const selMonthNum = monthIndex(selectedMonth) + 1;
  const now = new Date();
  const isCurrentMonth = selectedYear === now.getFullYear() && selMonthNum === now.getMonth() + 1;
  const monthStartIso = selectedMonth ? `${selectedYear}-${pad2(selMonthNum)}-01` : '';
  const monthEndIso = selectedMonth
    ? `${selectedYear}-${pad2(selMonthNum)}-${pad2(new Date(selectedYear, selMonthNum, 0).getDate())}`
    : '';
  const defaultDate = isCurrentMonth ? toLocalIso(now) : monthStartIso;

  const [form, setForm] = useState({ description: '', category: '', date: '', hours: '' });
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState('');
  const EMPTY_BILL_FORM = { client: '', matter: '', date: '', hours: '', category: '', notes: '' };
  const [bForm, setBForm] = useState(EMPTY_BILL_FORM);
  const [bSaving, setBSaving] = useState(false);
  const [bAddError, setBAddError] = useState('');
  const resetForm = () => {
    setForm({ description: '', category: '', date: '', hours: '' });
    setAddError('');
    setBForm(EMPTY_BILL_FORM);
    setBAddError('');
  };

  const formDate = form.date || defaultDate;
  const hoursNum = Number(form.hours);
  const canSubmit = !!selectedUserId && form.description.trim() !== '' && form.category !== '' && formDate !== '' && hoursNum > 0 && !saving;

  const handleAddOps = async () => {
    if (!canSubmit) { setAddError('Fill in description, category, date, and hours (> 0).'); return; }
    const [y, m, d] = formDate.split('-').map(Number);
    setSaving(true);
    setAddError('');
    try {
      await addDoc(collection(db, 'users', selectedUserId, 'opsManual'), {
        date: Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0)),
        description: form.description.trim(),
        category: form.category,
        hours: hoursNum,
        month: MONTHS[m - 1],
        year: y,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || '',
      });
      resetForm();
    } catch (err) {
      setAddError(err?.code === 'permission-denied'
        ? 'Save denied — the opsManual Firestore rule may not be deployed yet.'
        : (err?.message || 'Failed to save entry.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteManual = async (subcol, entryId) => {
    if (!selectedUserId || !entryId) return;
    if (typeof window !== 'undefined' && !window.confirm('Delete this manual entry?')) return;
    try {
      await deleteDoc(doc(db, 'users', selectedUserId, subcol, entryId));
    } catch (err) {
      setManualError(err?.message || 'Failed to delete entry.');
    }
  };

  // ---- Billables entry form ------------------------------------------------
  const clientOptions = useMemo(
    () => [...new Set((clients || []).map((c) => c.clientName).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [clients],
  );
  const matterOptions = useMemo(
    () => [...new Set(matters.filter((m) => m.clientName === bForm.client).map((m) => m.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)),
    [matters, bForm.client],
  );

  const bFormDate = bForm.date || defaultDate;
  const bHoursNum = Number(bForm.hours);
  // Take-home rate for the entry month (the sheet's "Rate" cell — NOT the
  // client billing rate), resolved with the same backward fallback as every
  // other rate lookup. Earnings = hours × take-home, frozen at save time.
  const userRates = allRates?.[effectiveUserName] || null;
  const bTakeHome = useMemo(() => {
    if (!userRates || !bFormDate) return 0;
    const info = findRateInfo(userRates, bFormDate.slice(0, 7));
    return info.sourceMonthKey ? (Number(userRates[info.sourceMonthKey]?.takeHomeRate) || 0) : 0;
  }, [userRates, bFormDate]);
  const bEarnings = bHoursNum > 0 ? Math.round(bHoursNum * bTakeHome * 100) / 100 : 0;
  const canSubmitBill = !!selectedUserId && bForm.client !== '' && bForm.category !== ''
    && bFormDate !== '' && bHoursNum > 0 && bTakeHome > 0 && !bSaving;

  const handleAddBillable = async () => {
    if (!canSubmitBill) {
      setBAddError(bTakeHome > 0
        ? 'Fill in client, category, date, and hours (> 0).'
        : `No take-home rate configured for ${effectiveUserName} this month — add it in User Management first.`);
      return;
    }
    const [y, m, d] = bFormDate.split('-').map(Number);
    setBSaving(true);
    setBAddError('');
    try {
      await addDoc(collection(db, 'users', selectedUserId, 'billablesManual'), {
        date: Timestamp.fromDate(new Date(y, m - 1, d, 12, 0, 0)),
        client: bForm.client,
        matter: bForm.matter.trim(),
        hours: bHoursNum,
        earnings: bEarnings,
        billingCategory: bForm.category,
        notes: bForm.notes.trim(),
        adjustment: 0,
        reimbursements: 0,
        month: MONTHS[m - 1],
        year: y,
        createdAt: serverTimestamp(),
        createdBy: auth.currentUser?.email || '',
      });
      setBForm(EMPTY_BILL_FORM);
    } catch (err) {
      setBAddError(err?.code === 'permission-denied'
        ? 'Save denied — the billablesManual Firestore rule may not be deployed yet.'
        : (err?.message || 'Failed to save entry.'));
    } finally {
      setBSaving(false);
    }
  };

  const monthTotals = sheetTotals?.[effectiveMonthKey];
  const filteredWarnings = (warnings[effectiveUserName] || []).filter(
    (w) => w.month === selectedMonth && w.year === selectedYear,
  );

  const dataLoading = billablesLoading || opsLoading || eightThreeBLoading || sheetTotalsLoading;
  const hasError = billablesError || opsError || eightThreeBError;

  const billableColCount = 10 + (showAdjustmentCol ? 1 : 0);

  return (
    <div className="space-y-4">
      <div>
        <SubHead>Timesheets (testing)</SubHead>
        <SourceNote>
          Read-only mirror of the per-attorney timesheet workbook rows as synced to Firestore
          (<code className="text-[11px]">users/&#123;name&#125;/billables|ops|eightThreeB</code>).
          Only the <strong>current</strong> month re-syncs — historical months are frozen at their last sync,
          so edits to old sheet tabs will not appear here.
        </SourceNote>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label htmlFor="timesheets-user" className="flex flex-col gap-1 text-sm text-cg-dark">
          <span className="font-medium">User</span>
          <select
            id="timesheets-user"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            value={effectiveUserName}
            onChange={(e) => {
              setSelectedUserName(e.target.value);
              setSelectedMonthKey('');
              setEntryModeOverride(null); // new user → their role's default surface
              resetForm();
            }}
            disabled={usersLoading || sortedUsers.length === 0}
          >
            {sortedUsers.map((u) => {
              const name = u.name || u.id;
              return (
                <option key={u.id} value={name}>
                  {name}{u.active === false ? ' (inactive)' : ''}
                </option>
              );
            })}
          </select>
        </label>

        <label htmlFor="timesheets-month" className="flex flex-col gap-1 text-sm text-cg-dark">
          <span className="font-medium">Month</span>
          <select
            id="timesheets-month"
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm"
            value={effectiveMonthKey}
            onChange={(e) => { setSelectedMonthKey(e.target.value); resetForm(); }}
            disabled={monthKeys.length === 0}
          >
            {monthKeys.map((key) => {
              const { year, month } = parseMonthKey(key);
              return (
                <option key={key} value={key}>{month} {year}</option>
              );
            })}
          </select>
        </label>
      </div>

      {filteredWarnings.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-2.5">
          <ul className="list-disc pl-5 text-sm text-amber-900 space-y-1">
            {filteredWarnings.map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
          </ul>
        </div>
      )}

      {dataLoading ? (
        <p className="py-8 text-center text-gray-500">Loading…</p>
      ) : hasError ? (
        <p className="py-8 text-center text-red-700">Failed to load timesheet data.</p>
      ) : (
        <>
          {/* Billables | Ops segmented switch — only one entry surface shows
              at a time (the toggle doubles as the section heading). */}
          <div className="flex items-center gap-2" role="group" aria-label="Entry type">
            {[['billables', 'Billables'], ['ops', 'Ops']].map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setEntryModeOverride(key)}
                aria-pressed={entryMode === key}
                className={cx(
                  'rounded-lg px-4 py-1.5 text-sm font-medium transition-colors',
                  entryMode === key
                    ? 'bg-cg-green text-white shadow-sm'
                    : 'border border-gray-200 bg-white text-gray-600 hover:text-gray-900',
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {/* KPI cards scoped to the active entry surface: billables cards in
              Billables mode, ops cards in Ops mode. Total Hours lives with ops
              (it comes from the ops sheetTotals rollup). */}
          <div className="flex flex-wrap gap-3">
            {entryMode === 'billables' ? (
              <>
                <DriftStatCard
                  label="Total Billable Hours"
                  sheetVal={monthTotals?.billables?.totalBillableHours}
                  computed={sumBillableHours}
                  formatValue={fmtHrsText}
                  formatDelta={fmtDeltaHrs}
                />
                <DriftStatCard
                  label="Billable Earnings"
                  sheetVal={monthTotals?.billables?.billableEarnings}
                  computed={sumEarnings}
                  formatValue={fmt}
                  formatDelta={fmtDeltaMoney}
                />
                <DriftStatCard
                  label="Reimbursements"
                  sheetVal={monthTotals?.billables?.reimbursements}
                  computed={sumReimbursements}
                  formatValue={fmt}
                  formatDelta={fmtDeltaMoney}
                />
                <SheetOnlyStatCard
                  label="Total Payment"
                  value={monthTotals?.billables?.totalPayment}
                />
                <SheetOnlyStatCard
                  label="83(b) Fee Earnings"
                  value={monthTotals?.eightThreeB?.eightThreeBFeeEarnings}
                />
              </>
            ) : (
              <>
                <DriftStatCard
                  label="Ops Hours"
                  sheetVal={monthTotals?.ops?.opsHours}
                  computed={sumOpsHours}
                  formatValue={fmtHrsText}
                  formatDelta={fmtDeltaHrs}
                />
                <DriftStatCard
                  label="Total Hours"
                  sheetVal={monthTotals?.ops?.totalHours}
                  computed={sumTotalHours}
                  formatValue={fmtHrsText}
                  formatDelta={fmtDeltaHrs}
                />
              </>
            )}
          </div>

          {entryMode === 'billables' && (
          <div>
            {/* Manual billables entry bar — writes to users/{id}/billablesManual
                (beta). Earnings are computed (hours × take-home rate), not typed. */}
            <div className="mb-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-end gap-2">
                <label htmlFor="bill-client" className="flex min-w-[180px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Client
                  <select
                    id="bill-client"
                    value={bForm.client}
                    onChange={(e) => setBForm((f) => ({ ...f, client: e.target.value, matter: '' }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="" disabled>Select…</option>
                    {clientOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label htmlFor="bill-matter" className="flex min-w-[170px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Matter
                  <input
                    id="bill-matter"
                    type="text"
                    list="bill-matter-options"
                    value={bForm.matter}
                    onChange={(e) => setBForm((f) => ({ ...f, matter: e.target.value }))}
                    placeholder={bForm.client ? 'Pick or type…' : 'Choose a client first'}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  />
                  <datalist id="bill-matter-options">
                    {matterOptions.map((m) => <option key={m} value={m} />)}
                  </datalist>
                </label>
                <label htmlFor="bill-cat" className="flex min-w-[190px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Category
                  <select
                    id="bill-cat"
                    value={bForm.category}
                    onChange={(e) => setBForm((f) => ({ ...f, category: e.target.value }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="" disabled>Select…</option>
                    {BILLING_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label htmlFor="bill-date" className="flex flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Date
                  <input
                    id="bill-date"
                    type="date"
                    value={bFormDate}
                    min={monthStartIso || undefined}
                    max={monthEndIso || undefined}
                    onChange={(e) => setBForm((f) => ({ ...f, date: e.target.value }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  />
                </label>
                <label htmlFor="bill-hours" className="flex w-[92px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Hours
                  <input
                    id="bill-hours"
                    type="number"
                    step="0.1"
                    min="0"
                    value={bForm.hours}
                    onChange={(e) => setBForm((f) => ({ ...f, hours: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSubmitBill) handleAddBillable(); }}
                    placeholder="0.0"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal tabular-nums"
                  />
                </label>
                <label htmlFor="bill-notes" className="flex flex-1 min-w-[160px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Notes <span className="font-normal text-gray-500">(optional)</span>
                  <input
                    id="bill-notes"
                    type="text"
                    value={bForm.notes}
                    onChange={(e) => setBForm((f) => ({ ...f, notes: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSubmitBill) handleAddBillable(); }}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleAddBillable}
                  disabled={!canSubmitBill}
                  className="rounded-lg bg-cg-green px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cg-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {bSaving ? 'Adding…' : 'Add entry'}
                </button>
              </div>
              {bAddError && <p className="mt-2 text-[12px] text-red-700">{bAddError}</p>}
              {bTakeHome > 0 ? (
                <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-500">
                  Earnings compute automatically: {bHoursNum > 0 ? `${bHoursNum} h × ${fmt(bTakeHome)} = ${fmt(bEarnings)}` : `hours × ${fmt(bTakeHome)} take-home rate`}. Saved to the dashboard, not the timesheet.
                  <CalcTooltip calcKey="billablesManualEntry" position="bottom" />
                </p>
              ) : (
                <p className="mt-2 text-[11px] text-amber-800">
                  No take-home rate configured for {effectiveUserName} this month — entries can&apos;t be added until one is set in User Management.
                </p>
              )}
            </div>

            <SheetWrap maxH="50vh">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Row</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Date</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Client</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Matter</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Hours</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Earnings</th>
                    {showAdjustmentCol && <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Adjustment</th>}
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Reimbursements</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Category</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Notes</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {mergedBillables.length === 0 ? (
                    <tr>
                      <td colSpan={billableColCount} className={cx(cell, 'text-center text-gray-500')}>No entries</td>
                    </tr>
                  ) : (
                    <>
                      {mergedBillables.map((e) => (
                        <tr key={e.__manual ? `m_${e.id}` : (e.id || e.sheetRowNumber)} className={e.__manual ? 'bg-[#f6faf4]' : undefined}>
                          <td className={cell}>
                            {e.__manual
                              ? <span className="rounded bg-cg-green/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cg-green-text">New</span>
                              : (e.sheetRowNumber ?? '')}
                          </td>
                          <td className={cell}><EntryDate entry={e} /></td>
                          <td className={cell}>{e.client}</td>
                          <td className={cell}>{e.matter}</td>
                          <td className={cx(cell, 'text-right')}><Hrs v={e.billableHours} /></td>
                          <td className={cx(cell, 'text-right')}><Money v={e.earnings} /></td>
                          {showAdjustmentCol && (
                            <td className={cx(cell, 'text-right')}><Money v={e.adjustment} /></td>
                          )}
                          <td className={cx(cell, 'text-right')}><Money v={e.reimbursements} /></td>
                          <td className={cell}>{e.billingCategory}</td>
                          <td className={cell}>
                            <span className="block max-w-[220px] truncate" title={e.notes}>{e.notes}</span>
                          </td>
                          <td className={cx(cell, 'text-right')}>
                            {e.__manual && (
                              <button
                                type="button"
                                onClick={() => handleDeleteManual('billablesManual', e.id)}
                                aria-label="Delete manual billable entry"
                                className="rounded px-1.5 py-0.5 text-[12px] font-medium text-red-700 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className={cx(cell, C.lightGreen, 'text-[12px] uppercase tracking-wide')}>Totals</td>
                        <td className={cx(cell, C.lightGreen)} colSpan={3} />
                        <td className={cx(cell, C.lightGreen, 'text-right')}>
                          <span className="inline-flex items-center justify-end gap-1">
                            <Hrs v={sumBillableHoursDisplayed} />
                            <CalcTooltip calcKey="timesheetMirrorComputedTotals" position="bottom" />
                          </span>
                        </td>
                        <td className={cx(cell, C.lightGreen, 'text-right')}>
                          <span className="inline-flex items-center justify-end gap-1">
                            <Money v={sumEarningsDisplayed} />
                            <CalcTooltip calcKey="timesheetMirrorComputedTotals" position="bottom" />
                          </span>
                        </td>
                        {showAdjustmentCol && (
                          <td className={cx(cell, C.lightGreen, 'text-right')}><Money v={sumAdjustment} /></td>
                        )}
                        <td className={cx(cell, C.lightGreen, 'text-right')}><Money v={sumReimbursements} /></td>
                        <td className={cx(cell, C.lightGreen)} colSpan={3} />
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </SheetWrap>
          </div>
          )}

          {entryMode === 'ops' && (
          <div>
            {/* Manual ops entry bar — writes to users/{id}/opsManual (beta).
                Directly above the ops log, which is sorted newest-date first. */}
            <div className="mb-2 rounded-xl border border-gray-200 bg-white p-3 shadow-sm">
              <div className="flex flex-wrap items-end gap-2">
                <label htmlFor="ops-desc" className="flex flex-1 min-w-[200px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Description
                  <input
                    id="ops-desc"
                    type="text"
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleAddOps(); }}
                    placeholder="What did you work on?"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  />
                </label>
                <label htmlFor="ops-cat" className="flex min-w-[170px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Category
                  <select
                    id="ops-cat"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  >
                    <option value="" disabled>Select…</option>
                    {OPS_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
                <label htmlFor="ops-date" className="flex flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Date
                  <input
                    id="ops-date"
                    type="date"
                    value={formDate}
                    min={monthStartIso || undefined}
                    max={monthEndIso || undefined}
                    onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal"
                  />
                </label>
                <label htmlFor="ops-hours" className="flex w-[92px] flex-col gap-1 text-[12px] font-medium text-cg-dark">
                  Hours
                  <input
                    id="ops-hours"
                    type="number"
                    step="0.1"
                    min="0"
                    value={form.hours}
                    onChange={(e) => setForm((f) => ({ ...f, hours: e.target.value }))}
                    onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) handleAddOps(); }}
                    placeholder="0.0"
                    className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm font-normal tabular-nums"
                  />
                </label>
                <button
                  type="button"
                  onClick={handleAddOps}
                  disabled={!canSubmit}
                  className="rounded-lg bg-cg-green px-4 py-2 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-cg-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {saving ? 'Adding…' : 'Add entry'}
                </button>
              </div>
              {addError && <p className="mt-2 text-[12px] text-red-700">{addError}</p>}
              <p className="mt-2 flex items-center gap-1 text-[11px] text-gray-500">
                Entries are saved to the dashboard (not the timesheet).
                <CalcTooltip calcKey="opsManualEntry" position="bottom" />
              </p>
            </div>

            {manualError && (
              <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">{manualError}</p>
            )}

            <SheetWrap maxH="50vh">
              <table className="w-full border-collapse">
                <thead>
                  <tr>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Row</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Date</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Description</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Category</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Hours</th>
                    <th scope="col" className={cx(cell, C.greenHead, 'text-right')}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {mergedOps.length === 0 ? (
                    <tr>
                      <td colSpan={6} className={cx(cell, 'text-center text-gray-500')}>No entries</td>
                    </tr>
                  ) : (
                    <>
                      {mergedOps.map((e) => (
                        <tr key={e.__manual ? `m_${e.id}` : (e.id || e.sheetRowNumber)} className={e.__manual ? 'bg-[#f6faf4]' : undefined}>
                          <td className={cell}>
                            {e.__manual
                              ? <span className="rounded bg-cg-green/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-cg-green-text">New</span>
                              : (e.sheetRowNumber ?? '')}
                          </td>
                          <td className={cell}><EntryDate entry={e} /></td>
                          <td className={cell}>
                            <span className="block max-w-[220px] truncate" title={e.description}>{e.description}</span>
                          </td>
                          <td className={cell}>{e.category}</td>
                          <td className={cx(cell, 'text-right')}><Hrs v={e.opsHours} /></td>
                          <td className={cx(cell, 'text-right')}>
                            {e.__manual && (
                              <button
                                type="button"
                                onClick={() => handleDeleteManual('opsManual', e.id)}
                                aria-label="Delete manual ops entry"
                                className="rounded px-1.5 py-0.5 text-[12px] font-medium text-red-700 hover:bg-red-50"
                              >
                                Delete
                              </button>
                            )}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-bold">
                        <td className={cx(cell, C.lightGreen, 'text-[12px] uppercase tracking-wide')}>Totals</td>
                        <td className={cx(cell, C.lightGreen)} colSpan={3} />
                        <td className={cx(cell, C.lightGreen, 'text-right')}>
                          <span className="inline-flex items-center justify-end gap-1">
                            <Hrs v={sumOpsHoursDisplayed} />
                            <CalcTooltip calcKey="timesheetMirrorComputedTotals" position="bottom" />
                          </span>
                        </td>
                        <td className={cx(cell, C.lightGreen)} />
                      </tr>
                    </>
                  )}
                </tbody>
              </table>
            </SheetWrap>
          </div>
          )}

          {entryMode === 'billables' && showEightThreeBSection && (
            <div>
              <SubHead>83(b) Elections</SubHead>
              <SheetWrap maxH="50vh">
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Row</th>
                      <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Name</th>
                      <th scope="col" className={cx(cell, C.greenHead, 'text-left')}>Company</th>
                      <th scope="col" className={cx(cell, C.greenHead, 'text-right')}>Flat Fee</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEightThreeB.map((e, i) => (
                      <tr key={i}>
                        <td className={cell}>{e.sheetRowNumber ?? ''}</td>
                        <td className={cell}>{e.name}</td>
                        <td className={cell}>{e.company}</td>
                        <td className={cx(cell, 'text-right')}><Money v={e.flatFee} /></td>
                      </tr>
                    ))}
                    <tr className="font-bold">
                      <td className={cx(cell, C.lightGreen, 'text-[12px] uppercase tracking-wide')}>Totals</td>
                      <td className={cx(cell, C.lightGreen)} colSpan={2} />
                      <td className={cx(cell, C.lightGreen, 'text-right')}>
                        <span className="inline-flex items-center justify-end gap-1">
                          <Money v={sumFlatFee} />
                          <CalcTooltip calcKey="timesheetMirrorComputedTotals" position="bottom" />
                        </span>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </SheetWrap>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default TimesheetsTestingView;
