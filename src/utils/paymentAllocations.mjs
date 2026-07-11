// A leftover balance below this is rounding noise, not a real overpayment or an
// amount worth matching elsewhere. Payments whose remaining is under $1 are
// treated as fully matched — never surfaced as "Overpaid" or as unmatched.
export const MIN_REMAINING_CENTS = 100;

/** Convert a currency value to integer cents. Invalid values become zero. */
export function toCents(value) {
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

/**
 * The explicit allocation is used for new matches. Older matches predate that
 * field, so their invoice total remains the allocation for compatibility.
 */
export function invoiceAllocationCents(invoice) {
  const explicit = invoice?.matchedPaymentAmount;
  if (Number.isFinite(explicit)) return Math.max(toCents(explicit), 0);
  return Math.max(toCents(invoice?.amount), 0);
}

/** Summarize how invoice allocations consume each incoming payment. */
export function buildPaymentAllocations(transactions = [], invoices = []) {
  const result = {};

  for (const transaction of transactions) {
    const paymentCents = Math.max(toCents(transaction?.amount), 0);
    result[transaction.id] = {
      paymentCents,
      allocatedCents: 0,
      remainingCents: paymentCents,
      invoiceCount: 0,
      isFullyAllocated: paymentCents === 0,
    };
  }

  for (const invoice of invoices) {
    const transactionId = invoice?.matchedTransactionId;
    if (!transactionId || !result[transactionId]) continue;
    result[transactionId].allocatedCents += invoiceAllocationCents(invoice);
    result[transactionId].invoiceCount += 1;
  }

  for (const allocation of Object.values(result)) {
    const rawRemaining = allocation.paymentCents - allocation.allocatedCents;
    // Clamp remaining at zero. A payment matched below the invoice total (a
    // deposit that came in short of what was billed) simply has nothing left to
    // apply — that under-payment is assumed correct and is never flagged.
    allocation.remainingCents = Math.max(rawRemaining, 0);
    allocation.isFullyAllocated = rawRemaining <= 0;
  }

  return result;
}

export function canFullyAllocateInvoice(allocation, invoiceAmount) {
  if (!allocation) return false;
  const neededCents = Math.max(toCents(invoiceAmount), 0);
  return neededCents > 0 && allocation.remainingCents >= neededCents;
}

export function centsToAmount(cents) {
  return cents / 100;
}
