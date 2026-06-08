"use client";

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { DateRangeIndicator, ClientStatCard } from '../shared';
import { ClientsTable } from '../tables';
import { ClientHoursChart, ServiceBreadthChart } from '../charts';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { useUsers } from '@/hooks/useFirestoreData';
import { getEntryDate } from '@/utils/dateHelpers';
import { RATING_RANK } from '@/utils/clientRating';

// Sum billable hours per client name across a set of entries (used to decide
// which clients were "active" in a given window).
const sumHoursByClient = (entries) => {
  const map = new Map();
  (entries || []).forEach(entry => {
    const hours = entry.billableHours || 0;
    if (hours <= 0) return;
    const name = entry.client || 'Unknown';
    map.set(name, (map.get(name) || 0) + hours);
  });
  return map;
};

const ClientsView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  clientData,
  filteredBillableEntries,
  priorPeriodBillableEntries,
  hasPriorPeriod,
}) => {
  const [clientSearch, setClientSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'totalHours', direction: 'desc' });
  const [clientFilter, setClientFilter] = useState('billable'); // 'all' | 'billable' | 'non-billable'
  const [ratingFilter, setRatingFilter] = useState('all'); // 'all' | 'ideal' | 'non-ideal' | 'tbd'
  const { getRate, loading: ratesLoading } = useAttorneyRates();
  const { users: firebaseUsers } = useUsers();

  // Build userId -> display name map
  const userMap = useMemo(() => {
    const map = {};
    (firebaseUsers || []).forEach(user => {
      map[user.id] = user.name || user.id;
    });
    return map;
  }, [firebaseUsers]);

  // Calculate gross billables and billable hours per client from filteredEntries
  const clientsWithBillables = useMemo(() => {
    if (!clientData || !Array.isArray(clientData)) {
      return [];
    }

    // Build maps of client data from entries
    const clientDataMap = {};
    
    if (filteredBillableEntries && Array.isArray(filteredBillableEntries)) {
      filteredBillableEntries.forEach(entry => {
        const clientName = entry.client || 'Unknown';
        const billableHours = entry.billableHours || 0;
        const attorneyName = userMap[entry.userId] || entry.userId;
        const category = entry.billingCategory || 'Other';
        
        // Only process entries with billable hours
        if (billableHours <= 0) return;
        
        if (!clientDataMap[clientName]) {
          clientDataMap[clientName] = {
            grossBillables: 0,
            billableHours: 0,
            entryCount: 0,
            entries: [],
            byAttorney: {},
            byCategory: {},
          };
        }
        
        const clientInfo = clientDataMap[clientName];
        
        // Calculate gross billables for this entry
        const entryDate = getEntryDate(entry);
        const rate = attorneyName ? getRate(attorneyName, entryDate) : 0;
        const entryGrossBillables = rate * billableHours;
        
        // Accumulate totals
        clientInfo.billableHours += billableHours;
        clientInfo.grossBillables += entryGrossBillables;
        clientInfo.entryCount += 1;
        
        // Add entry with calculated grossBillables (for tooltip)
        clientInfo.entries.push({
          date: entry.date,
          attorney: attorneyName,
          category: category,
          billableHours: billableHours,
          grossBillables: entryGrossBillables,
        });
        
        // Track by attorney
        if (attorneyName) {
          if (!clientInfo.byAttorney[attorneyName]) {
            clientInfo.byAttorney[attorneyName] = { hours: 0, count: 0, grossBillables: 0 };
          }
          clientInfo.byAttorney[attorneyName].hours += billableHours;
          clientInfo.byAttorney[attorneyName].count += 1;
          clientInfo.byAttorney[attorneyName].grossBillables += entryGrossBillables;
        }
        
        // Track by category
        if (!clientInfo.byCategory[category]) {
          clientInfo.byCategory[category] = { hours: 0, count: 0, grossBillables: 0 };
        }
        clientInfo.byCategory[category].hours += billableHours;
        clientInfo.byCategory[category].count += 1;
        clientInfo.byCategory[category].grossBillables += entryGrossBillables;
      });
    }

    // Sort entries by date (most recent first) for each client
    Object.values(clientDataMap).forEach(clientInfo => {
      clientInfo.entries.sort((a, b) => new Date(b.date) - new Date(a.date));
    });

    // Merge calculated data into clientData
    return clientData.map(client => {
      const calculated = clientDataMap[client.name] || {};
      return {
        ...client,
        billableHours: calculated.billableHours || 0,
        grossBillables: calculated.grossBillables || 0,
        entryCount: calculated.entryCount || client.entryCount || 0,
        entries: calculated.entries || [],
        byAttorney: calculated.byAttorney || client.byAttorney || {},
        byCategory: calculated.byCategory || client.byCategory || {},
      };
    });
  }, [clientData, filteredBillableEntries, getRate, userMap]);

  const handleSort = (key) => {
    let direction = 'desc';
    if (key === 'name' || key === 'status' || key === 'idealRating') direction = 'asc';
    if (sortConfig.key === key) {
      direction = sortConfig.direction === 'asc' ? 'desc' : 'asc';
    }
    setSortConfig({ key, direction });
  };

  const getSortedClients = () => {
    let filtered = clientsWithBillables.filter(client =>
      client.name.toLowerCase().includes(clientSearch.toLowerCase())
    );

    // Filter by billable status
    if (clientFilter === 'billable') {
      filtered = filtered.filter(client => isBillableClient(client));
    } else if (clientFilter === 'non-billable') {
      filtered = filtered.filter(client => !isBillableClient(client));
    }

    // Filter by ideal-client fit rating. The TBD bucket also absorbs untagged
    // clients, matching the "TBD · sample" KPI card (tbd + no-data).
    if (ratingFilter === 'tbd') {
      filtered = filtered.filter(client => !client.idealRating || client.idealRating === 'tbd');
    } else if (ratingFilter !== 'all') {
      filtered = filtered.filter(client => client.idealRating === ratingFilter);
    }

    filtered.sort((a, b) => {
      let aVal, bVal;
      
      switch (sortConfig.key) {
        case 'name':
          aVal = a.name.toLowerCase();
          bVal = b.name.toLowerCase();
          break;
        case 'status':
          aVal = (a.billableHours || a.totalHours) > 0 ? 'active' : 'inactive';
          bVal = (b.billableHours || b.totalHours) > 0 ? 'active' : 'inactive';
          break;
        case 'idealRating':
          // Rank ideal first, untagged last; ties fall back to billable hours.
          aVal = RATING_RANK[a.idealRating] ?? 99;
          bVal = RATING_RANK[b.idealRating] ?? 99;
          break;
        case 'billableHours':
          aVal = a.billableHours || a.totalHours || 0;
          bVal = b.billableHours || b.totalHours || 0;
          break;
        case 'grossBillables':
          aVal = a.grossBillables || 0;
          bVal = b.grossBillables || 0;
          break;
        case 'lastActivity':
          aVal = a.lastActivity === 'No activity' ? '' : a.lastActivity;
          bVal = b.lastActivity === 'No activity' ? '' : b.lastActivity;
          break;
        default:
          aVal = a.billableHours || a.totalHours || 0;
          bVal = b.billableHours || b.totalHours || 0;
      }
      
      if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
      return 0;
    });

    return filtered;
  };

  // A client is "Active" when they have billable hours in the selected date
  // range, otherwise "Quiet". (Previously keyed off recent invoicing, which
  // mislabeled clients with billable hours but no invoice in the last 3 months.)
  const isBillableClient = (client) => (client.billableHours || client.totalHours || 0) > 0;
  const activeCount = clientsWithBillables.filter(isBillableClient).length;
  const inactiveCount = clientsWithBillables.filter(c => !isBillableClient(c)).length;

  // ---- KPI summary (Status + Ideal-fit) ---------------------------------
  const bookTotal = clientsWithBillables.length;

  // Clients active in the prior comparison window, measured over the *current*
  // roster (no historical roster exists). bookTotal is constant across both
  // windows, so the Quiet delta is exactly the mirror of the Active delta.
  // Null (delta hidden) for all-time, and when the prior window holds no
  // billable data at all (e.g. the earliest period) — comparing against an
  // empty window would render a spurious "+N vs prior period".
  const priorActiveCount = useMemo(() => {
    if (!hasPriorPeriod || !priorPeriodBillableEntries?.length) return null;
    const priorHours = sumHoursByClient(priorPeriodBillableEntries);
    return clientsWithBillables.filter(c => (priorHours.get(c.name) || 0) > 0).length;
  }, [hasPriorPeriod, priorPeriodBillableEntries, clientsWithBillables]);

  const activeDelta = priorActiveCount === null ? null : activeCount - priorActiveCount;
  const quietDelta = activeDelta === null ? null : -activeDelta;

  // Ideal-client fit over the whole book; untagged clients fall into TBD so the
  // three buckets always sum to bookTotal.
  const idealCount = clientsWithBillables.filter(c => c.idealRating === 'ideal').length;
  const nonIdealCount = clientsWithBillables.filter(c => c.idealRating === 'non-ideal').length;
  const tbdCount = bookTotal - idealCount - nonIdealCount;

  const pct = (n) => (bookTotal > 0 ? Math.round((n / bookTotal) * 100) : 0);

  const isAttorneyFiltered = globalAttorneyFilter?.length > 0 &&
    globalAttorneyFilter?.length < allAttorneyNames?.length;

  if (ratesLoading) {
    return (
      <div className="space-y-6">
        <DateRangeIndicator
          dateRangeLabel={dateRangeLabel}
          entryCount={clientData?.length || 0}
          globalAttorneyFilter={globalAttorneyFilter}
          allAttorneyNames={allAttorneyNames}
        />
        <div className="bg-white p-8 rounded-lg shadow text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <div className="mt-2 text-gray-500">Loading billing rates...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Reporting header */}
      <div>
        <p className="text-base text-cg-dark">
          Showing data for{' '}
          <span className="font-semibold text-cg-green">{dateRangeLabel}</span>
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-400">
          <span className="w-2 h-2 rounded-full bg-cg-green inline-block" />
          Totals update with the selected time range · deltas vs. prior period
          {isAttorneyFiltered && (
            <span className="text-cg-dark">
              · Filtered to{' '}
              {globalAttorneyFilter.length === 1
                ? globalAttorneyFilter[0]
                : `${globalAttorneyFilter.length} attorneys`}
            </span>
          )}
        </p>
      </div>

      {/* Status: Active vs Quiet */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Status · {bookTotal} total clients
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ClientStatCard
            label="Active clients"
            value={activeCount}
            accent="green"
            percent={pct(activeCount)}
            percentLabel="of book"
            delta={activeDelta}
          />
          <ClientStatCard
            label="Quiet clients"
            value={inactiveCount}
            accent="amber"
            percent={pct(inactiveCount)}
            percentLabel="of book"
            delta={quietDelta}
          />
        </div>
      </div>

      {/* Ideal-client fit */}
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Ideal-client fit
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <ClientStatCard
            label="Ideal"
            value={idealCount}
            accent="green"
            percent={pct(idealCount)}
            percentLabel="· sample"
          />
          <ClientStatCard
            label="Non-Ideal"
            value={nonIdealCount}
            accent="red"
            percent={pct(nonIdealCount)}
            percentLabel="· sample"
          />
          <ClientStatCard
            label="TBD"
            value={tbdCount}
            accent="blue"
            percent={pct(tbdCount)}
            percentLabel="· sample"
          />
        </div>
      </div>

      {/* Search + filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
          <input
            type="text"
            placeholder="Search clients..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-cg-green focus:border-transparent"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[
              { key: 'all', label: 'All' },
              { key: 'billable', label: 'Active' },
              { key: 'non-billable', label: 'Quiet' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setClientFilter(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  clientFilter === opt.key
                    ? 'bg-cg-green text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {[
              { key: 'all', label: 'All' },
              { key: 'ideal', label: 'Ideal' },
              { key: 'non-ideal', label: 'Non-Ideal' },
              { key: 'tbd', label: 'TBD' },
            ].map(opt => (
              <button
                key={opt.key}
                onClick={() => setRatingFilter(opt.key)}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  ratingFilter === opt.key
                    ? 'bg-cg-green text-white'
                    : 'bg-white text-gray-600 hover:bg-gray-50'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Clients Table */}
      <ClientsTable
        clients={getSortedClients()}
        sortConfig={sortConfig}
        onSort={handleSort}
      />

      {/* Client Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ClientHoursChart data={clientsWithBillables} />
        <ServiceBreadthChart data={clientsWithBillables} />
      </div>
    </div>
  );
};

export default ClientsView;