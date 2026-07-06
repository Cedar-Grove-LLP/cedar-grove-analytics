import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  readPayments,
  deriveInvoicePaymentFields,
  allocatedByTransaction,
  transactionRemaining,
  PAYMENT_STATE,
} from '../src/utils/invoicePayments.mjs';

// ---- readPayments: legacy read-shim ----------------------------------------

test('readPayments synthesizes a full payment for a legacy Paid invoice', () => {
  const inv = { amount: 8000, status: 'Paid', matchedTransactionId: 't1', dateReceived: '2/2/2026' };
  assert.deepEqual(readPayments(inv), [{ transactionId: 't1', amount: 8000, date: '2/2/2026' }]);
});

test('readPayments returns [] for a legacy unpaid invoice', () => {
  assert.deepEqual(readPayments({ amount: 8000, status: '' }), []);
});

test('readPayments synthesizes a null-txn payment for a manually Paid invoice', () => {
  const inv = { amount: 500, status: 'Paid', dateReceived: '3/1/2026' };
  assert.deepEqual(readPayments(inv), [{ transactionId: null, amount: 500, date: '3/1/2026' }]);
});

test('readPayments returns a copy of an existing ledger (no mutation)', () => {
  const inv = { amount: 100, payments: [{ transactionId: 't1', amount: 100, date: '1/1/2026' }] };
  const out = readPayments(inv);
  out.push({ transactionId: 't2', amount: 1, date: '1/2/2026' });
  assert.equal(inv.payments.length, 1);
});

// ---- deriveInvoicePaymentFields --------------------------------------------

test('unpaid invoice: empty ledger derives to outstanding', () => {
  const d = deriveInvoicePaymentFields({ amount: 3500, payments: [] });
  assert.equal(d.amountPaid, 0);
  assert.equal(d.balance, 3500);
  assert.equal(d.isPaid, false);
  assert.equal(d.paymentState, PAYMENT_STATE.UNPAID);
  assert.equal(d.status, '');
  assert.equal(d.dateReceived, null);
  assert.equal(d.matchedTransactionId, null);
});

test('partial payment: one of two installments', () => {
  const d = deriveInvoicePaymentFields({
    amount: 10000,
    payments: [{ transactionId: 't1', amount: 4000, date: '3/5/2026' }],
  });
  assert.equal(d.amountPaid, 4000);
  assert.equal(d.balance, 6000);
  assert.equal(d.isPaid, false);
  assert.equal(d.paymentState, PAYMENT_STATE.PARTIAL);
  assert.equal(d.status, ''); // outstanding until fully paid
  assert.equal(d.dateReceived, null);
  // still exposes a txn id while being paid off (for the paid-as tag)
  assert.equal(d.matchedTransactionId, 't1');
});

test('two payments settle the invoice; dateReceived is the latest date', () => {
  const d = deriveInvoicePaymentFields({
    amount: 10000,
    payments: [
      { transactionId: 't1', amount: 4000, date: '3/5/2026' },
      { transactionId: 't2', amount: 6000, date: '4/10/2026' },
    ],
  });
  assert.equal(d.amountPaid, 10000);
  assert.equal(d.balance, 0);
  assert.equal(d.isPaid, true);
  assert.equal(d.paymentState, PAYMENT_STATE.PAID);
  assert.equal(d.status, 'Paid');
  assert.equal(d.dateReceived, '4/10/2026'); // settling (latest) payment
  assert.equal(d.matchedTransactionId, 't2'); // settling payment's txn
});

test('over-application yields a negative balance but still Paid', () => {
  const d = deriveInvoicePaymentFields({
    amount: 1000,
    payments: [{ transactionId: 't1', amount: 1200, date: '1/1/2026' }],
  });
  assert.equal(d.balance, -200);
  assert.equal(d.isPaid, true);
  assert.equal(d.status, 'Paid');
});

test('float amounts round to cents (no 0.30000000000000004)', () => {
  const d = deriveInvoicePaymentFields({
    amount: 0.3,
    payments: [
      { transactionId: 't1', amount: 0.1, date: '1/1/2026' },
      { transactionId: 't2', amount: 0.2, date: '1/2/2026' },
    ],
  });
  assert.equal(d.amountPaid, 0.3);
  assert.equal(d.balance, 0);
  assert.equal(d.isPaid, true);
});

test('legacy Paid invoice derives identically through the shim', () => {
  const d = deriveInvoicePaymentFields({
    amount: 8000, status: 'Paid', matchedTransactionId: 't1', dateReceived: '2/2/2026',
  });
  assert.equal(d.amountPaid, 8000);
  assert.equal(d.balance, 0);
  assert.equal(d.isPaid, true);
  assert.equal(d.dateReceived, '2/2/2026');
  assert.equal(d.matchedTransactionId, 't1');
});

// ---- allocation across invoices (split payments) ---------------------------

test('allocatedByTransaction sums a split payment across invoices', () => {
  const invoices = [
    { amount: 5000, payments: [{ transactionId: 'dep', amount: 5000, date: '4/1/2026' }] },
    { amount: 6000, payments: [{ transactionId: 'dep', amount: 4000, date: '4/1/2026' }] },
    { amount: 2000, payments: [{ transactionId: 'other', amount: 2000, date: '4/1/2026' }] },
  ];
  const alloc = allocatedByTransaction(invoices);
  assert.equal(alloc.get('dep'), 9000);
  assert.equal(alloc.get('other'), 2000);
});

test('allocatedByTransaction ignores manual (null-txn) payments', () => {
  const invoices = [{ amount: 500, payments: [{ transactionId: null, amount: 500, date: '1/1/2026' }] }];
  assert.equal(allocatedByTransaction(invoices).size, 0);
});

test('transactionRemaining reflects unallocated amount of a split deposit', () => {
  const invoices = [
    { amount: 5000, payments: [{ transactionId: 'dep', amount: 5000, date: '4/1/2026' }] },
  ];
  const alloc = allocatedByTransaction(invoices);
  assert.equal(transactionRemaining('dep', 15000, alloc), 10000);
  assert.equal(transactionRemaining('unused', 15000, alloc), 15000);
});
