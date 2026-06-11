import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAYMENT_STATUS,
  PAYMENT_STATUS_LABEL,
  PAYMENT_STATUS_RANK,
  HOLD_FLAG_MESSAGE,
  NO_INVOICE_STATUS,
  DEFAULT_PAYMENT_TERMS,
  parseInvoiceDate,
  computeClientPaymentStatus,
  buildPaymentStatusIndex,
  getClientPaymentStatus,
  getPaymentStatusBadge,
} from '../src/utils/paymentStatus.mjs';

const { ON_TARGET, WARNING, HOLD } = PAYMENT_STATUS;

// Minimal invoice row matching the `invoices/all` entry shape.
const inv = (dateSent, dateReceived = null, over = {}) => ({
  client: 'Acme, Inc.',
  amount: 1000,
  year: 2026,
  dateSent,
  dateReceived,
  status: dateReceived ? 'Paid' : 'Not Paid',
  ...over,
});

const at = (str) => new Date(str); // local-time test clock

// ---------------------------------------------------------------- parsing

test('parseInvoiceDate handles M/D/YYYY, M/D + fallback year, timestamps, junk', () => {
  assert.deepEqual(parseInvoiceDate('1/6/2026'), new Date(2026, 0, 6));
  assert.deepEqual(parseInvoiceDate('12/3', 2025), new Date(2025, 11, 3));
  assert.deepEqual(parseInvoiceDate({ seconds: 86400 }), new Date(86400000));
  assert.equal(parseInvoiceDate('', 2026), null);
  assert.equal(parseInvoiceDate('garbage'), null);
});

// ----------------------------------------------------------- tag criteria

test('On Target: avg ≤ 15d, ≥90% within 15d, 0 outstanding', () => {
  const r = computeClientPaymentStatus([
    inv('1/1/2026', '1/8/2026'),
    inv('2/1/2026', '2/8/2026'),
    inv('3/1/2026', '3/9/2026'),
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.status, ON_TARGET);
  assert.equal(r.holdFlag, false);
  assert.ok(r.avgDays <= 15);
  assert.equal(r.outstandingCount, 0);
});

test('no invoice history reads as On Target (no payment issues on record)', () => {
  const r = computeClientPaymentStatus([], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.status, ON_TARGET);
  assert.equal(getClientPaymentStatus(new Map(), 'Nobody LLC'), NO_INVOICE_STATUS);
});

test('fast avg but <90% paid within 15d misses the On Target bar → Warning', () => {
  const rows = [];
  for (let d = 1; d <= 8; d++) rows.push(inv(`1/${d}/2026`, `1/${d + 5}/2026`)); // 8 × 5 days
  rows.push(inv('2/1/2026', '2/21/2026')); // 20 days
  rows.push(inv('2/2/2026', '2/22/2026')); // 20 days
  const r = computeClientPaymentStatus(rows, { today: at('2026-06-11T12:00:00') });
  assert.ok(r.avgDays <= 15, `avg ${r.avgDays}`);
  assert.equal(r.status, WARNING);
});

test('a single outstanding invoice breaks the 0-outstanding On Target rule → Warning', () => {
  const r = computeClientPaymentStatus([
    inv('1/1/2026', '1/8/2026'),
    inv('6/8/2026'), // fresh, unpaid
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.status, WARNING);
  assert.equal(r.outstandingCount, 1);
});

test('Warning: avg payment 22–30 days', () => {
  const r = computeClientPaymentStatus([
    inv('1/1/2026', '1/26/2026'),
    inv('2/1/2026', '2/26/2026'),
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(Math.round(r.avgDays), 25);
  assert.equal(r.status, WARNING);
});

test('Warning: 2 unpaid invoices accumulated (incl. Payment Initiated)', () => {
  const r = computeClientPaymentStatus([
    inv('6/6/2026'),
    inv('6/8/2026', null, { status: 'Payment Initiated' }),
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.outstandingCount, 2);
  assert.equal(r.overdueCount, 0);
  assert.equal(r.status, WARNING);
});

test('Warning: 1 invoice 21+ days past terms', () => {
  // Sent Apr 20, net 30 → due May 20 → ~22 days overdue on Jun 11.
  const r = computeClientPaymentStatus([inv('4/20/2026')], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.overdueCount, 1);
  assert.equal(r.status, WARNING);
});

test('Hold: 1 invoice 30+ days past terms', () => {
  // Sent Apr 1, net 30 → due May 1 → ~41 days overdue on Jun 11.
  const r = computeClientPaymentStatus([inv('4/1/2026')], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.status, HOLD);
  assert.equal(r.holdFlag, true);
});

test('Hold: 2+ invoices overdue at the same time', () => {
  const r = computeClientPaymentStatus([
    inv('4/25/2026'),
    inv('4/28/2026'),
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.overdueCount, 2);
  assert.equal(r.status, HOLD);
});

test('Hold: avg payment > 30 days', () => {
  const r = computeClientPaymentStatus([
    inv('1/1/2026', '2/5/2026'),
    inv('2/1/2026', '3/8/2026'),
  ], { today: at('2026-06-11T12:00:00') });
  assert.equal(r.avgDays, 35);
  assert.equal(r.status, HOLD);
});

test('client payment terms move the overdue boundary (15 vs 30)', () => {
  const rows = [inv('4/25/2026')]; // ~47 days since sent on Jun 11
  const today = at('2026-06-11T12:00:00');
  // Net 15 → ~32 days overdue → Hold; net 30 → ~17 days overdue → Warning.
  assert.equal(computeClientPaymentStatus(rows, { today, paymentTerms: 15 }).status, HOLD);
  assert.equal(computeClientPaymentStatus(rows, { today, paymentTerms: 30 }).status, WARNING);
  assert.equal(DEFAULT_PAYMENT_TERMS, 30);
});

test('explicit 0-day terms (due on receipt) are honored, not treated as missing', () => {
  // Sent May 7, unpaid, ~35 days outstanding on Jun 11: due-on-receipt terms
  // make it 30+ days overdue → Hold; the default net 30 would say ~5 days
  // overdue → Warning. null/undefined still fall back to the default.
  const rows = [inv('5/7/2026')];
  const today = at('2026-06-11T12:00:00');
  assert.equal(computeClientPaymentStatus(rows, { today, paymentTerms: 0 }).status, HOLD);
  assert.equal(computeClientPaymentStatus(rows, { today, paymentTerms: null }).status, WARNING);
  const index = buildPaymentStatusIndex(rows, [{ clientName: 'Acme, Inc.', paymentTerms: 0 }], today);
  assert.equal(getClientPaymentStatus(index, 'Acme, Inc.').status, HOLD);
});

// ------------------------------------------------- Hold-exit hysteresis

// 20 fast invoices in 2025, then two Jan-2026 invoices that both go overdue
// (Hold in Feb) and are paid at 70 days in March. Afterwards the memory-less
// metrics are On Target again (avg ≈ 10.9d, 91% within 15d, zero balance),
// which exercises the sticky-Hold release path.
const holdHistory = () => {
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(inv('6/1/2025', '6/6/2025', { year: 2025 }));
  rows.push(inv('1/1/2026', '3/12/2026')); // 70 days
  rows.push(inv('1/5/2026', '3/16/2026')); // 70 days
  return rows;
};

test('Hold is sticky: raw metrics back to On Target but only 1 clean cycle served', () => {
  // As of Apr 10 the balance is zero and March was clean, but only one
  // completed clean cycle has passed → still Hold.
  const r = computeClientPaymentStatus(holdHistory(), { today: at('2026-04-10T12:00:00') });
  assert.equal(r.status, HOLD);
  assert.equal(r.outstandingCount, 0);
});

test('exit from Hold steps down to Warning, never straight to On Target', () => {
  // March + April both clean with zero balance → released at April month end,
  // but the client surfaces as Warning even though today’s raw tag is On Target.
  const r = computeClientPaymentStatus(holdHistory(), { today: at('2026-05-10T12:00:00') });
  assert.equal(r.status, WARNING);
});

test('a later clean cycle promotes the released client to On Target', () => {
  const r = computeClientPaymentStatus(holdHistory(), { today: at('2026-06-11T12:00:00') });
  assert.equal(r.status, ON_TARGET);
});

test('release from Hold requires a zero balance, not just clean cycles', () => {
  // Same history plus a fresh open invoice across the would-be release cycle:
  // April ends clean (not overdue) but the balance is not zero → still Hold.
  const rows = [...holdHistory(), inv('4/20/2026')];
  const r = computeClientPaymentStatus(rows, { today: at('2026-05-10T12:00:00') });
  assert.equal(r.status, HOLD);
});

// ------------------------------------------------------- index + display

test('buildPaymentStatusIndex groups by client, normalizes names, applies terms', () => {
  const entries = [
    inv('1/1/2026', '1/8/2026', { client: '  Acme, Inc. ' }),
    inv('4/25/2026', null, { client: 'slowpay llc' }),
  ];
  const clients = [
    { clientName: 'Acme, Inc.', paymentTerms: 30 },
    { clientName: 'SlowPay LLC', paymentTerms: 15 },
  ];
  const index = buildPaymentStatusIndex(entries, clients, at('2026-06-11T12:00:00'));
  assert.equal(getClientPaymentStatus(index, 'acme, inc.').status, ON_TARGET);
  assert.equal(getClientPaymentStatus(index, 'SlowPay LLC').status, HOLD); // net 15 → 30+ days overdue
  assert.equal(getClientPaymentStatus(index, 'Unknown Co'), NO_INVOICE_STATUS);
});

test('name matching survives punctuation/spacing drift between the two sheets', () => {
  // The invoice sheet says "Acme Inc" while the client record says
  // "Acme, Inc." — a strict-equality miss would silently read On Target.
  const entries = [inv('4/1/2026', null, { client: 'Acme Inc' })]; // 30+ days overdue
  const clients = [{ clientName: 'Acme, Inc.', paymentTerms: 30 }];
  const index = buildPaymentStatusIndex(entries, clients, at('2026-06-11T12:00:00'));
  assert.equal(getClientPaymentStatus(index, 'Acme, Inc.').status, HOLD);
  assert.equal(getClientPaymentStatus(index, 'ACME—Inc').status, HOLD);
});

test('labels, ranks, badges, and the Hold flag are wired for all three tags', () => {
  assert.deepEqual(Object.keys(PAYMENT_STATUS_LABEL).sort(), [ON_TARGET, HOLD, WARNING].sort());
  assert.equal(PAYMENT_STATUS_RANK[ON_TARGET], 0);
  assert.equal(PAYMENT_STATUS_RANK[HOLD], 2);
  assert.ok(HOLD_FLAG_MESSAGE.includes('partner approval'));
  for (const s of [ON_TARGET, WARNING, HOLD]) {
    assert.ok(getPaymentStatusBadge(s).includes('bg-status-'), s);
  }
  assert.ok(getPaymentStatusBadge('nope').includes('bg-gray-100'));
});
