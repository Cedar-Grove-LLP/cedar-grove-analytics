"use client";

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Ban } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { getStatusBadge } from '@/utils/statusStyles';
import { getPaymentStatusBadge, PAYMENT_STATUS_LABEL, HOLD_FLAG_MESSAGE } from '@/utils/paymentStatus.mjs';
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
              className="w-[20%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              Client Name {getSortIndicator('name')}
            </th>
            <th
              onClick={() => onSort('status')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Status {getSortIndicator('status')}
                <CalcTooltip calcKey="activeClients" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('paymentStatus')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Payment {getSortIndicator('paymentStatus')}
                <CalcTooltip calcKey="paymentStatusTag" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('avgPaymentDays')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Avg Days {getSortIndicator('avgPaymentDays')}
                <CalcTooltip calcKey="avgPaymentDays" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('outstandingInvoices')}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Outstanding {getSortIndicator('outstandingInvoices')}
                <CalcTooltip calcKey="outstandingInvoices" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('billableHours')}
              className="w-[13%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Billable Hours {getSortIndicator('billableHours')}
                <CalcTooltip calcKey="billableHours" position="bottom" />
              </span>
            </th>
            <th
              onClick={() => onSort('grossBillables')}
              className="w-[12%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
            >
              <span className="inline-flex items-center gap-1">
                Billables {getSortIndicator('grossBillables')}
                <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
              </span>
            </th>
            <th
              onClick={() => onSort('lastActivity')}
              className="w-[13%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100"
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
              {/* paymentStatus is always set by ClientsView's merge — every
                  client gets a tag, so no empty state is needed here */}
              <td className="px-6 py-4 whitespace-nowrap text-sm">
                <span
                  title={client.holdFlag ? HOLD_FLAG_MESSAGE : undefined}
                  className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-full ${getPaymentStatusBadge(client.paymentStatus)}`}
                >
                  {PAYMENT_STATUS_LABEL[client.paymentStatus]}
                  {client.holdFlag && <Ban className="w-3 h-3" />}
                </span>
              </td>
              <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                {client.avgPaymentDays !== null && client.avgPaymentDays !== undefined
                  ? `${client.avgPaymentDays.toFixed(1)} days`
                  : '—'}
              </td>
              <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium ${
                (client.outstandingInvoices || 0) > 0 ? 'text-status-danger' : 'text-gray-900'
              }`}>
                {client.outstandingInvoices || 0}
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