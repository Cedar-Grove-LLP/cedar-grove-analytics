/**
 * Invoice payment ledger — partial and split payments.
 *
 * An invoice entry gains a `payments[]` array, each element applying a dollar
 * amount to THIS invoice from one Mercury transaction (or a manual payment):
 *
 *   payments: [{ transactionId: string|null, amount: number, date: string }]
 *
 * Everything the rest of the app already reads — `status` ("Paid"/""),
 * `dateReceived`, `matchedTransactionId` — is DERIVED from that ledger and
 * written back onto the entry, so the payment-status tag engine, billing
 * KPIs, client views, and the Apps Script write-back keep working unchanged.
 *
 * A single transaction can appear on several invoices' ledgers (a split
 * payment covering multiple invoices); a single invoice can have several
 * payments (a partial payment paid off over time). Allocation across invoices
 * is derived by summing every ledger that references a given transaction id.
 *
 * Pure module — no React/Firebase imports; Node-importable and covered by
 * tests/invoice-payments.test.mjs.
 */

import { parseInvoiceDate } from './paymentStatus.mjs';

/** Currency comparison tolerance (half a cent) for balance/paid checks. */
export const PAYMENT_EPSILON = 0.005;

/** UI payment states. `status` stays "Paid"/"" for back-compat; this is richer. */
export const PAYMENT_STATE = Object.freeze({
  PAID: 'paid',
  PARTIAL: 'partial',
  UNPAID: 'unpaid',
});

/** Round a currency figure to cents, stripping float artifacts. */
function roundCents(n) {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * Read an invoice's payment ledger, synthesizing one for legacy invoices that
 * predate the ledger. A legacy invoice marked Paid becomes a single payment
 * for its full amount (using its matchedTransactionId + dateReceived); an
 * unpaid legacy invoice has an empty ledger. Returns a fresh array.
 */
export function readPayments(inv) {
  if (!inv) return [];
  if (Array.isArray(inv.payments)) return inv.payments.slice();
  if (inv.status === 'Paid') {
    return [{
      transactionId: inv.matchedTransactionId != null ? inv.matchedTransactionId : null,
      amount: typeof inv.amount === 'number' ? inv.amount : 0,
      date: inv.dateReceived || null,
    }];
  }
  return [];
}

/**
 * Pick the settling payment — the one whose date is latest, i.e. when the
 * invoice actually finished being paid. Used to derive dateReceived (for
 * days-to-pay) and the back-compat matchedTransactionId. Falls back to the
 * last payment in insertion order when dates are missing/unparseable.
 */
function settlingPayment(payments, fallbackYear) {
  if (payments.length === 0) return null;
  let best = null;
  let bestTs = -Infinity;
  for (const p of payments) {
    const d = parseInvoiceDate(p.date, fallbackYear);
    const ts = d ? d.getTime() : -Infinity;
    if (ts >= bestTs) { bestTs = ts; best = p; }
  }
  return best || payments[payments.length - 1];
}

/**
 * Derive the payment fields for one invoice entry from its ledger.
 *
 * @returns {{
 *   payments: Array, amountPaid: number, balance: number, isPaid: boolean,
 *   paymentState: string, status: string, dateReceived: (string|null),
 *   matchedTransactionId: (string|null)
 * }}
 * `status`/`dateReceived`/`matchedTransactionId` are the back-compat fields to
 * persist alongside `payments`. `balance` may go negative if over-applied
 * (the UI caps input to prevent this, but the math stays honest).
 */
export function deriveInvoicePaymentFields(inv) {
  const payments = readPayments(inv);
  const amount = typeof inv?.amount === 'number' ? inv.amount : 0;
  const amountPaid = roundCents(
    payments.reduce((sum, p) => sum + (typeof p.amount === 'number' ? p.amount : 0), 0)
  );
  const balance = roundCents(amount - amountPaid);
  const isPaid = amountPaid > PAYMENT_EPSILON && balance <= PAYMENT_EPSILON;

  let paymentState;
  if (isPaid) paymentState = PAYMENT_STATE.PAID;
  else if (amountPaid > PAYMENT_EPSILON) paymentState = PAYMENT_STATE.PARTIAL;
  else paymentState = PAYMENT_STATE.UNPAID;

  const settling = isPaid ? settlingPayment(payments, inv?.year) : null;

  // matchedTransactionId: the settling payment's txn when paid; otherwise the
  // most recent payment that carries a transaction id (keeps write-back and
  // the paid-as tag working while an invoice is still being paid off).
  let matchedTransactionId = null;
  if (settling && settling.transactionId != null) {
    matchedTransactionId = settling.transactionId;
  } else {
    const withTxn = settlingPayment(
      payments.filter((p) => p.transactionId != null),
      inv?.year
    );
    matchedTransactionId = withTxn ? withTxn.transactionId : null;
  }

  return {
    payments,
    amountPaid,
    balance,
    isPaid,
    paymentState,
    status: isPaid ? 'Paid' : '',
    dateReceived: isPaid && settling ? settling.date || null : null,
    matchedTransactionId,
  };
}

/**
 * Sum how much of each transaction has been applied across ALL invoices.
 * @param {Array} invoices every invoices/all entry
 * @returns {Map<string, number>} transactionId → total applied (rounded cents)
 */
export function allocatedByTransaction(invoices) {
  const map = new Map();
  (invoices || []).forEach((inv) => {
    readPayments(inv).forEach((p) => {
      if (p.transactionId == null) return;
      const amt = typeof p.amount === 'number' ? p.amount : 0;
      map.set(p.transactionId, roundCents((map.get(p.transactionId) || 0) + amt));
    });
  });
  return map;
}

/**
 * Amount of a transaction still available to allocate to invoices.
 * @param {string} transactionId
 * @param {number} transactionAmount the Mercury transaction's full amount
 * @param {Map<string, number>} allocatedMap from allocatedByTransaction()
 */
export function transactionRemaining(transactionId, transactionAmount, allocatedMap) {
  const amount = typeof transactionAmount === 'number' ? transactionAmount : 0;
  const allocated = (allocatedMap && allocatedMap.get(transactionId)) || 0;
  return roundCents(amount - allocated);
}
