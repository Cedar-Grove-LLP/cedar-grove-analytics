"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { getStatusBadge } from '@/utils/statusStyles';
import { getClientRatingBadge, RATING_LABEL } from '@/utils/clientRating';
import { ClientRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';

const ClientsTable = ({
  clients,
  sortConfig,
  onSort,
}) => {
  const router = useRouter();
  const [hoveredClient, setHoveredClient] = useState(null);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const getSortIndicator = (key) => {
    if (sortConfig.key !== key) return '';
    return sortConfig.direction === 'asc' ? '↑' : '↓';
  };

  const handleClientClick = (clientName) => {
    router.push(`/clients/${encodeURIComponent(clientName)}`);
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <th
              onClick={() => onSort('name')}
              className="w-[28%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Client Name {getSortIndicator('name')}
            </th>
            <th
              onClick={() => onSort('status')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Status {getSortIndicator('status')}
                <CalcTooltip calcKey="activeClients" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('idealRating')}
              className="w-[13%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Ideal {getSortIndicator('idealRating')}
            </th>
            <th
              onClick={() => onSort('billableHours')}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Billable Hours {getSortIndicator('billableHours')}
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('grossBillables')}
              className="w-[15%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Billables {getSortIndicator('grossBillables')}
                <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
              </span>
            </th>
            <th
              onClick={() => onSort('lastActivity')}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Last Activity {getSortIndicator('lastActivity')}
            </th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {clients.map((client, idx) => (
            <tr 
              key={idx} 
              className="hover:bg-purple-50 cursor-pointer transition-colors"
              onClick={() => handleClientClick(client.name)}
              onMouseEnter={(e) => {
                if (client.entryCount > 0) {
                  setHoveredClient(client);
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }
              }}
              onMouseMove={(e) => {
                if (client.entryCount > 0) {
                  setTooltipPosition({ x: e.clientX, y: e.clientY });
                }
              }}
              onMouseLeave={() => setHoveredClient(null)}
            >
              <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800">
                <span className="hover:underline">{client.name}</span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <span
                  className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                    getStatusBadge((client.billableHours || client.totalHours || 0) > 0 ? 'active' : 'quiet')
                  }`}
                >
                  {(client.billableHours || client.totalHours || 0) > 0 ? 'Active' : 'Quiet'}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                {client.idealRating ? (
                  <span
                    className={`inline-flex px-2 py-1 text-xs font-semibold rounded-full ${getClientRatingBadge(client.idealRating)}`}
                  >
                    {RATING_LABEL[client.idealRating]}
                  </span>
                ) : (
                  <span className="text-gray-300">—</span>
                )}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {formatHours(client.billableHours || client.totalHours || 0)}h
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-green-600 font-medium">
                {formatCurrency(client.grossBillables || 0)}
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                {client.lastActivity !== 'No activity' 
                  ? new Date(client.lastActivity).toLocaleDateString() 
                  : 'No activity'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      
      {hoveredClient && (
        <ClientRowTooltip 
          client={hoveredClient} 
          position={tooltipPosition}
        />
      )}
    </div>
  );
};

export default ClientsTable;