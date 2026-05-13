"use client";

import React, { useState, useEffect, useMemo, Fragment } from 'react';
import { Save, Calendar, CheckCircle, AlertCircle } from 'lucide-react';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { db, waitForAuth } from '@/firebase/config';

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

const annualTotal = (userMatrix) =>
  MONTHS.reduce((sum, m) => sum + monthTotal(userMatrix?.[m.idx]), 0);

const annualBillable = (userMatrix) =>
  MONTHS.reduce((sum, m) => sum + (parseFloat(userMatrix?.[m.idx]?.client) || 0), 0);

const annualOps = (userMatrix) =>
  MONTHS.reduce((sum, m) => sum + (parseFloat(userMatrix?.[m.idx]?.ops) || 0), 0);

const TargetTable = ({ title, users, matrix, onChange }) => {
  const maxRow = users.length - 1;
  const maxCol = MONTHS.length * 2 - 1;

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
        const monthIdx = Math.floor(c / 2);
        const field = c % 2 === 0 ? 'client' : 'ops';
        onChange(u.id, monthIdx, field, val.trim());
      });
    });
  };

  return (
  <div className="bg-white rounded-lg shadow overflow-x-auto">
    <table className="w-full text-xs border-collapse">
      <thead className="bg-cg-green text-white">
        <tr>
          <th rowSpan={2} className="px-2 py-1 text-left align-middle whitespace-nowrap border-r-2 border-cg-dark text-sm">
            {title}
          </th>
          {MONTHS.map(m => (
            <th key={m.idx} colSpan={2} className="px-1 py-1 text-center border-l-2 border-cg-dark font-semibold">
              {m.short}
            </th>
          ))}
          <th colSpan={3} className="px-1 py-1 text-center border-l-2 border-cg-dark font-semibold text-sm">
            Annual
          </th>
        </tr>
        <tr>
          {MONTHS.map(m => (
            <Fragment key={m.idx}>
              <th className="px-0.5 py-0.5 text-[10px] font-normal border-l-2 border-cg-dark">Client</th>
              <th className="px-0.5 py-0.5 text-[10px] font-normal">Ops</th>
            </Fragment>
          ))}
          <th className="px-0.5 py-0.5 text-[10px] font-normal border-l-2 border-cg-dark">Client</th>
          <th className="px-0.5 py-0.5 text-[10px] font-normal">Ops</th>
          <th className="px-0.5 py-0.5 text-[10px] font-normal">Total</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-200">
        {users.map((u, rowIdx) => {
          const userMatrix = matrix[u.id] || buildEmptyUserMatrix();
          return (
            <tr key={u.id} className="hover:bg-gray-50">
              <td className="px-2 py-0.5 font-medium text-gray-900 whitespace-nowrap border-r-2 border-cg-dark text-sm">
                {u.name || u.id}
              </td>
              {MONTHS.map(m => {
                const cell = userMatrix[m.idx] || { client: '', ops: '' };
                const clientCol = m.idx * 2;
                const opsCol = m.idx * 2 + 1;
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
                        className="no-spinner w-full px-1 py-0.5 text-xs text-right border border-gray-200 rounded focus:ring-1 focus:ring-cg-green focus:border-cg-green"
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
                        className="no-spinner w-full px-1 py-0.5 text-xs text-right border border-gray-200 rounded focus:ring-1 focus:ring-cg-green focus:border-cg-green"
                        min="0"
                        step="1"
                      />
                    </td>
                  </Fragment>
                );
              })}
              <td className="px-1 py-0.5 text-right text-xs text-gray-700 border-l-2 border-cg-dark whitespace-nowrap">
                {annualBillable(userMatrix) || ''}
              </td>
              <td className="px-1 py-0.5 text-right text-xs text-gray-700 whitespace-nowrap">
                {annualOps(userMatrix) || ''}
              </td>
              <td className="px-1 py-0.5 text-right font-semibold text-gray-900 text-xs whitespace-nowrap">
                {annualTotal(userMatrix) || ''}
              </td>
            </tr>
          );
        })}
        {users.length === 0 && (
          <tr>
            <td colSpan={MONTHS.length * 2 + 4} className="px-3 py-4 text-center text-gray-500">
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
          } catch (err) {
            console.log(`No targets for ${u.id}:`, err.message);
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
      </div>

      <TargetTable title="Attorneys Full-time" users={groups.fte} matrix={matrix} onChange={handleChange} />
      <TargetTable title="Attorneys Part-time" users={groups.pte} matrix={matrix} onChange={handleChange} />
      <TargetTable title="Other" users={groups.other} matrix={matrix} onChange={handleChange} />

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
