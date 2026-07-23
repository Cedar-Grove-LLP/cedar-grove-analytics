import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBillableClient,
  matchesSearch,
  matchesActivityFilter,
  matchesPaymentFilter,
  getSortValue,
  compareClients,
} from '../src/utils/clientSort.mjs';
import { PAYMENT_STATUS } from '../src/utils/paymentStatus.mjs';

const sortNames = (clients, key, direction) =>
  [...clients].sort((a, b) => compareClients(a, b, { key, direction })).map(c => c.name);

// ---------------------------------------------------------------------------
// Filter predicates
// ---------------------------------------------------------------------------

test('isBillableClient: true when billableHours > 0', () => {
  assert.equal(isBillableClient({ billableHours: 2.5 }), true);
});

test('isBillableClient: falls back to totalHours when billableHours is 0/absent', () => {
  assert.equal(isBillableClient({ billableHours: 0, totalHours: 3 }), true);
  assert.equal(isBillableClient({ totalHours: 1 }), true);
});

test('isBillableClient: false when both are 0 or absent', () => {
  assert.equal(isBillableClient({ billableHours: 0, totalHours: 0 }), false);
  assert.equal(isBillableClient({}), false);
});

test('matchesSearch: case-insensitive substring on name', () => {
  const client = { name: 'Acme Holdings' };
  assert.equal(matchesSearch(client, 'acme'), true);
  assert.equal(matchesSearch(client, 'HOLD'), true);
  assert.equal(matchesSearch(client, 'zzz'), false);
  assert.equal(matchesSearch(client, ''), true); // empty search matches all
});

test('matchesActivityFilter: billable / non-billable / all', () => {
  const active = { billableHours: 1 };
  const quiet = { billableHours: 0, totalHours: 0 };
  assert.equal(matchesActivityFilter(active, 'billable'), true);
  assert.equal(matchesActivityFilter(quiet, 'billable'), false);
  assert.equal(matchesActivityFilter(active, 'non-billable'), false);
  assert.equal(matchesActivityFilter(quiet, 'non-billable'), true);
  assert.equal(matchesActivityFilter(active, 'all'), true);
  assert.equal(matchesActivityFilter(quiet, 'all'), true);
});

test('matchesPaymentFilter: exact tag match, all passes everything', () => {
  const onTarget = { paymentStatus: PAYMENT_STATUS.ON_TARGET };
  const hold = { paymentStatus: PAYMENT_STATUS.HOLD };
  assert.equal(matchesPaymentFilter(onTarget, PAYMENT_STATUS.ON_TARGET), true);
  assert.equal(matchesPaymentFilter(hold, PAYMENT_STATUS.ON_TARGET), false);
  assert.equal(matchesPaymentFilter(hold, PAYMENT_STATUS.HOLD), true);
  assert.equal(matchesPaymentFilter(onTarget, 'all'), true);
  assert.equal(matchesPaymentFilter(hold, 'all'), true);
  assert.equal(matchesPaymentFilter({}, 'all'), true); // missing tag still passes 'all'
});

// ---------------------------------------------------------------------------
// Sort columns, asc + desc
// ---------------------------------------------------------------------------

test('sort by name: case-insensitive alphabetical, both directions', () => {
  const clients = [
    { name: 'zeta Corp' },
    { name: 'Alpha LLC' },
    { name: 'beta Inc' },
  ];
  assert.deepEqual(sortNames(clients, 'name', 'asc'), ['Alpha LLC', 'beta Inc', 'zeta Corp']);
  assert.deepEqual(sortNames(clients, 'name', 'desc'), ['zeta Corp', 'beta Inc', 'Alpha LLC']);
});

test('sort by status: active before inactive ascending', () => {
  const clients = [
    { name: 'Quiet', billableHours: 0, totalHours: 0 },
    { name: 'Active', billableHours: 5 },
    { name: 'ViaTotal', billableHours: 0, totalHours: 2 }, // totalHours fallback → active
  ];
  // 'active' < 'inactive' lexicographically, so asc puts active clients first.
  assert.deepEqual(sortNames(clients, 'status', 'asc'), ['Active', 'ViaTotal', 'Quiet']);
  assert.deepEqual(sortNames(clients, 'status', 'desc'), ['Quiet', 'Active', 'ViaTotal']);
});

test('sort by paymentStatus: On Target → Warning → Hold ascending', () => {
  const clients = [
    { name: 'H', paymentStatus: PAYMENT_STATUS.HOLD },
    { name: 'O', paymentStatus: PAYMENT_STATUS.ON_TARGET },
    { name: 'W', paymentStatus: PAYMENT_STATUS.WARNING },
  ];
  assert.deepEqual(sortNames(clients, 'paymentStatus', 'asc'), ['O', 'W', 'H']);
  assert.deepEqual(sortNames(clients, 'paymentStatus', 'desc'), ['H', 'W', 'O']);
});

test('sort by paymentStatus sentinel: unknown/missing tag ranks 99 → last ascending', () => {
  const clients = [
    { name: 'Unknown', paymentStatus: undefined },
    { name: 'Hold', paymentStatus: PAYMENT_STATUS.HOLD },
    { name: 'OnTarget', paymentStatus: PAYMENT_STATUS.ON_TARGET },
  ];
  assert.equal(getSortValue(clients[0], 'paymentStatus'), 99);
  assert.deepEqual(sortNames(clients, 'paymentStatus', 'asc'), ['OnTarget', 'Hold', 'Unknown']);
  assert.deepEqual(sortNames(clients, 'paymentStatus', 'desc'), ['Unknown', 'Hold', 'OnTarget']);
});

test('sort by avgPaymentDays: numeric, both directions', () => {
  const clients = [
    { name: 'Slow', avgPaymentDays: 45 },
    { name: 'Fast', avgPaymentDays: 8 },
    { name: 'Mid', avgPaymentDays: 20 },
  ];
  assert.deepEqual(sortNames(clients, 'avgPaymentDays', 'asc'), ['Fast', 'Mid', 'Slow']);
  assert.deepEqual(sortNames(clients, 'avgPaymentDays', 'desc'), ['Slow', 'Mid', 'Fast']);
});

test('sort by avgPaymentDays sentinel: null → -1, below 0-day payers ascending', () => {
  const clients = [
    { name: 'ZeroDay', avgPaymentDays: 0 },
    { name: 'NoInvoices', avgPaymentDays: null },
    { name: 'TenDay', avgPaymentDays: 10 },
  ];
  assert.equal(getSortValue(clients[1], 'avgPaymentDays'), -1);
  assert.deepEqual(sortNames(clients, 'avgPaymentDays', 'asc'), ['NoInvoices', 'ZeroDay', 'TenDay']);
  assert.deepEqual(sortNames(clients, 'avgPaymentDays', 'desc'), ['TenDay', 'ZeroDay', 'NoInvoices']);
});

test('sort by outstandingInvoices: numeric with 0 fallback for missing', () => {
  const clients = [
    { name: 'Two', outstandingInvoices: 2 },
    { name: 'None' }, // missing → 0
    { name: 'Five', outstandingInvoices: 5 },
  ];
  assert.deepEqual(sortNames(clients, 'outstandingInvoices', 'asc'), ['None', 'Two', 'Five']);
  assert.deepEqual(sortNames(clients, 'outstandingInvoices', 'desc'), ['Five', 'Two', 'None']);
});

test('sort by billableHours: numeric, totalHours fallback when billableHours is 0', () => {
  const clients = [
    { name: 'Big', billableHours: 40 },
    { name: 'Legacy', billableHours: 0, totalHours: 12 }, // falls back to totalHours
    { name: 'Small', billableHours: 3 },
  ];
  assert.deepEqual(sortNames(clients, 'billableHours', 'asc'), ['Small', 'Legacy', 'Big']);
  assert.deepEqual(sortNames(clients, 'billableHours', 'desc'), ['Big', 'Legacy', 'Small']);
});

test('sort by grossBillables: numeric, both directions', () => {
  const clients = [
    { name: 'Mid', grossBillables: 5000 },
    { name: 'Top', grossBillables: 12000 },
    { name: 'Zero' }, // missing → 0
  ];
  assert.deepEqual(sortNames(clients, 'grossBillables', 'asc'), ['Zero', 'Mid', 'Top']);
  assert.deepEqual(sortNames(clients, 'grossBillables', 'desc'), ['Top', 'Mid', 'Zero']);
});

test('unknown sort key falls back to billableHours ordering', () => {
  const clients = [
    { name: 'Big', billableHours: 40 },
    { name: 'Small', billableHours: 3 },
  ];
  assert.deepEqual(sortNames(clients, 'someUnknownColumn', 'asc'), ['Small', 'Big']);
  assert.deepEqual(sortNames(clients, 'someUnknownColumn', 'desc'), ['Big', 'Small']);
});

// ---------------------------------------------------------------------------
// lastActivity — string-based date sort
// ---------------------------------------------------------------------------

test('sort by lastActivity: cross-month/cross-year ISO dates order chronologically', () => {
  // lastActivity is produced as toISOString().split('T')[0] → zero-padded
  // "YYYY-MM-DD". For that format, lexicographic string comparison IS
  // chronological, including across month and year boundaries — e.g.
  // "2025-09-30" < "2025-10-01" < "2026-01-02" as strings and as dates.
  const clients = [
    { name: 'Oct1', lastActivity: '2025-10-01' },
    { name: 'Jan2', lastActivity: '2026-01-02' },
    { name: 'Sep30', lastActivity: '2025-09-30' },
    { name: 'Dec31', lastActivity: '2025-12-31' },
  ];
  assert.deepEqual(sortNames(clients, 'lastActivity', 'asc'), ['Sep30', 'Oct1', 'Dec31', 'Jan2']);
  assert.deepEqual(sortNames(clients, 'lastActivity', 'desc'), ['Jan2', 'Dec31', 'Oct1', 'Sep30']);
});

test('sort by lastActivity: DOCUMENTED LIMITATION — non-ISO date strings misorder', () => {
  // Pinning current behavior: the comparator compares raw strings, so a
  // non-zero-padded or locale format (e.g. "M/D/YYYY") would sort textually,
  // not chronologically: "10/1/2025" < "9/30/2025" because "1" < "9".
  // This is NOT hit in production today (useAnalyticsData always emits ISO
  // "YYYY-MM-DD"), but if the upstream format ever changes this sort breaks.
  // Do not "fix" without confirming the upstream format contract.
  const clients = [
    { name: 'October', lastActivity: '10/1/2025' },  // later date
    { name: 'September', lastActivity: '9/30/2025' }, // earlier date
  ];
  // Chronological asc would be ['September', 'October']; string compare gives:
  assert.deepEqual(sortNames(clients, 'lastActivity', 'asc'), ['October', 'September']);
});

test('sort by lastActivity sentinel: "No activity" → empty string, first asc / last desc', () => {
  const clients = [
    { name: 'Recent', lastActivity: '2026-07-01' },
    { name: 'Never', lastActivity: 'No activity' },
    { name: 'Old', lastActivity: '2024-02-15' },
  ];
  assert.equal(getSortValue(clients[1], 'lastActivity'), '');
  // '' sorts before any date string, so no-activity clients lead ascending
  // and trail descending.
  assert.deepEqual(sortNames(clients, 'lastActivity', 'asc'), ['Never', 'Old', 'Recent']);
  assert.deepEqual(sortNames(clients, 'lastActivity', 'desc'), ['Recent', 'Old', 'Never']);
});

// ---------------------------------------------------------------------------
// Comparator contract
// ---------------------------------------------------------------------------

test('compareClients returns 0 for ties (keeps sort stability)', () => {
  const a = { name: 'A', billableHours: 5 };
  const b = { name: 'B', billableHours: 5 };
  assert.equal(compareClients(a, b, { key: 'billableHours', direction: 'asc' }), 0);
  assert.equal(compareClients(a, b, { key: 'billableHours', direction: 'desc' }), 0);
});
