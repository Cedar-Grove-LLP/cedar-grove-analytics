"use client";

import { useState, useMemo } from 'react';
import { Search } from 'lucide-react';
import { DateRangeIndicator } from '../shared';
import { ClientsTable } from '../tables';
import { ClientHoursChart, ServiceBreadthChart } from '../charts';
import { useAttorneyRates } from '@/hooks/useAttorneyRates';
import { useUsers } from '@/hooks/useFirestoreData';
import { getEntryDate } from '@/utils/dateHelpers';

const ClientsView = ({
  dateRangeLabel,
  globalAttorneyFilter,
  allAttorneyNames,
  clientData,
  clientCounts,
  filteredBillableEntries,
}) => {
  const [clientSearch, setClientSearch] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'totalHours', direction: 'desc' });
  const [clientFilter, setClientFilter] = useState('billable'); // 'all' | 'billable' | 'non-billable'
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
    if (key === 'name' || key === 'status') direction = 'asc';
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
      <DateRangeIndicator
        dateRangeLabel={dateRangeLabel}
        entryCount={clientData?.length || 0}
        globalAttorneyFilter={globalAttorneyFilter}
        allAttorneyNames={allAttorneyNames}
      />

      {/* Client Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white p-6 rounded-lg shadow">
          <div className="flex items-center justify-between">
            <div>
              <span className="text-gray-600 text-sm">Active Clients</span>
              <div className="text-3xl font-bold text-green-600 mt-2">{activeCount}</div>
            </div>
            <div className="text-gray-300 text-4xl font-light mx-4">/</div>
            <div>
              <span className="text-gray-600 text-sm">Quiet Clients</span>
              <div className="text-3xl font-bold text-amber-600 mt-2">{inactiveCount}</div>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t border-gray-100">
            <div className="flex items-center justify-between">
              <div className="text-gray-400 text-xs">
                Total: {clientCounts.total} clients (Active + Quiet status)
              </div>
              <div className="flex rounded-lg border border-gray-200 overflow-hidden">
                {[
                  { key: 'all', label: 'All' },
                  { key: 'billable', label: 'Active' },
                  { key: 'non-billable', label: 'Quiet' },
                ].map(opt => (
                  <button
                    key={opt.key}
                    onClick={() => setClientFilter(opt.key)}
                    className={`px-3 py-1 text-xs font-medium transition-colors ${
                      clientFilter === opt.key
                        ? 'bg-gray-900 text-white'
                        : 'bg-white text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow flex items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input
              type="text"
              placeholder="Search clients..."
              value={clientSearch}
              onChange={(e) => setClientSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
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