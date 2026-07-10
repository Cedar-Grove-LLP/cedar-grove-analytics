import { toCents } from './paymentAllocations.mjs';

/**
 * Canonicalize identity without making it fuzzy. Punctuation, casing, and
 * repeated whitespace are ignored; meaningful words (including legal suffixes)
 * are retained so unrelated businesses do not become equivalent.
 */
export function normalizePaymentIdentity(value) {
  return String(value || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Build client -> counterparty identities from previously persisted matches. */
export function buildHistoricalPaidAs(invoices = [], transactions = []) {
  const txnById = new Map(transactions.map((txn) => [txn.id, txn]));
  const result = {};

  for (const invoice of invoices) {
    const client = normalizePaymentIdentity(invoice?.client);
    const counterparty = normalizePaymentIdentity(
      txnById.get(invoice?.matchedTransactionId)?.counterpartyName
    );
    if (!client || !counterparty || client === counterparty) continue;
    if (!result[client]) result[client] = new Set();
    result[client].add(counterparty);
  }

  return result;
}

function aliasMatchesClient(aliases, client, counterparty) {
  for (const [aliasName, clients] of Object.entries(aliases || {})) {
    if (normalizePaymentIdentity(aliasName) !== counterparty) continue;
    if ((clients || []).some((name) => normalizePaymentIdentity(name) === client)) return true;
  }
  return false;
}

/**
 * Return a single strong recommendation, an ambiguity warning, or no match.
 * A strong match always requires exact available cents plus a trusted identity.
 */
export function recommendPaymentForInvoice({
  invoice,
  transactions = [],
  allocations = {},
  aliases = {},
  historicalPaidAs = {},
} = {}) {
  const client = normalizePaymentIdentity(invoice?.client);
  const invoiceCents = toCents(invoice?.amount);
  if (!client || invoiceCents <= 0 || invoice?.status === 'Paid') {
    return { status: 'none', candidates: [] };
  }

  const strong = [];
  for (const transaction of transactions) {
    const allocation = allocations[transaction.id];
    if (!allocation || allocation.isOverAllocated || allocation.remainingCents !== invoiceCents) continue;

    const counterparty = normalizePaymentIdentity(transaction?.counterpartyName);
    if (!counterparty) continue;
    const paidAs = aliasMatchesClient(aliases, client, counterparty)
      || historicalPaidAs[client]?.has(counterparty);
    const exactName = counterparty === client;
    if (!paidAs && !exactName) continue;

    strong.push({
      transaction,
      transactionId: transaction.id,
      matchType: paidAs ? 'paid-as' : 'exact-name',
      priority: paidAs ? 0 : 1,
      allocation,
    });
  }

  if (strong.length === 0) return { status: 'none', candidates: [] };
  const bestPriority = Math.min(...strong.map((candidate) => candidate.priority));
  const best = strong.filter((candidate) => candidate.priority === bestPriority);
  if (best.length > 1) return { status: 'ambiguous', candidates: best };
  return { status: 'recommended', candidate: best[0], candidates: best };
}
