import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildPaymentAllocations,
  canFullyAllocateInvoice,
  invoiceAllocationCents,
} from '../src/utils/paymentAllocations.mjs';

test('one payment can cover several exact invoice allocations', () => {
  const allocations = buildPaymentAllocations(
    [{ id: 'p1', amount: 1000 }],
    [
      { matchedTransactionId: 'p1', amount: 400, matchedPaymentAmount: 400 },
      { matchedTransactionId: 'p1', amount: 250, matchedPaymentAmount: 250 },
    ],
  );

  assert.equal(allocations.p1.allocatedCents, 65000);
  assert.equal(allocations.p1.remainingCents, 35000);
  assert.equal(allocations.p1.invoiceCount, 2);
  assert.equal(canFullyAllocateInvoice(allocations.p1, 350), true);
  assert.equal(canFullyAllocateInvoice(allocations.p1, 350.02), false);
});

test('legacy matches allocate the invoice amount', () => {
  assert.equal(invoiceAllocationCents({ amount: 123.45 }), 12345);
  const allocation = buildPaymentAllocations(
    [{ id: 'legacy', amount: 123.45 }],
    [{ matchedTransactionId: 'legacy', amount: 123.45 }],
  ).legacy;
  assert.equal(allocation.remainingCents, 0);
  assert.equal(allocation.isFullyAllocated, true);
});

test('a payment consumed beyond its balance clamps remaining to zero and blocks more matches', () => {
  const allocation = buildPaymentAllocations(
    [{ id: 'p1', amount: 10 }],
    [
      { matchedTransactionId: 'p1', amount: 6, matchedPaymentAmount: 6 },
      { matchedTransactionId: 'p1', amount: 6, matchedPaymentAmount: 6 },
    ],
  ).p1;

  assert.equal(allocation.remainingCents, 0);
  assert.equal(allocation.isFullyAllocated, true);
  assert.equal(canFullyAllocateInvoice(allocation, 0.01), false);
});

test('a single invoice matched to a smaller deposit is an accepted under-payment', () => {
  // The Mason case: a $7177 invoice matched to a $6459.30 Mercury deposit
  // (legacy match, no matchedPaymentAmount → allocation falls back to $7177).
  // The deposit came in short of what was billed; that under-payment is assumed
  // correct — nothing remains to apply and nothing is flagged.
  const allocation = buildPaymentAllocations(
    [{ id: 'mason', amount: 6459.3 }],
    [{ matchedTransactionId: 'mason', amount: 7176.999999999997 }],
  ).mason;

  assert.equal(allocation.invoiceCount, 1);
  assert.equal(allocation.remainingCents, 0);
  assert.equal(allocation.isFullyAllocated, true);
  assert.equal('isOverAllocated' in allocation, false);
});
