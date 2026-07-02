"use client";

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, DollarSign, ArrowDownCircle, ArrowUpCircle, ExternalLink, RefreshCw, Search } from 'lucide-react';
import { collection, getDocs } from 'firebase/firestore';
import { db, auth } from '@/firebase/config';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/utils/formatters';
import { getStatusBadge } from '@/utils/statusStyles';

const FILTER_OPTIONS = [
  { key: 'all', label: 'All Transactions' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'payments', label: 'Payments' },
];

const AdminTransactions = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [transactions, setTransactions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);
  const [filter, setFilter] = useState('all');
  const [nameFilter, setNameFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'postedAt', direction: 'desc' });

  const fetchTransactions = useCallback(async () => {
    try {
      const snapshot = await getDocs(collection(db, 'transactions'));
      const docs = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
      setTransactions(docs);
    } catch (err) {
      console.error('Error fetching transactions:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTransactions();
  }, [fetchTransactions]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      if (!auth.currentUser) {
        throw new Error('You are not signed in.');
      }
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/sync-transactions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setSyncStatus({ type: 'success', message: `Synced ${data.synced} transactions` });
        await fetchTransactions();
      } else {
        setSyncStatus({ type: 'error', message: data.error || 'Sync failed' });
      }
    } catch (err) {
      setSyncStatus({ type: 'error', message: err.message });
    } finally {
      setSyncing(false);
    }
  };

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? ' ↑' : ' ↓';
  };

  const filteredAndSorted = useMemo(() => {
    let items = transactions;

    if (filter === 'expenses') {
      items = items.filter((t) => t.amount < 0);
    } else if (filter === 'payments') {
      items = items.filter((t) => t.amount > 0);
    }

    // Counterparty name search (case-insensitive substring)
    const nameQuery = nameFilter.trim().toLowerCase();
    if (nameQuery) {
      items = items.filter((t) => (t.counterpartyName || '').toLowerCase().includes(nameQuery));
    }

    items = [...items].sort((a, b) => {
      const { key, direction } = sortConfig;
      let aVal = a[key];
      let bVal = b[key];

      if (key === 'postedAt' || key === 'createdAt') {
        aVal = aVal ? new Date(aVal).getTime() : 0;
        bVal = bVal ? new Date(bVal).getTime() : 0;
      } else if (key === 'amount') {
        aVal = aVal ?? 0;
        bVal = bVal ?? 0;
      } else {
        aVal = (aVal ?? '').toString().toLowerCase();
        bVal = (bVal ?? '').toString().toLowerCase();
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  }, [transactions, filter, nameFilter, sortConfig]);

  const summaryStats = useMemo(() => {
    const expenses = transactions.filter((t) => t.amount < 0);
    const payments = transactions.filter((t) => t.amount > 0);
    return {
      totalCount: transactions.length,
      expenseCount: expenses.length,
      expenseTotal: expenses.reduce((sum, t) => sum + t.amount, 0),
      paymentCount: payments.length,
      paymentTotal: payments.reduce((sum, t) => sum + t.amount, 0),
    };
  }, [transactions]);

  const formatPostedDate = (dateStr) => {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

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
                <div className="p-2 bg-emerald-100 rounded-lg">
                  <DollarSign className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
                  <p className="text-sm text-gray-600">Mercury bank transactions</p>
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync from Mercury'}</span>
              </button>
              {syncStatus && (
                <span className={`text-sm ${syncStatus.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                  {syncStatus.message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-3">
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-8 h-8 rounded-full"
                    />
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

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500 text-sm">Loading transactions...</div>
          </div>
        ) : <>
        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <DollarSign className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Total Transactions</div>
                <div className="text-xl font-semibold text-gray-900">{summaryStats.totalCount}</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-50 rounded-lg">
                <ArrowDownCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Expenses ({summaryStats.expenseCount})</div>
                <div className="text-xl font-semibold text-red-600">{formatCurrency(summaryStats.expenseTotal)}</div>
              </div>
            </div>
          </div>
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-50 rounded-lg">
                <ArrowUpCircle className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <div className="text-sm text-gray-600">Payments ({summaryStats.paymentCount})</div>
                <div className="text-xl font-semibold text-green-600">{formatCurrency(summaryStats.paymentTotal)}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Filter Tabs */}
        <div className="flex items-center gap-2 mb-4">
          {FILTER_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              onClick={() => setFilter(opt.key)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                filter === opt.key
                  ? 'bg-gray-900 text-white'
                  : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
              }`}
            >
              {opt.label}
            </button>
          ))}

          {/* Counterparty name search */}
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={nameFilter}
              onChange={(e) => setNameFilter(e.target.value)}
              placeholder="Search counterparty..."
              className="pl-9 pr-3 py-2 rounded-lg text-sm bg-white text-gray-700 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 w-52"
            />
          </div>

          <span className="ml-auto text-sm text-gray-500">
            Showing {filteredAndSorted.length} transaction{filteredAndSorted.length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th
                    onClick={() => handleSort('postedAt')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  >
                    Date{getSortIndicator('postedAt')}
                  </th>
                  <th
                    onClick={() => handleSort('status')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  >
                    Status{getSortIndicator('status')}
                  </th>
                  <th
                    onClick={() => handleSort('amount')}
                    className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  >
                    Amount{getSortIndicator('amount')}
                  </th>
                  <th
                    onClick={() => handleSort('counterpartyName')}
                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  >
                    Counterparty{getSortIndicator('counterpartyName')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Description
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Note
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                    Link
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {filteredAndSorted.map((txn) => (
                  <tr key={txn.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                      {formatPostedDate(txn.postedAt || txn.createdAt)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${
                          getStatusBadge(txn.status)
                        }`}
                      >
                        {txn.status}
                      </span>
                    </td>
                    <td
                      className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-right ${
                        txn.amount < 0 ? 'text-red-600' : 'text-green-600'
                      }`}
                    >
                      {formatCurrency(txn.amount)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900 max-w-[200px] truncate">
                      {txn.counterpartyName || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[250px] truncate">
                      {txn.bankDescription || '—'}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-[200px] truncate">
                      {txn.note || '—'}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                      {txn.dashboardLink ? (
                        <a
                          href={txn.dashboardLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 transition-colors"
                        >
                          <ExternalLink className="w-4 h-4" />
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
                {filteredAndSorted.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-6 py-12 text-center text-sm text-gray-500">
                      No transactions found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        </>}
      </div>
    </div>
  );
};

export default AdminTransactions;
