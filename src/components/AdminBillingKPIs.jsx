"use client";

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, Shield, TrendingUp, Clock, AlertTriangle, CheckCircle, Calendar, DollarSign, Activity } from 'lucide-react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '@/firebase/config';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/utils/formatters';
import { parseInvoiceDate } from '@/utils/paymentStatus.mjs';

const DAY_MS = 86400000;
const THRESHOLDS = [15, 30, 60, 90];

const formatPct = (v) => (v == null ? '—' : `${(v * 100).toFixed(1)}%`);
const formatDays = (v) => (v == null ? '—' : `${v.toFixed(1)} days`);

const AdminBillingKPIs = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('payment');

  useEffect(() => {
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'invoices', 'all'));
        setInvoices(snap.exists() ? snap.data().entries || [] : []);
      } catch (err) {
        console.error('Error loading invoices:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const today = useMemo(() => new Date(), []);

  const normalized = useMemo(() => {
    return invoices.map((inv) => {
      const sent = parseInvoiceDate(inv.dateSent, inv.year);
      const received = parseInvoiceDate(inv.dateReceived, inv.year);
      const isPaid = inv.status === 'Paid';
      const daysToPay =
        sent && received ? Math.max(0, Math.round((received.getTime() - sent.getTime()) / DAY_MS)) : null;
      return { ...inv, sentDate: sent, receivedDate: received, isPaid, daysToPay };
    });
  }, [invoices]);

  const paymentTimeStats = useMemo(() => {
    const paid = normalized.filter((i) => i.isPaid && i.daysToPay != null);
    const firmAvg = paid.length ? paid.reduce((s, i) => s + i.daysToPay, 0) / paid.length : null;
    const bucketAt = (list, days) => (list.length ? list.filter((i) => i.daysToPay <= days).length / list.length : null);
    const firmBuckets = THRESHOLDS.reduce((acc, t) => ({ ...acc, [t]: bucketAt(paid, t) }), {});

    const byClient = {};
    paid.forEach((inv) => {
      const c = inv.client || 'Unknown';
      if (!byClient[c]) byClient[c] = { client: c, count: 0, totalDays: 0, items: [] };
      byClient[c].count += 1;
      byClient[c].totalDays += inv.daysToPay;
      byClient[c].items.push(inv);
    });
    const clientRows = Object.values(byClient)
      .map((row) => ({
        client: row.client,
        count: row.count,
        avgDays: row.totalDays / row.count,
        buckets: THRESHOLDS.reduce((acc, t) => ({ ...acc, [t]: bucketAt(row.items, t) }), {}),
      }))
      .sort((a, b) => a.avgDays - b.avgDays);

    return { firmAvg, firmBuckets, clientRows, totalPaid: paid.length };
  }, [normalized]);

  const realizationStats = useMemo(() => {
    const computeAt = (pool, days) => {
      const cutoff = today.getTime() - days * DAY_MS;
      let billed = 0;
      let collected = 0;
      pool.forEach((inv) => {
        if (!inv.sentDate || !inv.amount) return;
        if (inv.sentDate.getTime() > cutoff) return;
        billed += inv.amount;
        if (inv.isPaid && inv.daysToPay != null && inv.daysToPay <= days) collected += inv.amount;
      });
      return billed > 0 ? { rate: collected / billed, billed, collected } : null;
    };

    const firm = THRESHOLDS.reduce((acc, t) => ({ ...acc, [t]: computeAt(normalized, t) }), {});

    const clientGroups = {};
    normalized.forEach((inv) => {
      const c = inv.client || 'Unknown';
      if (!clientGroups[c]) clientGroups[c] = [];
      clientGroups[c].push(inv);
    });
    const clientRows = Object.entries(clientGroups)
      .map(([client, invs]) => {
        const totalBilled = invs.reduce((s, i) => s + (i.amount || 0), 0);
        return {
          client,
          count: invs.length,
          totalBilled,
          buckets: THRESHOLDS.reduce((acc, t) => ({ ...acc, [t]: computeAt(invs, t) }), {}),
        };
      })
      .sort((a, b) => b.totalBilled - a.totalBilled);

    return { firm, clientRows };
  }, [normalized, today]);

  const arStats = useMemo(() => {
    const outstanding = normalized.filter((i) => !i.isPaid && i.sentDate && i.amount);
    const buckets = { current: 0, '30': 0, '60': 0, '90+': 0 };
    const counts = { current: 0, '30': 0, '60': 0, '90+': 0 };
    const items = outstanding.map((inv) => {
      const days = Math.round((today.getTime() - inv.sentDate.getTime()) / DAY_MS);
      let bucket;
      if (days < 30) bucket = 'current';
      else if (days < 60) bucket = '30';
      else if (days < 90) bucket = '60';
      else bucket = '90+';
      buckets[bucket] += inv.amount;
      counts[bucket] += 1;
      return { ...inv, daysOutstanding: days, bucket };
    });
    const total = Object.values(buckets).reduce((a, b) => a + b, 0);
    const overdue = items.filter((i) => i.bucket === '90+').sort((a, b) => b.daysOutstanding - a.daysOutstanding);
    return { buckets, counts, total, items, overdue };
  }, [normalized, today]);

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-gray-500">Loading billing KPIs...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Admin</span>
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <TrendingUp className="w-5 h-5 text-indigo-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Billing KPIs</h1>
                  <p className="text-sm text-gray-600">Payment time, realization rate, and AR aging</p>
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

      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8 space-y-6">
        {/* Tab toggle */}
        <div className="flex justify-center">
          <div className="inline-flex rounded-lg border border-gray-200 bg-white p-1 shadow-sm">
            {[
              { value: 'payment', label: 'Avg Payment Time', icon: Clock },
              { value: 'realization', label: 'Realization Rate', icon: TrendingUp },
              { value: 'aging', label: 'AR Aging', icon: AlertTriangle },
            ].map((opt) => {
              const Icon = opt.icon;
              const active = activeTab === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setActiveTab(opt.value)}
                  className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-md transition-colors ${
                    active ? 'bg-cg-green text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* SECTION 1: Average Payment Time */}
        {activeTab === 'payment' && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-5 h-5 text-blue-600" />
            <h2 className="text-xl font-semibold text-gray-900">Average Payment Time</h2>
            <span className="text-sm text-gray-500">
              ({paymentTimeStats.totalPaid} paid invoices with sent + received dates)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
            <KPICard
              title="Firm Avg"
              value={formatDays(paymentTimeStats.firmAvg)}
              subtitle={`${paymentTimeStats.totalPaid} paid invoices`}
              icon={Calendar}
              iconColor="text-indigo-500"
            />
            {THRESHOLDS.map((t, idx) => {
              const colors = ['text-emerald-500', 'text-blue-500', 'text-amber-500', 'text-red-500'];
              return (
                <KPICard
                  key={t}
                  title={`Paid ≤ ${t}d`}
                  value={formatPct(paymentTimeStats.firmBuckets[t])}
                  subtitle="of paid invoices"
                  icon={CheckCircle}
                  iconColor={colors[idx]}
                />
              );
            })}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Per Client</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Client</Th>
                    <Th right>Paid Invoices</Th>
                    <Th right>Avg Days</Th>
                    {THRESHOLDS.map((t) => <Th key={t} right>≤ {t}d</Th>)}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {paymentTimeStats.clientRows.map((row) => (
                    <tr key={row.client} className="hover:bg-gray-50">
                      <Td>{row.client}</Td>
                      <Td right>{row.count}</Td>
                      <Td right>{formatDays(row.avgDays)}</Td>
                      {THRESHOLDS.map((t) => <Td key={t} right>{formatPct(row.buckets[t])}</Td>)}
                    </tr>
                  ))}
                  {!paymentTimeStats.clientRows.length && (
                    <tr><td colSpan={3 + THRESHOLDS.length} className="px-6 py-8 text-center text-gray-500">No paid invoices</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        )}

        {/* SECTION 2: Realization Rate */}
        {activeTab === 'realization' && (
        <section>
          <div className="flex items-center gap-2 mb-2">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <h2 className="text-xl font-semibold text-gray-900">Realization Rate</h2>
          </div>
          <p className="text-sm text-gray-600 mb-4">
            Collected ÷ billed. For each horizon N, includes only invoices sent ≥ N days ago. An invoice counts as
            collected at horizon N if paid within N days of being sent.
          </p>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            {THRESHOLDS.map((t, idx) => {
              const stat = realizationStats.firm[t];
              const colors = ['text-emerald-500', 'text-blue-500', 'text-amber-500', 'text-red-500'];
              return (
                <KPICard
                  key={t}
                  title={`@ ${t} days`}
                  value={formatPct(stat?.rate)}
                  subtitle={stat ? `${formatCurrency(stat.collected)} / ${formatCurrency(stat.billed)}` : 'No eligible invoices'}
                  icon={TrendingUp}
                  iconColor={colors[idx]}
                />
              );
            })}
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50">
              <h3 className="font-medium text-gray-900">Per Client</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Client</Th>
                    <Th right>Total Billed</Th>
                    <Th right>Invoices</Th>
                    {THRESHOLDS.map((t) => <Th key={t} right>@ {t}d</Th>)}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {realizationStats.clientRows.map((row) => (
                    <tr key={row.client} className="hover:bg-gray-50">
                      <Td>{row.client}</Td>
                      <Td right>{formatCurrency(row.totalBilled)}</Td>
                      <Td right>{row.count}</Td>
                      {THRESHOLDS.map((t) => <Td key={t} right>{formatPct(row.buckets[t]?.rate)}</Td>)}
                    </tr>
                  ))}
                  {!realizationStats.clientRows.length && (
                    <tr><td colSpan={3 + THRESHOLDS.length} className="px-6 py-8 text-center text-gray-500">No invoices</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        )}

        {/* SECTION 3: AR Aging */}
        {activeTab === 'aging' && (
        <section>
          <div className="flex items-center gap-2 mb-4">
            <AlertTriangle className="w-5 h-5 text-amber-600" />
            <h2 className="text-xl font-semibold text-gray-900">Accounts Receivable Aging</h2>
            <span className="text-sm text-gray-500">
              ({arStats.items.length} outstanding, {formatCurrency(arStats.total)} total)
            </span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
            <AgingCard label="Current" sublabel="< 30 days" amount={arStats.buckets.current} count={arStats.counts.current} iconColor="text-emerald-500" />
            <AgingCard label="30–59 days" amount={arStats.buckets['30']} count={arStats.counts['30']} iconColor="text-blue-500" />
            <AgingCard label="60–89 days" amount={arStats.buckets['60']} count={arStats.counts['60']} iconColor="text-amber-500" />
            <AgingCard label="90+ days" sublabel="Overdue" amount={arStats.buckets['90+']} count={arStats.counts['90+']} iconColor="text-red-500" overdue />
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="px-6 py-3 border-b border-gray-200 bg-gray-50 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600" />
              <h3 className="font-medium text-gray-900">Overdue Invoices (90+ days)</h3>
              <span className="text-sm text-gray-500">{arStats.overdue.length} flagged</span>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <Th>Client</Th>
                    <Th>Date Sent</Th>
                    <Th right>Amount</Th>
                    <Th right>Days Outstanding</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {arStats.overdue.map((inv, idx) => (
                    <tr key={`${inv.client}-${inv.sheetRowNumber}-${idx}`} className="hover:bg-gray-50 bg-red-50/30">
                      <Td>{inv.client}</Td>
                      <Td>{inv.sentDate ? inv.sentDate.toLocaleDateString() : '—'}</Td>
                      <Td right>{formatCurrency(inv.amount)}</Td>
                      <Td right>
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          {inv.daysOutstanding} days
                        </span>
                      </Td>
                      <Td>
                        <span className="text-sm text-gray-600">{inv.status || 'Outstanding'}</span>
                      </Td>
                    </tr>
                  ))}
                  {!arStats.overdue.length && (
                    <tr><td colSpan={5} className="px-6 py-8 text-center text-gray-500">No invoices 90+ days overdue</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
        )}
      </div>
    </div>
  );
};

const KPICard = ({ title, value, subtitle, icon: Icon, iconColor = 'text-cg-green' }) => (
  <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
    <div className="flex items-center justify-between mb-1">
      <span className="text-gray-600 text-sm font-medium">{title}</span>
      {Icon && <Icon className={`w-5 h-5 ${iconColor}`} />}
    </div>
    <div className="flex-1 flex items-center justify-center">
      <div className="text-3xl font-bold text-gray-900 text-center">{value}</div>
    </div>
    {subtitle && <div className="text-sm text-gray-600 text-center">{subtitle}</div>}
  </div>
);

const AgingCard = ({ label, sublabel, amount, count, iconColor, overdue }) => (
  <div className="bg-white p-4 rounded-lg shadow aspect-square flex flex-col justify-between">
    <div className="flex items-center justify-between mb-1">
      <span className="text-gray-600 text-sm font-medium">{label}</span>
      {overdue ? <AlertTriangle className={`w-5 h-5 ${iconColor}`} /> : <DollarSign className={`w-5 h-5 ${iconColor}`} />}
    </div>
    <div className="flex-1 flex items-center justify-center">
      <div className={`text-3xl font-bold text-center ${overdue ? 'text-red-600' : 'text-gray-900'}`}>
        {formatCurrency(amount)}
      </div>
    </div>
    <div className="text-sm text-gray-600 text-center">
      {count} invoice{count === 1 ? '' : 's'}{sublabel ? ` · ${sublabel}` : ''}
    </div>
  </div>
);

const Th = ({ children, right }) => (
  <th className={`px-6 py-3 ${right ? 'text-right' : 'text-left'} text-xs font-medium text-gray-500 uppercase tracking-wider`}>
    {children}
  </th>
);

const Td = ({ children, right }) => (
  <td className={`px-6 py-3 whitespace-nowrap text-sm text-gray-900 ${right ? 'text-right' : ''}`}>
    {children}
  </td>
);

export default AdminBillingKPIs;
