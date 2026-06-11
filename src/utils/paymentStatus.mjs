/**
 * Client Payment Status — On Target / Warning / Hold.
 *
 * Replaces the manual Ideal / Non-Ideal / TBD ideal-fit tags. Payment tags
 * are CALCULATED, never set by hand: they derive entirely from the invoice
 * rows synced from the org's Invoices workbook → "Payment Status" tab into
 * the `invoices/all` Firestore doc (the source of truth), so they refresh
 * automatically whenever that sheet re-syncs.
 *
 * Two variables drive the tag: average payment time (days from dateSent to
 * dateReceived, over paid invoices) and outstanding invoices (sent but not
 * received). "Overdue" is measured against the client's payment terms
 * (15/30 from the client record, default 30):
 *   daysOverdue = days since sent − payment terms.
 *
 *   On Target  avg payment ≤ 15d AND ≥90% of paid invoices within 15d
 *              AND 0 outstanding invoices
 *   Hold       2+ invoices overdue at the same time, OR 1 invoice 30+ days
 *              overdue, OR avg payment > 30d — displays the
 *              "No new matters without partner approval" flag
 *   Warning    avg payment 22–30d, OR 1 invoice 21+ days overdue, OR 2
 *              unpaid invoices accumulated. Every Warning criterion already
 *              fails the On Target bar (which demands a clean slate), so
 *              Warning is implemented as the middle catch-all: anything
 *              that is neither On Target nor Hold. The three tags therefore
 *              always cover the whole client book.
 *
 * Coming out of Hold is sticky. The invoice history is replayed cycle by
 * cycle (a billing cycle = a calendar month), and a client leaves Hold only
 * after reaching a zero balance plus 2 consecutive clean cycles (no invoice
 * overdue at cycle end) — and steps down to Warning first, never straight
 * to On Target. Promotion to On Target can then happen on a later cycle.
 *
 * Pure module — no React/Firebase imports; Node-importable and covered by
 * tests/payment-status.test.mjs.
 */

const DAY_MS = 86400000;

/** Net payment terms (days) assumed when the client record has none. */
export const DEFAULT_PAYMENT_TERMS = 30;

export const PAYMENT_STATUS = Object.freeze({
  ON_TARGET: 'on-target',
  WARNING: 'warning',
  HOLD: 'hold',
});

export const PAYMENT_STATUS_LABEL = Object.freeze({
  'on-target': 'On Target',
  warning: 'Warning',
  hold: 'Hold',
});

// Sort/group order — healthy payers first, holds last.
export const PAYMENT_STATUS_RANK = Object.freeze({
  'on-target': 0,
  warning: 1,
  hold: 2,
});

/** Operational flag shown wherever a Hold tag is displayed. */
export const HOLD_FLAG_MESSAGE = 'No new matters without partner approval';

/**
 * Parse an invoice date from the synced sheet. Mirrors parseDateSent in
 * AdminInvoices.jsx — supports M/D (resolved against fallbackYear),
 * M/D/YYYY, Firestore Timestamp objects, and verbose Date.toString() output.
 */
export function parseInvoiceDate(value, fallbackYear) {
  if (!value) return null;
  if (typeof value === 'object' && value.seconds) return new Date(value.seconds * 1000);
  const str = String(value).trim();
  const parts = str.split('/');
  if (parts.length === 3) return new Date(parseInt(parts[2]), parseInt(parts[0]) - 1, parseInt(parts[1]));
  if (parts.length === 2 && fallbackYear) return new Date(fallbackYear, parseInt(parts[0]) - 1, parseInt(parts[1]));
  const d = new Date(str);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalize a raw `invoices/all` entry: resolve sent/received dates and
 * days-to-pay. Entries with no parseable sent date are unusable for status
 * math and are dropped by the callers below.
 */
export function normalizeInvoice(inv) {
  const sent = parseInvoiceDate(inv.dateSent, inv.year);
  const received = parseInvoiceDate(inv.dateReceived, inv.year);
  const isPaid = inv.status === 'Paid';
  const daysToPay = sent && received
    ? Math.max(0, Math.round((received.getTime() - sent.getTime()) / DAY_MS))
    : null;
  return { ...inv, sent, received, isPaid, daysToPay };
}

/**
 * Payment metrics for one client's normalized invoices as of a moment in
 * time. Used both for the current tag and for the historical Hold replay.
 */
export function paymentMetricsAsOf(invoices, asOf, paymentTerms = DEFAULT_PAYMENT_TERMS) {
  const t = asOf.getTime();
  const paid = [];
  const open = [];

  invoices.forEach((inv) => {
    if (!inv.sent || inv.sent.getTime() > t) return; // not yet sent as of t
    const receivedTs = inv.received ? inv.received.getTime() : null;
    if (receivedTs !== null && receivedTs <= t) paid.push(inv);
    else if (receivedTs !== null) open.push(inv); // paid, but after t — open as of t
    else if (!inv.isPaid) open.push(inv);
    // Marked Paid with no received date: closed, but unusable for avg time.
  });

  const withDays = paid.filter((i) => i.daysToPay !== null);
  const avgDays = withDays.length
    ? withDays.reduce((s, i) => s + i.daysToPay, 0) / withDays.length
    : null;
  const pctWithin15 = withDays.length
    ? withDays.filter((i) => i.daysToPay <= 15).length / withDays.length
    : null;

  let overdueCount = 0;
  let maxDaysOverdue = 0;
  open.forEach((inv) => {
    const daysOverdue = Math.floor((t - inv.sent.getTime()) / DAY_MS) - paymentTerms;
    if (daysOverdue > 0) overdueCount += 1;
    if (daysOverdue > maxDaysOverdue) maxDaysOverdue = daysOverdue;
  });

  return {
    avgDays,
    pctWithin15,
    paidCount: withDays.length,
    outstandingCount: open.length,
    overdueCount,
    maxDaysOverdue,
  };
}

/**
 * Memory-less tag for one set of metrics (no Hold-exit stickiness).
 * A client with no invoice history has no payment issues on record → On Target.
 */
export function rawPaymentStatus(m) {
  if (
    m.overdueCount >= 2 ||
    m.maxDaysOverdue >= 30 ||
    (m.avgDays !== null && m.avgDays > 30)
  ) {
    return PAYMENT_STATUS.HOLD;
  }
  if (
    m.outstandingCount === 0 &&
    (m.avgDays === null || (m.avgDays <= 15 && m.pctWithin15 >= 0.9))
  ) {
    return PAYMENT_STATUS.ON_TARGET;
  }
  return PAYMENT_STATUS.WARNING;
}

// End-of-month evaluation points for every COMPLETED calendar month between
// the earliest sent date and `today` (exclusive of the in-progress month).
function monthEndPoints(invoices, today) {
  let earliest = null;
  invoices.forEach((inv) => {
    if (inv.sent && (!earliest || inv.sent < earliest)) earliest = inv.sent;
  });
  if (!earliest) return [];

  const points = [];
  let y = earliest.getFullYear();
  let m = earliest.getMonth();
  for (;;) {
    const end = new Date(y, m + 1, 0, 23, 59, 59); // last day of month y-m
    if (end.getTime() >= today.getTime()) break;
    points.push(end);
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return points;
}

/**
 * Current payment status for one client, with Hold-exit hysteresis.
 *
 * Replays the invoice history at each completed month end, then evaluates
 * today. While in Hold, the client stays in Hold until they reach a zero
 * balance AND 2 consecutive clean cycles (no invoice overdue at cycle end),
 * at which point they step down to Warning — never straight to On Target.
 *
 * @param {Array}  invoices raw `invoices/all` entries for one client
 * @param {object} [opts]   { today?: Date, paymentTerms?: number }
 * @returns {{ status: string, holdFlag: boolean, avgDays: ?number,
 *             pctWithin15: ?number, paidCount: number,
 *             outstandingCount: number, overdueCount: number,
 *             maxDaysOverdue: number }}
 */
export function computeClientPaymentStatus(invoices, opts = {}) {
  const today = opts.today || new Date();
  const terms = Number(opts.paymentTerms);
  // null/undefined/NaN/negative terms fall back to the default; an explicit 0
  // (due on receipt) is honored.
  const paymentTerms = opts.paymentTerms != null && Number.isFinite(terms) && terms >= 0
    ? terms
    : DEFAULT_PAYMENT_TERMS;
  const normalized = (invoices || []).map(normalizeInvoice).filter((i) => i.sent);

  let state = null;
  let cleanCycles = 0;
  let justReleased = false; // released from Hold at the most recent cycle end

  monthEndPoints(normalized, today).forEach((point) => {
    const m = paymentMetricsAsOf(normalized, point, paymentTerms);
    const raw = rawPaymentStatus(m);

    if (state === PAYMENT_STATUS.HOLD) {
      if (raw === PAYMENT_STATUS.HOLD) {
        cleanCycles = 0;
        return;
      }
      cleanCycles = m.overdueCount === 0 ? cleanCycles + 1 : 0;
      if (m.outstandingCount === 0 && cleanCycles >= 2) {
        state = PAYMENT_STATUS.WARNING; // step down, never straight to On Target
        cleanCycles = 0;
        justReleased = true;
      }
    } else {
      // A full cycle has passed since any release; normal evaluation resumes.
      justReleased = false;
      state = raw;
      if (raw === PAYMENT_STATUS.HOLD) cleanCycles = 0;
    }
  });

  // Today's evaluation: a fresh Hold trigger always wins; an unserved Hold
  // persists (the in-progress month is not a completed clean cycle); a client
  // released at the latest cycle end stays at Warning until the next completed
  // cycle promotes them; everyone else gets today's memory-less tag.
  const current = paymentMetricsAsOf(normalized, today, paymentTerms);
  const rawToday = rawPaymentStatus(current);
  let status;
  if (rawToday === PAYMENT_STATUS.HOLD || state === PAYMENT_STATUS.HOLD) {
    status = PAYMENT_STATUS.HOLD;
  } else if (justReleased) {
    status = PAYMENT_STATUS.WARNING;
  } else {
    status = rawToday;
  }

  return {
    status,
    holdFlag: status === PAYMENT_STATUS.HOLD,
    ...current,
  };
}

// Join key between invoice `client` strings and client-record `clientName`s.
// Both come from org sheets that are edited by hand, so punctuation/spacing
// drift ("Acme Inc" vs "Acme, Inc.") is realistic — a strict-equality miss
// would silently read as On Target. Compare on lowercase alphanumerics only.
const normalizeName = (name) => String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Neutral result for clients with no invoice history. */
export const NO_INVOICE_STATUS = Object.freeze({
  status: PAYMENT_STATUS.ON_TARGET,
  holdFlag: false,
  avgDays: null,
  pctWithin15: null,
  paidCount: 0,
  outstandingCount: 0,
  overdueCount: 0,
  maxDaysOverdue: 0,
});

/**
 * Compute every client's payment status in one pass.
 *
 * @param {Array}  invoiceEntries `invoices/all` entries (all clients mixed)
 * @param {Array}  [clients]      client records (for per-client paymentTerms)
 * @param {Date}   [today]
 * @returns {Map<string, object>} normalized client name → status result
 */
export function buildPaymentStatusIndex(invoiceEntries, clients = [], today = new Date()) {
  const termsByClient = new Map();
  (clients || []).forEach((c) => {
    const key = normalizeName(c.clientName ?? c.name);
    if (key && c.paymentTerms != null) termsByClient.set(key, c.paymentTerms);
  });

  const invoicesByClient = new Map();
  (invoiceEntries || []).forEach((inv) => {
    const key = normalizeName(inv.client);
    if (!key) return;
    if (!invoicesByClient.has(key)) invoicesByClient.set(key, []);
    invoicesByClient.get(key).push(inv);
  });

  const index = new Map();
  invoicesByClient.forEach((invoices, key) => {
    index.set(key, computeClientPaymentStatus(invoices, {
      today,
      paymentTerms: termsByClient.get(key),
    }));
  });
  return index;
}

/** Look up a client's status result; clients without invoices read as On Target. */
export function getClientPaymentStatus(index, clientName) {
  return (index && index.get(normalizeName(clientName))) || NO_INVOICE_STATUS;
}

/** Tailwind badge classes for a payment status, matching the app's status-pill palette. */
export function getPaymentStatusBadge(status) {
  switch (status) {
    case PAYMENT_STATUS.ON_TARGET:
      return 'bg-status-success-light text-status-success-text';
    case PAYMENT_STATUS.WARNING:
      return 'bg-status-warning-light text-status-warning-text';
    case PAYMENT_STATUS.HOLD:
      return 'bg-status-danger-light text-status-danger-text';
    default:
      return 'bg-gray-100 text-gray-700';
  }
}
