"use client";

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  LogOut,
  CalendarClock,
  AlertTriangle,
  Users as UsersIcon,
  CalendarOff,
  ChevronLeft,
  ChevronRight,
  Clock,
  MapPin,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useUsers, useTimeOff } from '@/hooks/useFirestoreData';
import { KPICard, AttorneyFilterDropdown } from '@/components/shared';
import { CHART_COLORS } from '@/utils/constants';
import { parseOooDayFraction, isOffsiteTitle } from '@/utils/timeOff';

// ── Matching helpers (mirror utils/timeOff.js normalization so this debug view
//    classifies each raw outOfOffice entry the exact same way the pro-rating does).
const normalizeName = (s) => (s || '').trim().toLowerCase().replace(/\s+/g, ' ');
const normalizeEmail = (s) => (s || '').trim().toLowerCase();

// Parse 'YYYY-MM-DD' as a LOCAL day (avoids the UTC shift new Date('YYYY-MM-DD') has).
const parseDateKey = (s) => {
  const [y, m, d] = String(s || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
};

const toKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Expand an inclusive [start, end] range to 'YYYY-MM-DD' keys.
const expandRangeKeys = (start, end) => {
  const keys = [];
  const s = parseDateKey(start);
  if (!s) return keys;
  const e = end ? parseDateKey(end) : s;
  if (!e) return keys;
  const cur = new Date(s);
  cur.setHours(0, 0, 0, 0);
  const last = new Date(e);
  last.setHours(0, 0, 0, 0);
  let guard = 0;
  while (cur <= last && guard < 1000) {
    keys.push(toKey(cur));
    cur.setDate(cur.getDate() + 1);
    guard++;
  }
  return keys;
};

// Count weekday (Mon–Fri) days in an inclusive [start, end] range.
const countBusinessDays = (start, end) =>
  expandRangeKeys(start, end).filter((k) => {
    const d = parseDateKey(k);
    const day = d.getDay();
    return day !== 0 && day !== 6;
  }).length;

const fmtRange = (start, end) => {
  if (!start) return '—';
  if (!end || end === start) return start;
  return `${start} → ${end}`;
};

const MONTH_LABELS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const TABS = [
  { key: 'calendar', label: 'Calendar', icon: CalendarClock },
  { key: 'unmatched', label: 'Unclassified', icon: AlertTriangle },
  { key: 'offsite', label: 'Offsite', icon: MapPin },
  { key: 'holidays', label: 'Holidays', icon: CalendarOff },
];

const AdminTimeOffDebug = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const { users: allUsers, loading: usersLoading } = useUsers();
  const { data: timeOffDoc, loading: timeOffLoading } = useTimeOff();

  const [activeTab, setActiveTab] = useState('calendar');

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  // Build attorney lookup maps (email first, then name) — same join keys as getOooMapFor.
  const { byEmail, byName } = useMemo(() => {
    const be = new Map();
    const bn = new Map();
    (allUsers || []).forEach((u) => {
      const e = normalizeEmail(u.email);
      const n = normalizeName(u.name || u.id);
      if (e) be.set(e, u);
      if (n) bn.set(n, u);
    });
    return { byEmail: be, byName: bn };
  }, [allUsers]);

  // Classify every raw outOfOffice entry: which attorney it joins to, and how.
  const classified = useMemo(() => {
    const ooo = (timeOffDoc && Array.isArray(timeOffDoc.outOfOffice))
      ? timeOffDoc.outOfOffice
      : [];
    return ooo.map((o, idx) => {
      const e = normalizeEmail(o.email);
      const n = normalizeName(o.name);
      let attorney = null;
      let matchBy = null;
      if (e && byEmail.has(e)) {
        attorney = byEmail.get(e);
        matchBy = 'email';
      } else if (n && byName.has(n)) {
        attorney = byName.get(n);
        matchBy = 'name';
      }
      const businessDays = countBusinessDays(o.start, o.end);
      const { offFraction: fraction, partial, label: partialLabel } = parseOooDayFraction(o.title);
      // Offsite events (title matches "offsite") are excluded from pro-rating —
      // attendees are working, just co-located — same rule as parseTimeOff.
      const offsite = isOffsiteTitle(o.title);
      return {
        idx,
        raw: o,
        name: o.name || '',
        email: o.email || '',
        title: o.title || '',
        start: o.start || '',
        end: o.end || '',
        businessDays,
        fraction,
        partial,
        partialLabel,
        offsite,
        effectiveBusinessDays: businessDays * fraction,
        attorney,
        attorneyName: attorney ? (attorney.name || attorney.id) : null,
        matchBy,
      };
    });
  }, [timeOffDoc, byEmail, byName]);

  // Offsite entries are excluded from pro-rating; an unmatched entry only counts
  // as "unclassified" if it is genuine OOO (not offsite).
  const unmatched = useMemo(() => classified.filter((c) => !c.attorney && !c.offsite), [classified]);
  const offsites = useMemo(() => classified.filter((c) => c.offsite), [classified]);

  const holidays = useMemo(() => {
    const h = (timeOffDoc && Array.isArray(timeOffDoc.holidays)) ? timeOffDoc.holidays : [];
    return [...h]
      .filter((x) => x && x.date)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  }, [timeOffDoc]);

  // ── Calendar selection state ────────────────────────────────────────────
  // Selectable attorney names: active attorneys only (inactive hidden), sorted.
  const allAttorneyNames = useMemo(
    () =>
      (allUsers || [])
        .filter((u) => u.active !== false)
        .map((u) => u.name || u.id)
        .sort((a, b) => a.localeCompare(b)),
    [allUsers],
  );

  // Stable color per attorney name (by index in the full roster).
  const colorByName = useMemo(() => {
    const map = new Map();
    allAttorneyNames.forEach((name, i) => {
      map.set(name, CHART_COLORS[i % CHART_COLORS.length]);
    });
    return map;
  }, [allAttorneyNames]);

  const [selectedNames, setSelectedNames] = useState(null); // null → init to all once loaded
  const [showAttorneyDropdown, setShowAttorneyDropdown] = useState(false);
  const [viewDate, setViewDate] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() }; // month 0-indexed
  });

  // Default selection to all attorneys once the roster loads.
  const effectiveSelected = selectedNames ?? allAttorneyNames;
  const selectedSet = useMemo(() => new Set(effectiveSelected), [effectiveSelected]);

  // dateKey → { ooo: [{ attorneyName, color, title, matchBy }], holiday: string|null }
  const dayMap = useMemo(() => {
    const map = new Map();
    const ensure = (k) => {
      let v = map.get(k);
      if (!v) {
        v = { ooo: [], holiday: null };
        map.set(k, v);
      }
      return v;
    };
    holidays.forEach((h) => {
      const d = parseDateKey(h.date);
      if (!d) return;
      ensure(toKey(d)).holiday = h.name || 'Holiday';
    });
    classified.forEach((c) => {
      if (c.offsite) return; // excluded from pro-rating → not shown as OOO
      if (!c.attorney) return;
      if (!selectedSet.has(c.attorneyName)) return;
      expandRangeKeys(c.start, c.end).forEach((k) => {
        ensure(k).ooo.push({
          attorneyName: c.attorneyName,
          color: colorByName.get(c.attorneyName) || '#999',
          title: c.title,
          matchBy: c.matchBy,
          fraction: c.fraction,
          partial: c.partial,
          partialLabel: c.partialLabel,
        });
      });
    });
    return map;
  }, [holidays, classified, selectedSet, colorByName]);

  const stats = useMemo(() => {
    // Matched = joins to a user AND counts toward pro-rating (offsite excluded).
    const matchedCount = classified.filter((c) => c.attorney && !c.offsite).length;
    const attorneysWithOoo = new Set(
      classified.filter((c) => c.attorney && !c.offsite).map((c) => c.attorneyName),
    ).size;
    const partialCount = classified.filter((c) => c.partial && !c.offsite).length;
    return {
      totalOoo: classified.length,
      matchedCount,
      unmatchedCount: unmatched.length,
      offsiteCount: offsites.length,
      attorneysWithOoo,
      partialCount,
      holidayCount: holidays.length,
    };
  }, [classified, unmatched, offsites, holidays]);

  const loading = usersLoading || timeOffLoading;

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gray-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <div className="mt-4 text-xl text-gray-700">Loading time-off data...</div>
        </div>
      </div>
    );
  }

  const noDoc = !timeOffDoc;
  const lastSyncedAt = timeOffDoc?.lastSyncedAt || null;
  const source = timeOffDoc?.source || null;

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link href="/admin" className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors">
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Admin</span>
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-rose-100 rounded-lg">
                  <CalendarClock className="w-5 h-5 text-rose-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Time-Off Debug</h1>
                  <p className="text-sm text-gray-600">
                    Inspect calendar OOO entries, attorney matching, and holidays
                  </p>
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-3">
                  {user.photoURL && (
                    <img src={user.photoURL} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full" />
                  )}
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{user.displayName}</div>
                    <div className="text-gray-500">{user.email}</div>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6 sm:px-6 lg:px-8">
        {noDoc ? (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-6 flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
            <div>
              <div className="font-semibold text-amber-900">No timeOff/all document found</div>
              <div className="text-sm text-amber-800 mt-1">
                The calendar sync hasn&apos;t shipped yet (or the doc is missing). The app is
                falling back to US federal holidays with no out-of-office. Once the Apps Script
                writes <code className="px-1 bg-amber-100 rounded">timeOff/all</code>, entries
                will appear here.
              </div>
            </div>
          </div>
        ) : (
          <>
            {/* Sync metadata */}
            <div className="mb-6 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-gray-600">
              <span>
                <span className="font-medium text-gray-900">Source:</span> {source || 'unknown'}
              </span>
              <span>
                <span className="font-medium text-gray-900">Last synced:</span>{' '}
                {lastSyncedAt ? new Date(lastSyncedAt).toLocaleString() : 'unknown'}
              </span>
            </div>

            {/* Summary KPIs */}
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4 mb-6">
              <KPICard title="OOO Entries" value={stats.totalOoo} icon={CalendarClock} />
              <KPICard title="Matched" value={stats.matchedCount} icon={UsersIcon} iconColor="text-green-600" />
              <KPICard
                title="Unclassified"
                value={stats.unmatchedCount}
                icon={AlertTriangle}
                iconColor={stats.unmatchedCount > 0 ? 'text-red-600' : 'text-gray-400'}
              />
              <KPICard
                title="Partial-day"
                value={stats.partialCount}
                icon={Clock}
                iconColor={stats.partialCount > 0 ? 'text-purple-600' : 'text-gray-400'}
              />
              <KPICard
                title="Offsite (excl.)"
                value={stats.offsiteCount}
                icon={MapPin}
                iconColor={stats.offsiteCount > 0 ? 'text-amber-600' : 'text-gray-400'}
              />
              <KPICard title="Attorneys w/ OOO" value={stats.attorneysWithOoo} icon={UsersIcon} />
              <KPICard title="Holidays" value={stats.holidayCount} icon={CalendarOff} iconColor="text-blue-600" />
            </div>

            {/* Tab nav */}
            <div className="flex gap-1 border-b border-gray-200 mb-6">
              {TABS.map((tab) => {
                const badge =
                  tab.key === 'unmatched' && stats.unmatchedCount > 0 ? stats.unmatchedCount : null;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-colors border-b-2 ${
                      activeTab === tab.key
                        ? 'text-blue-600 border-blue-600'
                        : 'text-gray-500 border-transparent hover:text-gray-700 hover:border-gray-300'
                    }`}
                  >
                    <tab.icon className="w-4 h-4" />
                    {tab.label}
                    {badge != null && (
                      <span className="ml-1 px-1.5 py-0.5 text-xs font-semibold rounded-full bg-red-100 text-red-700">
                        {badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {activeTab === 'calendar' && (
              <CalendarTab
                viewDate={viewDate}
                setViewDate={setViewDate}
                dayMap={dayMap}
                allAttorneyNames={allAttorneyNames}
                effectiveSelected={effectiveSelected}
                setSelectedNames={setSelectedNames}
                showAttorneyDropdown={showAttorneyDropdown}
                setShowAttorneyDropdown={setShowAttorneyDropdown}
                colorByName={colorByName}
              />
            )}
            {activeTab === 'unmatched' && <UnmatchedTab entries={unmatched} />}
            {activeTab === 'offsite' && <OffsiteTab entries={offsites} />}
            {activeTab === 'holidays' && <HolidaysTab holidays={holidays} />}
          </>
        )}
      </div>
    </div>
  );
};

// ── Calendar ────────────────────────────────────────────────────────────────
const CalendarTab = ({
  viewDate,
  setViewDate,
  dayMap,
  allAttorneyNames,
  effectiveSelected,
  setSelectedNames,
  showAttorneyDropdown,
  setShowAttorneyDropdown,
  colorByName,
}) => {
  const { year, month } = viewDate;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const todayKey = toKey(new Date());

  // Build a flat list of cells (leading blanks + weekdays only), padded to
  // full Mon–Fri weeks. Weekends are non-working days and are not shown.
  const weekdayDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dow = new Date(year, month, d).getDay();
    if (dow === 0 || dow === 6) continue; // skip Sat/Sun
    weekdayDays.push(d);
  }
  const cells = [];
  if (weekdayDays.length) {
    const firstDow = new Date(year, month, weekdayDays[0]).getDay(); // 1=Mon..5=Fri
    for (let i = 0; i < firstDow - 1; i++) cells.push(null);
  }
  cells.push(...weekdayDays);
  while (cells.length % 5 !== 0) cells.push(null);

  const goPrev = () => {
    const m = month - 1;
    setViewDate(m < 0 ? { year: year - 1, month: 11 } : { year, month: m });
  };
  const goNext = () => {
    const m = month + 1;
    setViewDate(m > 11 ? { year: year + 1, month: 0 } : { year, month: m });
  };
  const goToday = () => {
    const now = new Date();
    setViewDate({ year: now.getFullYear(), month: now.getMonth() });
  };

  // Legend: only selected attorneys that actually appear this month.
  const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const presentNames = new Set();
  dayMap.forEach((v, k) => {
    if (k.startsWith(monthPrefix)) v.ooo.forEach((o) => presentNames.add(o.attorneyName));
  });

  return (
    <div>
      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={goPrev}
            className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="w-4 h-4 text-gray-600" />
          </button>
          <div className="text-lg font-semibold text-gray-900 w-44 text-center">
            {MONTH_LABELS[month]} {year}
          </div>
          <button
            onClick={goNext}
            className="p-2 rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="w-4 h-4 text-gray-600" />
          </button>
          <button
            onClick={goToday}
            className="ml-2 px-3 py-2 text-sm rounded-lg border border-gray-300 bg-white hover:bg-gray-50 transition-colors text-gray-700"
          >
            Today
          </button>
        </div>
        <AttorneyFilterDropdown
          allAttorneyNames={allAttorneyNames}
          globalAttorneyFilter={effectiveSelected}
          setGlobalAttorneyFilter={setSelectedNames}
          showDropdown={showAttorneyDropdown}
          setShowDropdown={setShowAttorneyDropdown}
        />
      </div>

      {/* Legend */}
      {presentNames.size > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3">
          {[...presentNames]
            .sort((a, b) => a.localeCompare(b))
            .map((name) => (
              <div key={name} className="flex items-center gap-1.5 text-xs text-gray-600">
                <span
                  className="w-3 h-3 rounded-sm inline-block"
                  style={{ backgroundColor: colorByName.get(name) || '#999' }}
                />
                {name}
              </div>
            ))}
        </div>
      )}

      {/* Calendar grid */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="grid grid-cols-5 border-b border-gray-200">
          {WEEKDAYS.slice(1, 6).map((w) => (
            <div key={w} className="px-2 py-2 text-xs font-medium text-gray-500 text-center">
              {w}
            </div>
          ))}
        </div>
        <div className="grid grid-cols-5">
          {cells.map((day, i) => {
            if (day === null) {
              return <div key={`b-${i}`} className="min-h-[96px] border-b border-r border-gray-100 bg-gray-50/40" />;
            }
            const key = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
            const cell = dayMap.get(key);
            const isToday = key === todayKey;
            return (
              <div
                key={key}
                className="min-h-[96px] border-b border-r border-gray-100 p-1.5 bg-white"
              >
                <div className="flex items-center justify-between mb-1">
                  <span
                    className={`text-xs font-medium ${
                      isToday
                        ? 'bg-blue-600 text-white rounded-full w-5 h-5 flex items-center justify-center'
                        : 'text-gray-500'
                    }`}
                  >
                    {day}
                  </span>
                </div>
                {cell?.holiday && (
                  <div
                    className="mb-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 truncate"
                    title={cell.holiday}
                  >
                    {cell.holiday}
                  </div>
                )}
                <div className="space-y-0.5">
                  {(cell?.ooo || []).map((o, j) => (
                    <div
                      key={`${o.attorneyName}-${j}`}
                      className={`flex items-center gap-1 px-1 py-0.5 rounded text-[10px] text-gray-700 ${
                        o.partial ? 'border border-dashed' : ''
                      }`}
                      style={{
                        backgroundColor: `${o.color}22`,
                        borderColor: o.partial ? o.color : undefined,
                      }}
                      title={`${o.attorneyName}${o.title ? ` — ${o.title}` : ''}${
                        o.partial ? ` (${o.partialLabel}, ½ day)` : ''
                      }${o.matchBy === 'name' ? ' (matched by name only)' : ''}`}
                    >
                      <span
                        className="w-2 h-2 rounded-full flex-shrink-0"
                        style={{ backgroundColor: o.color }}
                      />
                      <span className="truncate flex-1">{o.attorneyName}</span>
                      {o.partial && (
                        <span className="flex-shrink-0 font-semibold text-purple-600">½</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

// ── Unclassified ────────────────────────────────────────────────────────────
const UnmatchedTab = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-6 text-sm text-green-800">
        🎉 Every out-of-office entry matched an attorney by email or name. Nothing unclassified.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        These calendar OOO entries did not join to any user by email or by normalized name. They are{' '}
        <span className="font-medium">excluded</span> from target pro-rating. Fix by canonicalizing
        the name/email in the calendar sync so it matches a <code className="px-1 bg-gray-100 rounded">users/</code> doc.
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2 font-medium">Dates</th>
              <th className="px-5 py-2 font-medium">Biz days</th>
              <th className="px-5 py-2 font-medium">Title</th>
              <th className="px-5 py-2 font-medium">Calendar name</th>
              <th className="px-5 py-2 font-medium">Calendar email</th>
              <th className="px-5 py-2 font-medium">Likely reason</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.idx} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-2 whitespace-nowrap font-mono text-xs text-gray-700">
                  {fmtRange(e.start, e.end)}
                </td>
                <td className="px-5 py-2 text-gray-700">{e.businessDays}</td>
                <td className="px-5 py-2 text-gray-700">{e.title || '—'}</td>
                <td className="px-5 py-2 text-gray-700">{e.name || '—'}</td>
                <td className="px-5 py-2 text-gray-700">{e.email || '—'}</td>
                <td className="px-5 py-2 text-xs text-red-600">
                  {!e.name && !e.email
                    ? 'no name or email on entry'
                    : e.email
                    ? 'email not in users collection'
                    : 'name does not match any user'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Offsite (excluded from pro-rating) ───────────────────────────────────────
const OffsiteTab = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div className="text-sm text-gray-600">
        No offsite events detected. Calendar entries whose title contains “offsite” are excluded
        from target pro-rating — attendees are working, just co-located.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="text-sm text-gray-600">
        These entries are treated as <span className="font-medium">offsite</span> (title matches
        “offsite”) and are <span className="font-medium">excluded</span> from target pro-rating — the
        same rule the dashboard applies. They are not shown as OOO on the calendar; listed here so
        the exclusion is auditable.
      </div>
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
              <th className="px-5 py-2 font-medium">Dates</th>
              <th className="px-5 py-2 font-medium">Biz days</th>
              <th className="px-5 py-2 font-medium">Attorney</th>
              <th className="px-5 py-2 font-medium">Match</th>
              <th className="px-5 py-2 font-medium">Raw title</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.idx} className="border-b border-gray-50 last:border-0">
                <td className="px-5 py-2 whitespace-nowrap font-mono text-xs text-gray-700">
                  {fmtRange(e.start, e.end)}
                </td>
                <td className="px-5 py-2 text-gray-700">{e.businessDays}</td>
                <td className="px-5 py-2 text-gray-700">{e.attorneyName || e.name || '—'}</td>
                <td className="px-5 py-2 text-gray-700">{e.attorney ? e.matchBy : 'unmatched'}</td>
                <td className="px-5 py-2 text-gray-700">{e.title || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ── Holidays ────────────────────────────────────────────────────────────────
const HolidaysTab = ({ holidays }) => {
  if (holidays.length === 0) {
    return (
      <div className="text-sm text-gray-600">
        No synced holidays. The app falls back to US federal holidays for pro-rating.
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-gray-500 border-b border-gray-100 bg-gray-50">
            <th className="px-5 py-2 font-medium">Date</th>
            <th className="px-5 py-2 font-medium">Name</th>
          </tr>
        </thead>
        <tbody>
          {holidays.map((h, i) => (
            <tr key={`${h.date}-${i}`} className="border-b border-gray-50 last:border-0">
              <td className="px-5 py-2 whitespace-nowrap font-mono text-xs text-gray-700">{h.date}</td>
              <td className="px-5 py-2 text-gray-700">{h.name || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export default AdminTimeOffDebug;
