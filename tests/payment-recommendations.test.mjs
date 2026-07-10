import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPaymentAllocations } from '../src/utils/paymentAllocations.mjs';
import {
  buildHistoricalPaidAs,
  normalizePaymentIdentity,
  recommendPaymentForInvoice,
} from '../src/utils/paymentRecommendations.mjs';

const invoice = (overrides = {}) => ({ client: 'Acme, Inc.', amount: 100, status: '', ...overrides });
const payment = (id, name, amount = 100) => ({ id, counterpartyName: name, amount });

function recommendation(inv, transactions, { aliases = {}, matchedInvoices = [] } = {}) {
  return recommendPaymentForInvoice({
    invoice: inv,
    transactions,
    allocations: buildPaymentAllocations(transactions, matchedInvoices),
    aliases,
    historicalPaidAs: buildHistoricalPaidAs(matchedInvoices, transactions),
  });
}

test('normalization ignores punctuation and casing without fuzzy token matching', () => {
  assert.equal(normalizePaymentIdentity(' ACME, Inc. '), 'acme inc');
  assert.notEqual(normalizePaymentIdentity('Acme Holdings'), normalizePaymentIdentity('Acme, Inc.'));
});

test('recommends exact normalized client name plus exact amount', () => {
  const result = recommendation(invoice(), [payment('p1', 'ACME INC')]);
  assert.equal(result.status, 'recommended');
  assert.equal(result.candidate.transactionId, 'p1');
  assert.equal(result.candidate.matchType, 'exact-name');
});

test('recommends persisted alias plus exact amount', () => {
  const result = recommendation(invoice(), [payment('p1', 'Founder Holdings')], {
    aliases: { 'founder holdings': ['Acme, Inc.'] },
  });
  assert.equal(result.status, 'recommended');
  assert.equal(result.candidate.matchType, 'paid-as');
});

test('recommends a counterparty learned from previous matched history', () => {
  const transactions = [payment('old', 'Founder Holdings', 50), payment('new', 'Founder Holdings')];
  const result = recommendation(invoice(), transactions, {
    matchedInvoices: [invoice({ amount: 50, status: 'Paid', matchedTransactionId: 'old' })],
  });
  assert.equal(result.status, 'recommended');
  assert.equal(result.candidate.transactionId, 'new');
  assert.equal(result.candidate.matchType, 'paid-as');
});

test('rejects amount-only and fuzzy token-only matches', () => {
  assert.equal(recommendation(invoice(), [payment('p1', 'Unrelated Client')]).status, 'none');
  assert.equal(recommendation(invoice(), [payment('p2', 'Acme Holdings')]).status, 'none');
});

test('does not choose between equally strong payments', () => {
  const result = recommendation(invoice(), [payment('p1', 'Acme Inc.'), payment('p2', 'ACME, INC')]);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.candidates.length, 2);
});

test('accepts an exact partially allocated remaining balance', () => {
  const transactions = [payment('p1', 'Acme, Inc.', 150)];
  const result = recommendation(invoice(), transactions, {
    matchedInvoices: [invoice({ client: 'Other', amount: 50, status: 'Paid', matchedTransactionId: 'p1' })],
  });
  assert.equal(result.status, 'recommended');
  assert.equal(result.candidate.allocation.remainingCents, 10000);
});

test('rejects insufficient and overallocated payments', () => {
  assert.equal(recommendation(invoice(), [payment('small', 'Acme, Inc.', 99.99)]).status, 'none');
  const transactions = [payment('over', 'Acme, Inc.', 90)];
  const result = recommendation(invoice(), transactions, {
    matchedInvoices: [invoice({ amount: 100, status: 'Paid', matchedTransactionId: 'over' })],
  });
  assert.equal(result.status, 'none');
});
