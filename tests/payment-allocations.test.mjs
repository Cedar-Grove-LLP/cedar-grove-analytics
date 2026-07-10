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

test('explicit allocations are cents-safe and over-allocation blocks matches', () => {
  const allocation = buildPaymentAllocations(
    [{ id: 'p1', amount: 0.3 }],
    [
      { matchedTransactionId: 'p1', amount: 0.1, matchedPaymentAmount: 0.1 },
      { matchedTransactionId: 'p1', amount: 0.22, matchedPaymentAmount: 0.22 },
    ],
  ).p1;

  assert.equal(allocation.isOverAllocated, true);
  assert.equal(allocation.overAllocatedCents, 2);
  assert.equal(allocation.remainingCents, 0);
  assert.equal(canFullyAllocateInvoice(allocation, 0.01), false);
});
