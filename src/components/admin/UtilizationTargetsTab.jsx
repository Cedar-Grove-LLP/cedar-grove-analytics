"use client";

import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { Save, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';
import { formatHours } from '@/utils/formatters';
import { useMonthlyActualsVsTarget } from '@/hooks/useMonthlyActualsVsTarget';
import { CalcTooltip } from '@/components/shared';

const MONTHS = [
  { idx: 0, short: 'Jan', long: 'January' },
  { idx: 1, short: 'Feb', long: 'February' },
  { idx: 2, short: 'Mar', long: 'March' },
  { idx: 3, short: 'Apr', long: 'April' },
  { idx: 4, short: 'May', long: 'May' },
  { idx: 5, short: 'Jun', long: 'June' },
  { idx: 6, short: 'Jul', long: 'July' },
  { idx: 7, short: 'Aug', long: 'August' },
  { idx: 8, short: 'Sep', long: 'September' },
  { idx: 9, short: 'Oct', long: 'October' },
  { idx: 10, short: 'Nov', long: 'November' },
  { idx: 11, short: 'Dec', long: 'December' },
];

const YEARS = [2024, 2025, 2026, 2027];

const QUARTERS = [
  { value: 'all', label: 'All Year', months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  { value: 'Q1', label: 'Q1', months: [0, 1, 2] },
  { value: 'Q2', label: 'Q2', months: [3, 4, 5] },
  { value: 'Q3', label: 'Q3', months: [6, 7, 8] },
  { value: 'Q4', label: 'Q4', months: [9, 10, 11] },
];

const buildEmptyUserMatrix = () => {
  const matrix = {};
  MONTHS.forEach(m => {
    matrix[m.idx] = { client: '', ops: '' };
  });
  return matrix;
};

const monthTotal = (cell) => {
  const c = parseFloat(cell?.client) || 0;
  const o = parseFloat(cell?.ops) || 0;
  return Math.round((c + o) * 100) / 100;
};

const sumTotal = (userMatrix, monthList) =>
  monthList.reduce((sum, m) => sum + monthTotal(userMatrix?.[m.idx]), 0);

const sumBillable = (userMatrix, monthList) =>
  monthList.reduce((sum, m) => sum + (parseFloat(userMatrix?.[m.idx]?.client) || 0), 0);

const sumOps = (userMatrix, monthList) =>
  monthList.reduce((sum, m) => sum + (parseFloat(userMatrix?.[m.idx]?.ops) || 0), 0);

// Variance cell: signed text + color, both derived from the canonical hours
// formatter (formatHours) so the sign, rounding, and color always agree with the
// number shown. Green over target, red under, muted gray when it rounds to 0
// (on target, or a sub-0.1h difference).
const deltaCellValue = (n) => {
  const s = formatHours(n);            // "0", "-2", "1.5", …
  if (s === '0') return { text: '0', className: 'text-gray-400' };
  if (s[0] === '-') return { text: s, className: 'text-red-600' };
  return { text: `+${s}`, className: 'text-green-600' };
};

const EMPTY_CELL = { text: '', className: '' };

const EMPTY_FRACTIONS = Array(12).fill(0);
const EMPTY_FUTURE = Array(12).fill(false);

// One read-only metric row (Actual or Δ): a label cell, then per-month
// client/ops[/total] cells, then the cumulative summary trio. Each cell is a
// { text, className } pair so the caller owns the value and color. Shared by the
// Actual and Δ rows so they aren't two near-identical copy-pasted <tr> blocks.
const MetricRow = ({ label, visibleMonths, showMonthTotals, cell, summary }) => (
  <tr className="bg-gray-50">
    <td className="px-1 py-0.5 text-[10px] text-gray-500 text-right whitespace-nowrap">{label}</td>
    {visibleMonths.map((m) => {
      const [c, o, t] = cell(m.idx);
      return (
        <Fragment key={m.idx}>
          <td className={`px-1 py-0.5 text-right text-xs border-l-2 border-cg-dark whitespace-nowrap ${c.className}`}>{c.text}</td>
          <td className={`px-1 py-0.5 text-right text-xs whitespace-nowrap ${o.className}`}>{o.text}</td>
          {showMonthTotals && (
            <td className={`px-1 py-0.5 text-right text-xs whitespace-nowrap bg-gray-100 ${t.className}`}>{t.text}</td>
          )}
        </Fragment>
      );
    })}
    <td className={`px-1 py-0.5 text-right text-xs border-l-2 border-cg-dark whitespace-nowrap ${summary[0].className}`}>{summary[0].text}</td>
    <td className={`px-1 py-0.5 text-right text-xs whitespace-nowrap ${summary[1].className}`}>{summary[1].text}</td>
    <td className={`px-1 py-0.5 text-right text-xs font-semibold whitespace-nowrap ${summary[2].className}`}>{summary[2].text}</td>
  </tr>
);

const TargetTable = ({ title, users, matrix, actuals, capacity, onChange, visibleMonths, summaryLabel, showMonthTotals }) => {
  const maxRow = users.length - 1;
  const maxCol = visibleMonths.length * 2 - 1;

  const focusCell = (table, r, c) => {
    if (r < 0 || r > maxRow || c < 0 || c > maxCol) return false;
    const target = table.querySelector(`input[data-row="${r}"][data-col="${c}"]`);
    if (!target) return false;
    target.focus();
    target.select();
    return true;
  };

  const handleKeyDown = (e, row, col) => {
    const input = e.currentTarget;
    const table = input.closest('table');
    if (!table) return;

    const key = e.key;
    const shift = e.shiftKey;
    const ctrl = e.ctrlKey || e.metaKey;

    let nextRow = row;
    let nextCol = col;
    let consume = true;

    switch (key) {
      case 'ArrowUp':
        nextRow = row - 1;
        break;
      case 'ArrowDown':
        nextRow = row + 1;
        break;
      case 'ArrowLeft':
        nextCol = col - 1;
        break;
      case 'ArrowRight':
        nextCol = col + 1;
        break;
      case 'Enter':
        nextRow = shift ? row - 1 : row + 1;
        break;
      case 'Tab':
        if (shift) {
          nextCol = col - 1;
          if (nextCol < 0) { nextCol = maxCol; nextRow = row - 1; }
        } else {
          nextCol = col + 1;
          if (nextCol > maxCol) { nextCol = 0; nextRow = row + 1; }
        }
        break;
      case 'Home':
        if (ctrl) { nextRow = 0; nextCol = 0; } else { nextCol = 0; }
        break;
      case 'End':
        if (ctrl) { nextRow = maxRow; nextCol = maxCol; } else { nextCol = maxCol; }
        break;
      case 'PageUp':
        nextRow = 0;
        break;
      case 'PageDown':
        nextRow = maxRow;
        break;
      case 'Escape':
        e.preventDefault();
        input.blur();
        return;
      default:
        consume = false;
    }

    if (!consume) return;

    e.preventDefault();
    focusCell(table, nextRow, nextCol);
  };

  const handlePaste = (e, row, col) => {
    const text = e.clipboardData?.getData('text');
    if (!text) return;
    if (!text.includes('\t') && !text.includes('\n')) return;
    e.preventDefault();
    const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n');
    rows.forEach((rowStr, rOff) => {
      const cells = rowStr.split('\t');
      cells.forEach((val, cOff) => {
        const r = row + rOff;
        const c = col + cOff;
        if (r < 0 || r > maxRow || c < 0 || c > maxCol) return;
        const u = users[r];
        if (!u) return;
        const month = visibleMonths[Math.floor(c / 2)];
        if (!month) return;
        const field = c % 2 === 0 ? 'client' : 'ops';
        onChange(u.id, month.idx, field, val.trim());
      });
    });
  };

  return (
  <div className={`bg-white rounded-lg shadow overflow-x-auto ${showMonthTotals ? 'w-fit max-w-full mx-auto' : ''}`}>
    <table className={`text-xs border-collapse ${showMonthTotals ? 'table-fixed' : 'w-full'}`}>
      {showMonthTotals && (
        <colgroup>
          <col style={{ width: '176px' }} />
          <col style={{ width: '52px' }} />
          {visibleMonths.map(m => (
            <Fragment key={`cg-${m.idx}`}>
              <col style={{ width: '76px' }} />
              <col style={{ width: '76px' }} />
              <col style={{ width: '56px' }} />
            </Fragment>
          ))}
          <col style={{ width: '56px' }} />
          <col style={{ width: '56px' }} />
          <col style={{ width: '64px' }} />
        </colgroup>
      )}
      <thead className="bg-cg-green text-white">
        <tr>
          <th rowSpan={2} className="px-2 py-1 text-left align-middle whitespace-nowrap border-r-2 border-cg-dark text-sm">
            {title}
          </th>
          <th rowSpan={2} className="px-1 py-1"></th>
          {visibleMonths.map(m => (
            <th key={m.idx} colSpan={showMonthTotals ? 3 : 2} className="px-1 py-1 text-center border-l-2 border-cg-dark font-semibold">
              {m.short}
            </th>
          ))}
          <th colSpan={3} className="px-1 py-1 text-center border-l-2 border-cg-dark font-semibold text-sm">
            {summaryLabel}
          </th>
        </tr>
        <tr>
          {visibleMonths.map(m => (
            <Fragment key={m.idx}>
              <th className="px-0.5 py-0.5 text-[10px] font-normal border-l-2 border-cg-dark">Client</th>
              <th className="px-0.5 py-0.5 text-[10px] font-normal">Ops</th>
              {showMonthTotals && (
                <th className="px-0.5 py-0.5 text-[10px] font-normal">Total</th>
              )}
            </Fragment>
          ))}
          <th className="px-0.5 py-0.5 text-[10px] font-normal border-l-2 border-cg-dark">Client</th>
          <th className="px-0.5 py-0.5 text-[10px] font-normal">Ops</th>
          <th className="px-0.5 py-0.5 text-[10px] font-normal">Total</th>
        </tr>
      </thead>
      <tbody>
        {users.map((u, rowIdx) => {
          const userMatrix = matrix[u.id] || buildEmptyUserMatrix();
          const userActuals = actuals[u.id] || {};
          const cap = capacity[u.id] || { fractions: EMPTY_FRACTIONS, future: EMPTY_FUTURE };

          // Cumulative actual + variance across the elapsed (non-future) months.
          let sumActClient = 0;
          let sumActOps = 0;
          let sumDClient = 0;
          let sumDOps = 0;
          let hasElapsed = false;
          visibleMonths.forEach(m => {
            if (cap.future[m.idx]) return;
            hasElapsed = true;
            const act = userActuals[m.idx] || { client: 0, ops: 0 };
            const cell = userMatrix[m.idx] || {};
            const frac = cap.fractions[m.idx];
            sumActClient += act.client;
            sumActOps += act.ops;
            sumDClient += act.client - (parseFloat(cell.client) || 0) * frac;
            sumDOps += act.ops - (parseFloat(cell.ops) || 0) * frac;
          });

          const gray = 'text-gray-600';
          // Actual row cells: logged hours (blank for future months).
          const actualCell = (idx) => {
            if (cap.future[idx]) return [EMPTY_CELL, EMPTY_CELL, EMPTY_CELL];
            const act = userActuals[idx] || { client: 0, ops: 0 };
            return [
              { text: formatHours(act.client), className: gray },
              { text: formatHours(act.ops), className: gray },
              { text: formatHours(act.client + act.ops), className: gray },
            ];
          };
          // Δ row cells: Actual minus the capacity-pro-rated Target (blank for future).
          const deltaCell = (idx) => {
            if (cap.future[idx]) return [EMPTY_CELL, EMPTY_CELL, EMPTY_CELL];
            const act = userActuals[idx] || { client: 0, ops: 0 };
            const cell = userMatrix[idx] || {};
            const frac = cap.fractions[idx];
            const dClient = act.client - (parseFloat(cell.client) || 0) * frac;
            const dOps = act.ops - (parseFloat(cell.ops) || 0) * frac;
            return [deltaCellValue(dClient), deltaCellValue(dOps), deltaCellValue(dClient + dOps)];
          };
          // Cumulative summary trios — blank when no month has elapsed (e.g. a
          // fully-future year) so the summary matches the blank per-month cells.
          const actualSummary = hasElapsed
            ? [
                { text: formatHours(sumActClient), className: gray },
                { text: formatHours(sumActOps), className: gray },
                { text: formatHours(sumActClient + sumActOps), className: 'text-gray-700' },
              ]
            : [EMPTY_CELL, EMPTY_CELL, EMPTY_CELL];
          const deltaSummary = hasElapsed
            ? [deltaCellValue(sumDClient), deltaCellValue(sumDOps), deltaCellValue(sumDClient + sumDOps)]
            : [EMPTY_CELL, EMPTY_CELL, EMPTY_CELL];

          return (
            <Fragment key={u.id}>
              {/* Target — editable */}
              <tr className="bg-white border-t-2 border-gray-300">
                <td rowSpan={3} className="px-2 py-0.5 font-medium text-gray-900 whitespace-nowrap border-r-2 border-cg-dark text-sm align-middle">
                  {u.name || u.id}
                </td>
                <td className="px-1 py-0.5 text-[10px] text-gray-500 text-right whitespace-nowrap">
                  <span className="inline-flex items-center gap-1">
                    Target
                    <CalcTooltip calcKey="targetHours" position="bottom" />
                  </span>
                </td>
                {visibleMonths.map((m, colIdx) => {
                  const cell = userMatrix[m.idx] || { client: '', ops: '' };
                  const clientCol = colIdx * 2;
                  const opsCol = colIdx * 2 + 1;
                  return (
                    <Fragment key={m.idx}>
                      <td className="px-0.5 py-0.5 border-l-2 border-cg-dark">
                        <input
                          type="number"
                          value={cell.client ?? ''}
                          onChange={(e) => onChange(u.id, m.idx, 'client', e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIdx, clientCol)}
                          onPaste={(e) => handlePaste(e, rowIdx, clientCol)}
                          data-row={rowIdx}
                          data-col={clientCol}
                          className={`no-spinner ${showMonthTotals ? 'w-16' : 'w-full'} px-1 py-0.5 text-xs text-right border border-gray-200 rounded focus:ring-1 focus:ring-cg-green focus:border-cg-green`}
                          min="0"
                          step="1"
                        />
                      </td>
                      <td className="px-0.5 py-0.5">
                        <input
                          type="number"
                          value={cell.ops ?? ''}
                          onChange={(e) => onChange(u.id, m.idx, 'ops', e.target.value)}
                          onKeyDown={(e) => handleKeyDown(e, rowIdx, opsCol)}
                          onPaste={(e) => handlePaste(e, rowIdx, opsCol)}
                          data-row={rowIdx}
                          data-col={opsCol}
                          className={`no-spinner ${showMonthTotals ? 'w-16' : 'w-full'} px-1 py-0.5 text-xs text-right border border-gray-200 rounded focus:ring-1 focus:ring-cg-green focus:border-cg-green`}
                          min="0"
                          step="1"
                        />
                      </td>
                      {showMonthTotals && (
                        <td className="px-1 py-0.5 text-right text-xs font-medium text-gray-700 whitespace-nowrap bg-gray-50">
                          {monthTotal(cell) || ''}
                        </td>
                      )}
                    </Fragment>
                  );
                })}
                <td className="px-1 py-0.5 text-right text-xs text-gray-700 border-l-2 border-cg-dark whitespace-nowrap">
                  {sumBillable(userMatrix, visibleMonths) || ''}
                </td>
                <td className="px-1 py-0.5 text-right text-xs text-gray-700 whitespace-nowrap">
                  {sumOps(userMatrix, visibleMonths) || ''}
                </td>
                <td className="px-1 py-0.5 text-right font-semibold text-gray-900 text-xs whitespace-nowrap">
                  {sumTotal(userMatrix, visibleMonths) || ''}
                </td>
              </tr>

              <MetricRow label="Actual" visibleMonths={visibleMonths} showMonthTotals={showMonthTotals} cell={actualCell} summary={actualSummary} />
              <MetricRow
                label={(
                  <span className="inline-flex items-center gap-1">
                    Δ
                    <CalcTooltip calcKey="targetVariance" position="bottom" />
                  </span>
                )}
                visibleMonths={visibleMonths}
                showMonthTotals={showMonthTotals}
                cell={deltaCell}
                summary={deltaSummary}
              />
            </Fragment>
          );
        })}
        {users.length === 0 && (
          <tr>
            <td colSpan={visibleMonths.length * (showMonthTotals ? 3 : 2) + 5} className="px-3 py-4 text-center text-gray-500">
              No members in this group.
            </td>
          </tr>
        )}
      </tbody>
    </table>
  </div>
  );
};

const UtilizationTargetsTab = ({ users, usersLoading, refetch }) => {
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [selectedQuarter, setSelectedQuarter] = useState('all');
  const [matrix, setMatrix] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null);

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        setSaveStatus(null);
        await waitForAuth();

        const next = {};
        for (const u of users) {
          const userMatrix = buildEmptyUserMatrix();
          try {
            const userDoc = await getDoc(doc(db, 'users', u.id));
            if (userDoc.exists()) {
              const data = userDoc.data();
              const targetsArray = data.targets || [];
              targetsArray.forEach(t => {
                if (t.year !== selectedYear) return;
                const m = MONTHS.find(mm => mm.long === t.month);
                if (!m) return;
                userMatrix[m.idx] = {
                  client: t.billableHours ?? '',
                  ops: t.opsHours ?? '',
                };
              });
            }
          } catch {
            // Missing stored targets are a valid state for a user.
          }
          next[u.id] = userMatrix;
        }
        setMatrix(next);
      } catch (err) {
        console.error('Error loading targets:', err);
      } finally {
        setLoading(false);
      }
    };

    if (!usersLoading && users.length > 0) {
      load();
    } else if (!usersLoading) {
      setLoading(false);
      setMatrix({});
    }
  }, [selectedYear, users, usersLoading]);

  const handleChange = (userId, monthIdx, field, value) => {
    setMatrix(prev => ({
      ...prev,
      [userId]: {
        ...(prev[userId] || buildEmptyUserMatrix()),
        [monthIdx]: {
          ...(prev[userId]?.[monthIdx] || { client: '', ops: '' }),
          [field]: value === '' ? '' : value,
        },
      },
    }));
  };

  const handleSave = async () => {
    try {
      setSaving(true);
      setSaveStatus(null);
      await waitForAuth();

      for (const u of users) {
        const userMatrix = matrix[u.id];
        if (!userMatrix) continue;

        const userRef = doc(db, 'users', u.id);
        const userDoc = await getDoc(userRef);
        const data = userDoc.exists() ? userDoc.data() : {};
        const existing = data.targets || [];
        const otherYears = existing.filter(t => t.year !== selectedYear);

        const yearEntries = MONTHS.map(m => {
          const cell = userMatrix[m.idx] || {};
          const billable = parseFloat(cell.client) || 0;
          const ops = parseFloat(cell.ops) || 0;
          return {
            month: m.long,
            year: selectedYear,
            billableHours: billable,
            opsHours: ops,
            totalHours: billable + ops,
            earnings: 0,
          };
        });

        await updateDoc(userRef, { targets: [...otherYears, ...yearEntries] });
      }

      if (refetch) {
        await refetch();
      }

      setSaveStatus('success');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      console.error('Error saving targets:', err);
      setSaveStatus('error');
    } finally {
      setSaving(false);
    }
  };

  const visibleMonths = useMemo(() => {
    const q = QUARTERS.find(qq => qq.value === selectedQuarter) || QUARTERS[0];
    return MONTHS.filter(m => q.months.includes(m.idx));
  }, [selectedQuarter]);

  const summaryLabel = selectedQuarter === 'all' ? 'Annual' : selectedQuarter;

  const groups = useMemo(() => {
    const pte = [];
    const fte = [];
    const other = [];
    users.forEach(u => {
      const role = u.role || 'Attorney';
      const emp = u.employmentType || 'FTE';
      if (role !== 'Attorney') other.push(u);
      else if (emp === 'PTE') pte.push(u);
      else fte.push(u);
    });
    const byName = (a, b) => (a.name || a.id).localeCompare(b.name || b.id);
    pte.sort(byName);
    fte.sort(byName);
    other.sort(byName);
    return { pte, fte, other };
  }, [users]);

  // Per-attorney, per-month actuals + capacity-pro-rated fractions for the
  // selected year. Shared hook so this isn't hand-rolled inline (see #1/#6).
  const { actuals, capacity } = useMonthlyActualsVsTarget(selectedYear, users);

  if (loading || usersLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-cg-green"></div>
          <div className="mt-4 text-xl text-gray-700">Loading targets...</div>
        </div>
      </div>
    );
  }

  if (users.length === 0) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="text-center max-w-md">
          <div className="text-gray-900 text-xl mb-4">No team members found</div>
          <div className="text-gray-600">No users found in the database.</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {saveStatus && (
        <div
          className={`flex items-center gap-2 px-4 py-3 rounded-lg ${
            saveStatus === 'success'
              ? 'bg-green-50 border border-green-200 text-green-700'
              : 'bg-red-50 border border-red-200 text-red-700'
          }`}
        >
          {saveStatus === 'success' ? (
            <>
              <CheckCircle className="w-5 h-5" />
              <span>Targets saved successfully!</span>
            </>
          ) : (
            <>
              <AlertCircle className="w-5 h-5" />
              <span>Error saving targets. Please try again.</span>
            </>
          )}
        </div>
      )}

      <div className="bg-white rounded-lg shadow p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-gray-600" />
            <span className="font-medium text-gray-700">Year:</span>
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(parseInt(e.target.value))}
              className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cg-green focus:border-transparent bg-white"
            >
              {YEARS.map(y => (
                <option key={y} value={y}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-medium text-gray-700">View:</span>
            <div className="inline-flex rounded-lg border border-gray-300 overflow-hidden">
              {QUARTERS.map(q => (
                <button
                  key={q.value}
                  type="button"
                  onClick={() => setSelectedQuarter(q.value)}
                  className={`px-3 py-2 text-sm font-medium transition-colors border-l border-gray-300 first:border-l-0 ${
                    selectedQuarter === q.value
                      ? 'bg-cg-green text-white'
                      : 'bg-white text-gray-700 hover:bg-gray-50'
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <TargetTable title="Attorneys Full-time" users={groups.fte} matrix={matrix} actuals={actuals} capacity={capacity} onChange={handleChange} visibleMonths={visibleMonths} summaryLabel={summaryLabel} showMonthTotals={selectedQuarter !== 'all'} />
      <TargetTable title="Attorneys Part-time" users={groups.pte} matrix={matrix} actuals={actuals} capacity={capacity} onChange={handleChange} visibleMonths={visibleMonths} summaryLabel={summaryLabel} showMonthTotals={selectedQuarter !== 'all'} />
      <TargetTable title="Other" users={groups.other} matrix={matrix} actuals={actuals} capacity={capacity} onChange={handleChange} visibleMonths={visibleMonths} summaryLabel={summaryLabel} showMonthTotals={selectedQuarter !== 'all'} />

      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className={`flex items-center gap-2 px-8 py-2.5 rounded-lg font-medium transition-colors ${
            saving
              ? 'bg-gray-400 cursor-not-allowed text-white'
              : 'bg-cg-green hover:opacity-90 text-white'
          }`}
        >
          {saving ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              <span>Saving...</span>
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              <span>Save</span>
            </>
          )}
        </button>
      </div>
    </div>
  );
};

export default UtilizationTargetsTab;
