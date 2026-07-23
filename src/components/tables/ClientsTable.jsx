"use client";

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Ban } from 'lucide-react';
import { formatCurrency, formatHours } from '../../utils/formatters';
import { getStatusBadge } from '@/utils/statusStyles';
import { getPaymentStatusBadge, PAYMENT_STATUS_LABEL, HOLD_FLAG_MESSAGE } from '@/utils/paymentStatus.mjs';
import { ClientRowTooltip, useRowTooltip } from '../tooltips';
import { CalcTooltip } from '../shared';
import SortableTh from './SortableTh';

const ClientsTable = ({
  clients,
  sortConfig,
  onSort,
}) => {
  const router = useRouter();
  // Row-detail tooltip: hover + keyboard focus, Escape-dismissable (WCAG
  // 1.4.13/2.1.1) — shared wiring in tooltips/useRowTooltip.
  const rowTooltip = useRowTooltip();

  const handleClientClick = (clientName) => {
    router.push(`/clients/${encodeURIComponent(clientName)}`);
  };

  return (
    <div className="bg-white rounded-lg shadow overflow-x-auto">
      <table aria-label="Clients" className="min-w-full divide-y divide-gray-200 table-fixed">
        <thead className="bg-gray-50">
          <tr>
            <SortableTh
              label="Client Name"
              sortKey="name"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[16%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
            <SortableTh
              label="Status"
              sortKey="status"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[9%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="activeClients" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Payment"
              sortKey="paymentStatus"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[11%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="paymentStatusTag" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Avg Days"
              sortKey="avgPaymentDays"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[9%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="avgPaymentDays" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Outstanding"
              sortKey="outstandingInvoices"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[9%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="outstandingInvoices" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Billable Hours"
              sortKey="billableHours"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[11%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="billableHours" position="bottom" />
            </SortableTh>
            <SortableTh
              label="Billables"
              sortKey="grossBillables"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[11%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            >
              <CalcTooltip calcKey="grossBillables" position="bottom" align="right" />
            </SortableTh>
            {/* Per-client "General Notes" — paired to each client by name, so it
                rides along with its row through any sort (not sortable itself,
                free text). */}
            <th scope="col" className="w-[14%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Notes
            </th>
            <SortableTh
              label="Last Activity"
              sortKey="lastActivity"
              sortConfig={sortConfig}
              onSort={onSort}
              className="w-[10%] px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
            />
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {clients.map((client, idx) => (
            <tr 
              key={idx} 
              className="hover:bg-purple-50 cursor-pointer transition-colors"
              onClick={() => handleClientClick(client.name)}
              {...(client.entryCount > 0 ? rowTooltip.rowProps(client) : {})}
            >
              <th scope="row" className="px-6 py-4 whitespace-nowrap text-sm font-medium text-blue-600 hover:text-blue-800 text-left">
                <Link
                  href={`/clients/${encodeURIComponent(client.name)}`}
                  onClick={(e) => e.stopPropagation()}
                  className="hover:underline"
                >
                  {client.name}
                </Link>
              </th>
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
                  data-testid="payment-status-tag"
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
              <td className="px-6 py-4 whitespace-nowrap text-sm text-green-700 font-medium">
                {formatCurrency(client.grossBillables || 0)}
              </td>
              <td
                className="px-6 py-4 text-sm text-gray-500 truncate"
                title={client.notes || undefined}
              >
                {client.notes || '—'}
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
      
      {rowTooltip.active && (
        <ClientRowTooltip
          client={rowTooltip.active}
          position={rowTooltip.position}
          {...rowTooltip.tooltipProps}
        />
      )}
    </div>
  );
};

export default ClientsTable;