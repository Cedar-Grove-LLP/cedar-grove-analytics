import { MIN_REMAINING_CENTS, toCents } from './paymentAllocations.mjs';

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
    if (!allocation || allocation.remainingCents !== invoiceCents) continue;

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

/**
 * The inverse view: for one incoming payment, list the outstanding invoices it
 * could settle. A candidate needs SOME signal — a trusted identity tie
 * (exact/paid-as name) or an exact amount fit — and must fit within the
 * payment's remaining balance. Ranked: identity + exact amount, then identity,
 * then exact amount alone; ties break toward the larger invoice.
 */
export function recommendInvoicesForPayment({
  payment,
  invoices = [],
  allocation,
  aliases = {},
  historicalPaidAs = {},
} = {}) {
  const remainingCents = allocation?.remainingCents ?? 0;
  if (remainingCents < MIN_REMAINING_CENTS) return [];

  const counterparty = normalizePaymentIdentity(payment?.counterpartyName);
  const candidates = [];

  for (const invoice of invoices) {
    if (invoice?.status === 'Paid' || invoice?.matchedTransactionId) continue;
    const invoiceCents = toCents(invoice?.amount);
    if (invoiceCents <= 0 || invoiceCents > remainingCents) continue;

    const client = normalizePaymentIdentity(invoice?.client);
    if (!client) continue;

    const paidAs = !!counterparty
      && (aliasMatchesClient(aliases, client, counterparty)
        || !!historicalPaidAs[client]?.has(counterparty));
    const exactName = !!counterparty && counterparty === client;
    const hasIdentity = paidAs || exactName;
    const exactAmount = invoiceCents === remainingCents;
    if (!hasIdentity && !exactAmount) continue;

    const matchType = exactName ? 'exact-name' : paidAs ? 'paid-as' : 'amount';
    const priority = hasIdentity && exactAmount ? 0 : hasIdentity ? 1 : 2;
    candidates.push({ invoice, invoiceCents, exactAmount, matchType, priority });
  }

  candidates.sort((a, b) => a.priority - b.priority || b.invoiceCents - a.invoiceCents);
  return candidates;
}
