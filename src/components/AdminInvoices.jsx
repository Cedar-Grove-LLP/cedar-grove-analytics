"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, LogOut, Receipt, DollarSign, CheckCircle, Clock, Check, X, Send, Mail, RefreshCw, Search, Download, AlertTriangle, ExternalLink } from 'lucide-react';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { GoogleAuthProvider, signInWithPopup } from 'firebase/auth';
import { db, auth } from '@/firebase/config';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/utils/formatters';
import { getStatusBadge, getMatchTypeBadge } from '@/utils/statusStyles';
import { downloadCSV } from '@/utils/csv';
import { parseInvoiceDate } from '@/utils/paymentStatus.mjs';
import {
  buildPaymentAllocations,
  canFullyAllocateInvoice,
  centsToAmount,
  invoiceAllocationCents,
  MIN_REMAINING_CENTS,
  toCents,
} from '@/utils/paymentAllocations.mjs';
import {
  buildHistoricalPaidAs,
  normalizePaymentIdentity,
  recommendInvoicesForPayment,
  recommendPaymentForInvoice,
} from '@/utils/paymentRecommendations.mjs';
import { SortableTh } from '@/components/tables';

// Company-suffix / stopword tokens that carry no identifying signal. These
// appear across many client names ("Inc.", "LLC", "The …"), so matching on
// them produces false positives (every "X Inc." invoice matching every
// "Y Inc." payment). Stripped before name comparison.
const NAME_STOPWORDS = new Set([
  'inc', 'incorporated', 'llc', 'llp', 'lp', 'ltd', 'limited',
  'corp', 'corporation', 'co', 'company', 'pllc', 'plc', 'group',
  'the', 'and', 'of',
]);

/**
 * Tokenize a name into meaningful, identifying parts: lowercase, strip
 * punctuation from each token (so "Inc." → "inc"), drop stopwords/company
 * suffixes and 1–2 char fragments. Used for word-level name matching so a
 * shared suffix like "Inc." never triggers a match on its own.
 */
function meaningfulNameTokens(name) {
  return (name || '')
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.replace(/[^a-z0-9]/g, ''))
    .filter((t) => t.length > 2 && !NAME_STOPWORDS.has(t));
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const STATUS_FILTER_OPTIONS = [
  { key: 'all', label: 'All Invoices' },
  { key: 'paid', label: 'Paid' },
  { key: 'outstanding', label: 'Outstanding' },
];

// Only suggest a payment as a match if it posted within this many days after
// the invoice was sent. Bounds the candidate list for old outstanding invoices.
const MATCH_WINDOW_DAYS = 90;

// Invoice date parsing (M/D, M/D/YYYY, Firestore Timestamps, verbose
// Date.toString()) is shared with the Payment Status tag engine.
const parseDateSent = parseInvoiceDate;

/** Format a transaction date (ISO 8601) to a short display string. */
function formatTxnDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function formatTxnFullDate(dateStr) {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * Stable natural key for an invoice, independent of sheetRowNumber.
 *
 * sheetRowNumber is positional — if rows are inserted/deleted/reordered in the
 * "Payment Status" sheet between the time a match is confirmed and the next
 * Apps Script sync, the matchedTransactionId will "follow the row slot"
 * instead of the invoice, and cause the wrong invoice to be marked Paid.
 * Use this key when locating the invoice to write back to Firestore.
 */
function invoiceKey(inv) {
  if (!inv) return '';
  const client = (inv.client ?? '').toString().trim().toLowerCase();
  const amount = inv.amount ?? '';
  const dateSent = (inv.dateSent ?? '').toString().trim();
  const year = inv.year ?? '';
  return `${client}|${amount}|${dateSent}|${year}`;
}

// TODO(team): confirm which address to CC on the third/final reminder.
// The Invoice Reminders System doc says "Please CC Sam on the third reminder
// email." Left blank until the team confirms Sam's address — while empty, no
// Cc header is added, so drafts still work; fill this in to enable the CC.
const SAM_CC_EMAIL = '';

// Ordinal labels for the three sequential reminders.
const REMINDER_ORDINALS = ['1st', '2nd', '3rd'];

// Sequential reminder email bodies, one per escalation stage (see the Invoice
// Reminders System doc — the single source of truth for this copy):
//   stage 0 → First reminder   (~16 days after the invoice, or day 31 for Net 30)
//   stage 1 → Second reminder  (14 days after the first)
//   stage 2+ → Third reminder  (final; CC Sam) — reused for any further nudges
// `stage` is the count of reminders already drafted for this invoice, so the
// body returned is the NEXT one to send.
function buildReminderBody(stage, { greeting, invoiceMonthLabel, dueDateStr, senderFirstName }) {
  if (stage <= 0) {
    return [
      `${greeting}, hope you are doing well.`,
      ``,
      `I wanted to follow up on the status of your payment for the ${invoiceMonthLabel} invoice, which was due on ${dueDateStr}.`,
      ``,
      `Please let us know if you have already processed the payment. We may have missed it on our end. Otherwise, we ask that you do so at your earliest convenience.`,
      ``,
      `As always, please let us know if you have any questions.`,
      ``,
      `Best,`,
      senderFirstName,
    ].join('\n');
  }
  if (stage === 1) {
    return [
      `${greeting},`,
      `Following up on our note below regarding your past due invoice. The payment for the ${invoiceMonthLabel} invoice was due on ${dueDateStr}.`,
      ``,
      `Please let us know if you have already processed the payment and we will be sure to check our records again.`,
      ``,
      `Otherwise, we ask that you send payment as soon as possible.`,
      ``,
      `Best,`,
      senderFirstName,
    ].join('\n');
  }
  return [
    `${greeting},`,
    `Following up regarding the ${invoiceMonthLabel} invoice. The payment was due on ${dueDateStr} and we have sent multiple reminders but have not received the payment.`,
    ``,
    `Please provide us with an update on the timing of your payment. We ask that you send the amount due no later than the end of this week.`,
    ``,
    `Best,`,
    senderFirstName,
  ].join('\n');
}

const AdminInvoices = () => {
  const { user, signOut } = useAuth();
  const router = useRouter();
  const [invoices, setInvoices] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [aliases, setAliases] = useState({});
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [monthFilter, setMonthFilter] = useState('all');
  const [nameFilter, setNameFilter] = useState('');
  const [sortConfig, setSortConfig] = useState({ key: 'dateSent', direction: 'desc' });
  const [clientsData, setClientsData] = useState([]);
  const [matchSelections, setMatchSelections] = useState({});
  const manuallySelectedRowsRef = useRef(new Set());
  const autoSelectedRowsRef = useRef(new Map());
  const [invoicesView, setInvoicesView] = useState('invoices');
  const [savingAlias, setSavingAlias] = useState(null);
  const [confirmedMatches, setConfirmedMatches] = useState({});
  const [markingPaid, setMarkingPaid] = useState(null);
  const [editingDateRow, setEditingDateRow] = useState(null);
  const [editDateValue, setEditDateValue] = useState('');
  const [savingDate, setSavingDate] = useState(null);
  const [syncing, setSyncing] = useState(false);
  const [syncStatus, setSyncStatus] = useState(null);

  // Gmail API integration
  const [gmailToken, setGmailToken] = useState(null);
  const [gmailEmail, setGmailEmail] = useState(null);
  const [creatingDraft, setCreatingDraft] = useState(null);
  const [draftSuccess, setDraftSuccess] = useState({});
  const [draftError, setDraftError] = useState(null);
  const [draftErrorMsg, setDraftErrorMsg] = useState(null);
  const [checkingSends, setCheckingSends] = useState(false);
  const [checkSendsResult, setCheckSendsResult] = useState(null);

  const connectGmail = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/gmail.compose');
    provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      setGmailToken(credential.accessToken);
      setGmailEmail(result.user?.email || null);
      return credential.accessToken;
    } catch (err) {
      console.error('Gmail auth error:', err);
      return null;
    }
  };

  const createReminderDraft = async (inv) => {
    setDraftError(null);
    let token = gmailToken;
    if (!token) {
      token = await connectGmail();
      if (!token) return;
    }

    setCreatingDraft(inv.sheetRowNumber);

    try {
      const apiBase = 'https://gmail.googleapis.com/gmail/v1/users/me';
      const metaParams = 'format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=From&metadataHeaders=Message-ID';
      const authHeader = { Authorization: `Bearer ${token}` };

      const gmailFetch = async (url) => {
        let res = await fetch(url, { headers: authHeader });
        if (res.status === 401) {
          setGmailToken(null);
          token = await connectGmail();
          if (!token) throw new Error('Re-authentication failed');
          authHeader.Authorization = `Bearer ${token}`;
          res = await fetch(url, { headers: authHeader });
        }
        return res;
      };

      const extractHeaders = (msg) => {
        const hdrs = msg.payload?.headers || [];
        return {
          threadId: msg.threadId,
          subject: hdrs.find((h) => h.name === 'Subject')?.value || '',
          to: hdrs.find((h) => h.name === 'To')?.value || '',
          messageId: hdrs.find((h) => h.name === 'Message-ID')?.value || '',
        };
      };

      let threadId, subject, to, messageId;
      let found = false;

      const searchAndExtract = async (query) => {
        const q = encodeURIComponent(query);
        const searchRes = await gmailFetch(`${apiBase}/messages?q=${q}&maxResults=1`);
        if (!searchRes.ok) return false;
        const searchData = await searchRes.json();
        const matchId = searchData.messages?.[0]?.id;
        if (!matchId) return false;
        const fullRes = await gmailFetch(`${apiBase}/messages/${matchId}?${metaParams}`);
        if (!fullRes.ok) return false;
        ({ threadId, subject, to, messageId } = extractHeaders(await fullRes.json()));
        return true;
      };

      // 1. Search by known subject line template
      const dateSentParsed = parseDateSent(inv.dateSent, inv.year);
      if (dateSentParsed) {
        const priorMonth = new Date(dateSentParsed.getFullYear(), dateSentParsed.getMonth() - 1, 1);
        const monthName = MONTH_NAMES[priorMonth.getMonth()];
        const year = priorMonth.getFullYear();
        const subjectQuery = `Cedar Grove LLP - Invoice (${monthName} ${year}) (${inv.client})`;
        // Match the outbound invoice email in ANY mailbox: it's always sent
        // from the firm domain to the client. `from:cedargrovellp.com` finds it
        // in the original sender's Sent AND in a CC'd colleague's Inbox (so any
        // recipient — not just the sender — can remind), while excluding the
        // client's inbound replies (from the client), which carry a To: header
        // pointing back at the firm and would misaddress the reminder.
        found = await searchAndExtract(`from:cedargrovellp.com subject:"${subjectQuery}"`);
      }

      // 2. Try emailId as message ID
      if (!found && inv.emailId) {
        const msgRes = await gmailFetch(`${apiBase}/messages/${inv.emailId}?${metaParams}`);
        if (msgRes.ok) {
          ({ threadId, subject, to, messageId } = extractHeaders(await msgRes.json()));
          found = true;
        }
      }

      // 3. Try emailId as thread ID
      if (!found && inv.emailId) {
        const threadRes = await gmailFetch(`${apiBase}/threads/${inv.emailId}?${metaParams}`);
        if (threadRes.ok) {
          const thread = await threadRes.json();
          const firstMsg = thread.messages?.[0];
          if (firstMsg) {
            ({ threadId, subject, to, messageId } = extractHeaders(firstMsg));
            found = true;
          }
        }
      }

      if (!found) {
        throw new Error(`Could not find invoice email for "${inv.client}". Connected as ${gmailEmail || 'unknown'}.`);
      }

      // Build the reminder email body
      const dueDateParsed = parseDateSent(inv.dueDate, inv.year);
      const dueDateStr = dueDateParsed
        ? `${dueDateParsed.getMonth() + 1}/${dueDateParsed.getDate()}`
        : '[DUE DATE]';
      const replySubject = subject.startsWith('Re:') ? subject : `Re: ${subject}`;

      // Look up billing contact first name from clients data
      const matchedClient = clientsData.find(
        (c) => c.clientName && c.clientName.toLowerCase() === inv.client?.toLowerCase()
      );
      const billingContactFirst = matchedClient?.billingContact?.split(' ')[0] || '';
      const greeting = billingContactFirst ? `Hi ${billingContactFirst}` : 'Hi [NAME]';

      // Compute the invoice month (prior month relative to dateSent)
      const invoiceMonthDate = dateSentParsed
        ? new Date(dateSentParsed.getFullYear(), dateSentParsed.getMonth() - 1, 1)
        : null;
      const invoiceMonthLabel = invoiceMonthDate ? MONTH_NAMES[invoiceMonthDate.getMonth()] : '';

      // Sender's first name
      const senderFirstName = user?.displayName?.split(' ')[0] || '';

      // Pick the reminder body by how many have already been drafted for this
      // invoice (persisted on the entry). Stage 2+ is the final reminder, which
      // CCs Sam per the Invoice Reminders System doc.
      const stage = inv.remindersSent || 0;
      const body = buildReminderBody(stage, { greeting, invoiceMonthLabel, dueDateStr, senderFirstName });

      const rawLines = [
        `To: ${to}`,
        ...(stage >= 2 && SAM_CC_EMAIL ? [`Cc: ${SAM_CC_EMAIL}`] : []),
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${messageId}`,
        `Content-Type: text/plain; charset=UTF-8`,
        '',
        body,
      ];
      const rawEmail = rawLines.join('\r\n');
      const encodedMessage = btoa(unescape(encodeURIComponent(rawEmail)))
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');

      const draftRes = await fetch(
        'https://gmail.googleapis.com/gmail/v1/users/me/drafts',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: {
              raw: encodedMessage,
              threadId,
            },
          }),
        }
      );

      if (!draftRes.ok) throw new Error(`Failed to create draft: ${draftRes.status}`);
      const draftJson = await draftRes.json().catch(() => ({}));
      const draftId = draftJson?.id || null;

      // Do NOT increment the reminder count here — a draft is not a send. Record
      // a `pendingReminder` on the entry (natural-key merge, so it survives
      // Apps Script sheet re-syncs like matchedTransactionId). The count only
      // advances once the service account confirms the draft was actually sent
      // (see /api/check-reminder-sends + docs/reminder-send-detection.md).
      // senderEmail is the mailbox the draft lives in — the account we impersonate
      // to look for the sent message.
      setDraftSuccess((prev) => ({ ...prev, [inv.sheetRowNumber]: REMINDER_ORDINALS[Math.min(stage, 2)] }));
      await updateInvoiceEntry(inv, (i) => ({
        ...i,
        pendingReminder: {
          draftId,
          threadId,
          senderEmail: gmailEmail || user?.email || '',
          stage,
          createdAt: new Date().toISOString(),
        },
      }));
    } catch (err) {
      console.error('Error creating reminder draft:', err);
      setDraftError(inv.sheetRowNumber);
      setDraftErrorMsg(err.message);
    } finally {
      setCreatingDraft(null);
    }
  };

  const fetchData = useCallback(async () => {
    try {
      // Fetch all data sources in parallel
      const [invoicesSnap, txnSnap, aliasesSnap, clientsSnap] = await Promise.all([
        getDoc(doc(db, 'invoices', 'all')),
        getDocs(collection(db, 'transactions')),
        getDoc(doc(db, 'clientAliases', 'all')),
        getDoc(doc(db, 'clients', 'all')),
      ]);

      // Invoices
      if (invoicesSnap.exists()) {
        setInvoices(invoicesSnap.data().entries || []);
      } else {
        setInvoices([]);
      }

      // Transactions — only positive amounts (incoming payments)
      const txnDocs = txnSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.amount > 0);
      setTransactions(txnDocs);

      // Client aliases
      if (aliasesSnap.exists()) {
        setAliases(aliasesSnap.data().aliases || {});
      } else {
        setAliases({});
      }

      // Clients data (for billing contact lookup)
      if (clientsSnap.exists()) {
        setClientsData(clientsSnap.data().clients || []);
      } else {
        setClientsData([]);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Ask the server (service account) whether any pending reminder drafts have
  // actually been sent; on confirmation it increments remindersSent server-side,
  // so we refetch to pick up the new counts. `silent` suppresses the result
  // banner for the automatic on-load poll.
  const checkReminderSends = useCallback(async ({ silent = false } = {}) => {
    if (!auth.currentUser) return;
    setCheckingSends(true);
    if (!silent) setCheckSendsResult(null);
    try {
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/check-reminder-sends', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.success) {
        if (!silent || data.confirmed > 0) setCheckSendsResult({ type: 'success', ...data });
        if (data.confirmed > 0) await fetchData();
      } else if (!silent) {
        setCheckSendsResult({ type: 'error', message: data.error || 'Check failed' });
      }
    } catch (err) {
      if (!silent) setCheckSendsResult({ type: 'error', message: err.message });
    } finally {
      setCheckingSends(false);
    }
  }, [fetchData]);

  // One automatic poll on load so counts advance without a manual click.
  useEffect(() => {
    checkReminderSends({ silent: true });
  }, [checkReminderSends]);

  const refetchTransactions = useCallback(async () => {
    try {
      const txnSnap = await getDocs(collection(db, 'transactions'));
      const txnDocs = txnSnap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t) => t.amount > 0);
      setTransactions(txnDocs);
    } catch (err) {
      console.error('Error refetching transactions:', err);
    }
  }, []);

  // Serialized read-modify-write for a single invoice entry in invoices/all.
  //
  // Every mutation (confirm match, mark paid, dismiss, edit date) must change
  // exactly one row without clobbering the others. The previous code rebuilt
  // the whole entries[] array from the `invoices` state captured in the
  // handler's closure and wrote it back — so when several edits happened in
  // quick succession, a later write built on a stale snapshot silently dropped
  // the matches saved by earlier writes (last-write-wins on the full array).
  //
  // This helper instead (a) serializes all writes through a promise queue so
  // they never overlap, and (b) re-reads the current doc immediately before
  // each write, applies the change to the one entry matched by natural key,
  // and writes the fresh array back. Sequential ordering + fresh read means no
  // edit can overwrite another's changes.
  const writeQueueRef = useRef(Promise.resolve());
  const updateInvoiceEntry = useCallback((targetInvoice, updater) => {
    const targetKey = invoiceKey(targetInvoice);
    const run = writeQueueRef.current.then(async () => {
      const snap = await getDoc(doc(db, 'invoices', 'all'));
      const current = snap.exists() ? (snap.data().entries || []) : [];
      const updated = current.map((inv) =>
        invoiceKey(inv) === targetKey ? updater(inv, current) : inv
      );
      await setDoc(doc(db, 'invoices', 'all'), { entries: updated }, { merge: true });
      setInvoices(updated);
      return updated;
    });
    // Keep the queue alive even if one operation rejects.
    writeQueueRef.current = run.catch(() => {});
    return run;
  }, []);

  const handleSync = async () => {
    setSyncing(true);
    setSyncStatus(null);
    try {
      if (!auth.currentUser) {
        throw new Error('You are not signed in.');
      }
      const idToken = await auth.currentUser.getIdToken();
      const res = await fetch('/api/sync-transactions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const data = await res.json();
      if (data.success) {
        setSyncStatus({ type: 'success', message: `Synced ${data.synced} transactions` });
        await refetchTransactions();
      } else {
        setSyncStatus({ type: 'error', message: data.error || 'Sync failed' });
      }
    } catch (err) {
      setSyncStatus({ type: 'error', message: err.message });
    } finally {
      setSyncing(false);
    }
  };

  // Restore confirmed matches from persisted matchedTransactionId on invoice entries
  useEffect(() => {
    if (invoices.length === 0 || transactions.length === 0) return;
    const txnMap = new Map(transactions.map((t) => [t.id, t]));
    const restored = {};
    for (const inv of invoices) {
      if (inv.matchedTransactionId) {
        const txn = txnMap.get(inv.matchedTransactionId);
        if (txn) {
          restored[inv.sheetRowNumber] = { txn, matchType: 'confirmed' };
        }
      }
    }
    setConfirmedMatches(restored);
  }, [invoices, transactions]);

  const handleLogout = async () => {
    await signOut();
    router.push('/');
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc',
    }));
  };

  // Export only the OUTSTANDING (unpaid) invoices from the current filtered
  // view. Uses the same `status !== 'Paid'` predicate as the Outstanding KPI
  // so the exported count matches the button label. Amount is a raw number
  // (no $) so it's spreadsheet-friendly.
  const handleExportCSV = () => {
    const headers = ['Client', 'Amount', 'Year', 'Date Sent', 'Status', 'Date Received', 'Last Reminder', 'Notes'];
    const rows = filteredAndSorted
      .filter((inv) => inv.status !== 'Paid')
      .map((inv) => [
        inv.client || '',
        inv.amount ?? '',
        inv.year ?? '',
        inv.dateSent || '',
        inv.status || '',
        inv.dateReceived || '',
        inv.lastReminder || '',
        inv.notes || '',
      ]);
    downloadCSV(`outstanding-invoices-${new Date().toISOString().slice(0, 10)}.csv`, headers, rows);
  };

  // Derive available month/year options from the data
  const monthOptions = useMemo(() => {
    const seen = new Map();
    for (const inv of invoices) {
      const parsed = parseDateSent(inv.dateSent, inv.year);
      if (parsed) {
        const key = `${parsed.getFullYear()}-${parsed.getMonth()}`;
        if (!seen.has(key)) {
          seen.set(key, { year: parsed.getFullYear(), month: parsed.getMonth() });
        }
      }
    }
    const options = Array.from(seen.values()).sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year;
      return b.month - a.month;
    });
    return options;
  }, [invoices]);

  // Month filter defaults to "All Time" (the initial monthFilter state) so a
  // paid invoice from any month stays visible after a reload. Previously this
  // defaulted to the current month, which hid older paid invoices and made
  // confirmed matches appear to vanish on the next visit.

  const filteredAndSorted = useMemo(() => {
    let items = invoices;

    // Month filter
    if (monthFilter !== 'all') {
      const [filterYear, filterMonth] = monthFilter.split('-').map(Number);
      items = items.filter((inv) => {
        const parsed = parseDateSent(inv.dateSent, inv.year);
        if (!parsed) return false;
        return parsed.getFullYear() === filterYear && parsed.getMonth() === filterMonth;
      });
    }

    // Status filter
    if (statusFilter === 'paid') {
      items = items.filter((inv) => inv.status === 'Paid');
    } else if (statusFilter === 'outstanding') {
      items = items.filter((inv) => inv.status !== 'Paid');
    }

    // Client name search (case-insensitive substring)
    const nameQuery = nameFilter.trim().toLowerCase();
    if (nameQuery) {
      items = items.filter((inv) => (inv.client || '').toLowerCase().includes(nameQuery));
    }

    // Sort
    items = [...items].sort((a, b) => {
      const { key, direction } = sortConfig;
      let aVal, bVal;

      if (key === 'dateSent') {
        aVal = parseDateSent(a.dateSent, a.year)?.getTime() ?? 0;
        bVal = parseDateSent(b.dateSent, b.year)?.getTime() ?? 0;
      } else if (key === 'amount' || key === 'year') {
        aVal = a[key] ?? 0;
        bVal = b[key] ?? 0;
      } else {
        aVal = (a[key] ?? '').toString().toLowerCase();
        bVal = (b[key] ?? '').toString().toLowerCase();
      }

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });

    return items;
  }, [invoices, monthFilter, statusFilter, nameFilter, sortConfig]);

  const summaryStats = useMemo(() => {
    const paid = filteredAndSorted.filter((inv) => inv.status === 'Paid');
    const outstanding = filteredAndSorted.filter((inv) => inv.status !== 'Paid');
    return {
      totalCount: filteredAndSorted.length,
      totalAmount: filteredAndSorted.reduce((sum, inv) => sum + (inv.amount || 0), 0),
      paidCount: paid.length,
      paidAmount: paid.reduce((sum, inv) => sum + (inv.amount || 0), 0),
      outstandingCount: outstanding.length,
      outstandingAmount: outstanding.reduce((sum, inv) => sum + (inv.amount || 0), 0),
    };
  }, [filteredAndSorted]);

  // Map each client (lowercased) to the distinct counterparty names their
  // matched payments actually came in under — i.e. what the client has
  // "previously paid as". Derived from every invoice with a matched Mercury
  // transaction, across the full book (not just the filtered view).
  const paidAsByClient = useMemo(() => {
    const txnById = new Map(transactions.map((t) => [t.id, t]));
    const map = {};
    for (const inv of invoices) {
      if (!inv.matchedTransactionId) continue;
      const txn = txnById.get(inv.matchedTransactionId);
      const cp = txn && txn.counterpartyName ? txn.counterpartyName.trim() : '';
      if (!cp) continue;
      const key = (inv.client || '').toLowerCase();
      if (!map[key]) map[key] = new Set();
      map[key].add(cp);
    }
    return map;
  }, [invoices, transactions]);

  // Counterparty names a client paid under, excluding names identical to the
  // client name (those add no information).
  const getPaidAsNames = (client) => {
    const clientLower = (client || '').toLowerCase();
    const set = paidAsByClient[clientLower];
    if (!set) return [];
    return Array.from(set).filter((n) => n.toLowerCase() !== clientLower);
  };

  // Allocation is derived across the entire invoice book, not merely the
  // visible filters. That prevents a hidden invoice from making a payment look
  // as though it has more capacity than it really does.
  const paymentAllocations = useMemo(
    () => buildPaymentAllocations(transactions, invoices),
    [transactions, invoices]
  );

  const historicalPaidAs = useMemo(
    () => buildHistoricalPaidAs(invoices, transactions),
    [invoices, transactions]
  );

  const paymentRecommendations = useMemo(() => {
    const result = {};
    for (const invoice of filteredAndSorted) {
      if (invoice.status === 'Paid') continue;
      result[invoice.sheetRowNumber] = recommendPaymentForInvoice({
        invoice,
        transactions,
        allocations: paymentAllocations,
        aliases,
        historicalPaidAs,
      });
    }
    return result;
  }, [filteredAndSorted, transactions, paymentAllocations, aliases, historicalPaidAs]);

  // Preselect only a unique strong recommendation. Track automatic and manual
  // choices separately so allocation changes can clear a stale auto-choice,
  // while a user's explicit selection is never overwritten on rerender.
  useEffect(() => {
    setMatchSelections((previous) => {
      const next = { ...previous };
      let changed = false;

      for (const [rowKey, transactionId] of autoSelectedRowsRef.current) {
        const current = paymentRecommendations[rowKey];
        if (current?.status !== 'recommended' || current.candidate.transactionId !== transactionId) {
          if (next[rowKey] === transactionId) delete next[rowKey];
          autoSelectedRowsRef.current.delete(rowKey);
          changed = true;
        }
      }

      for (const [rowKey, result] of Object.entries(paymentRecommendations)) {
        if (result.status !== 'recommended' || manuallySelectedRowsRef.current.has(rowKey)) continue;
        if (Object.prototype.hasOwnProperty.call(next, rowKey)) continue;
        next[rowKey] = result.candidate.transactionId;
        autoSelectedRowsRef.current.set(rowKey, result.candidate.transactionId);
        changed = true;
      }

      return changed ? next : previous;
    });
  }, [paymentRecommendations]);

  const unmatchedPayments = useMemo(() => transactions
    .map((transaction) => ({ transaction, allocation: paymentAllocations[transaction.id] }))
    .filter(({ allocation }) => allocation && allocation.remainingCents >= MIN_REMAINING_CENTS)
    .sort((a, b) => new Date(b.transaction.postedAt || b.transaction.createdAt || 0)
      - new Date(a.transaction.postedAt || a.transaction.createdAt || 0)),
  [transactions, paymentAllocations]);

  // For each unmatched payment, the outstanding invoices it could settle.
  // Computed over the full invoice book (not the filtered table) so candidates
  // aren't hidden by the active status/name filters.
  const paymentInvoiceCandidates = useMemo(() => {
    const result = {};
    for (const { transaction, allocation } of unmatchedPayments) {
      result[transaction.id] = recommendInvoicesForPayment({
        payment: transaction,
        invoices,
        allocation,
        aliases,
        historicalPaidAs,
      });
    }
    return result;
  }, [unmatchedPayments, invoices, aliases, historicalPaidAs]);

  // -------------------------------------------------------
  // Matching logic: for each invoice, find candidate
  // transactions ranked by alias > name > amount
  // -------------------------------------------------------
  const matchCandidates = useMemo(() => {
    const candidateMap = {};

    for (const inv of filteredAndSorted) {
      const clientLower = (inv.client || '').toLowerCase();
      const invSentDate = parseDateSent(inv.dateSent, inv.year);
      const candidates = [];
      const seenTxnIds = new Set();
      const strongTransactionIds = new Set(
        (paymentRecommendations[inv.sheetRowNumber]?.candidates || [])
          .map((candidate) => candidate.transactionId)
      );

      for (const txn of transactions) {
        // A payment remains selectable after its first match while its unused
        // balance can cover this invoice in full. Partial invoice payments are
        // intentionally outside this iteration.
        const allocation = paymentAllocations[txn.id];
        if (!canFullyAllocateInvoice(allocation, inv.amount)) continue;
        // Only consider payments in the window [invoice sent, +90 days].
        // A payment can't predate the invoice, and capping at 90 days keeps
        // very old invoices from accumulating dozens of coincidental matches.
        if (invSentDate && !strongTransactionIds.has(txn.id)) {
          const txnDate = txn.postedAt ? new Date(txn.postedAt) : txn.createdAt ? new Date(txn.createdAt) : null;
          if (txnDate) {
            if (txnDate < invSentDate) continue;
            if (txnDate - invSentDate > MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000) continue;
          }
        }
        const cpName = txn.counterpartyName || '';
        const cpLower = cpName.toLowerCase();
        const matchTypes = [];

        // 1. Alias match
        const aliasClients = aliases[cpLower];
        if (aliasClients && aliasClients.includes(inv.client)) {
          matchTypes.push('alias');
        }
        const knownPaidAs = historicalPaidAs[normalizePaymentIdentity(inv.client)];
        if (knownPaidAs?.has(normalizePaymentIdentity(cpName)) && !matchTypes.includes('alias')) {
          matchTypes.push('alias');
        }

        // 2. Name match (case-insensitive includes in either direction)
        if (cpLower && clientLower) {
          if (cpLower.includes(clientLower) || clientLower.includes(cpLower)) {
            matchTypes.push('name');
          } else {
            // Fall back to word-level token matching. Both names are reduced to
            // their meaningful, identifying tokens (company suffixes like "Inc."
            // and stopwords stripped), then matched on exact token equality — a
            // shared "Inc." can no longer trigger a match, and substrings like
            // "inc" inside "Incognito" are excluded.
            const clientTokens = meaningfulNameTokens(clientLower);
            const cpTokens = new Set(meaningfulNameTokens(cpLower));
            if (clientTokens.some((tok) => cpTokens.has(tok))) {
              matchTypes.push('name');
            }
          }
        }

        // 3. Amount match
        if (toCents(txn.amount) === toCents(inv.amount)) {
          matchTypes.push('amount');
        }

        if (matchTypes.length > 0 && !seenTxnIds.has(txn.id)) {
          seenTxnIds.add(txn.id);
          // Use the highest priority match type
          const bestType = matchTypes[0];
          candidates.push({ txn, matchType: bestType, allocation });
        }
      }

      // Sort: alias first, then name, then amount
      const typeOrder = { alias: 0, name: 1, amount: 2 };
      candidates.sort((a, b) => typeOrder[a.matchType] - typeOrder[b.matchType]);

      candidateMap[inv.sheetRowNumber] = candidates;
    }

    return candidateMap;
  }, [filteredAndSorted, transactions, aliases, paymentAllocations, historicalPaidAs, paymentRecommendations]);

  // Confirm a match: save alias + persist match on the invoice + mark as Paid
  const handleConfirmMatch = async (invoice, transactionId) => {
    const txn = transactions.find((t) => t.id === transactionId);
    if (!txn) return;

    const cpLower = (txn.counterpartyName || '').toLowerCase();
    if (!cpLower) return;

    setSavingAlias(invoice.sheetRowNumber);

    try {
      // Build updated aliases (add client to array if not already present)
      const updatedAliases = { ...aliases };
      const existing = updatedAliases[cpLower] || [];
      if (!existing.includes(invoice.client)) {
        updatedAliases[cpLower] = [...existing, invoice.client];
      }

      // Persist the alias and the single-row invoice change. The invoice write
      // goes through updateInvoiceEntry (fresh read + serialized) so a rapid
      // sequence of matches can't clobber each other. Match by stable natural
      // key — sheetRowNumber may shift between syncs.
      await Promise.all([
        setDoc(doc(db, 'clientAliases', 'all'), { aliases: updatedAliases }),
        updateInvoiceEntry(invoice, (inv, currentInvoices) => {
          const freshAllocation = buildPaymentAllocations([txn], currentInvoices)[transactionId];
          if (!canFullyAllocateInvoice(freshAllocation, inv.amount)) {
            throw new Error('This payment no longer has enough unmatched balance for the invoice.');
          }
          return {
            ...inv,
            matchedTransactionId: transactionId,
            matchedPaymentAmount: centsToAmount(toCents(inv.amount)),
            status: 'Paid',
            dateReceived: txn.postedAt || txn.createdAt || inv.dateReceived,
          };
        }),
      ]);

      // Update local state
      setAliases(updatedAliases);
      setConfirmedMatches((prev) => ({
        ...prev,
        [invoice.sheetRowNumber]: { txn, matchType: 'alias' },
      }));
      setMatchSelections((prev) => {
        const next = { ...prev };
        delete next[invoice.sheetRowNumber];
        return next;
      });
    } catch (err) {
      console.error('Error saving match:', err);
    } finally {
      setSavingAlias(null);
    }
  };

  // Dismiss a confirmed match: clear persisted match and revert status
  const handleDismissMatch = async (sheetRowNumber) => {
    try {
      // Resolve the target invoice by sheetRowNumber for the current in-memory
      // list, then let updateInvoiceEntry match by stable natural key on a
      // fresh read so row shifts between fetch and write don't touch the wrong
      // entry and concurrent edits aren't clobbered.
      const target = invoices.find((inv) => inv.sheetRowNumber === sheetRowNumber);
      if (target) {
        await updateInvoiceEntry(target, (inv) => {
          const { matchedTransactionId, matchedPaymentAmount, ...rest } = inv;
          return { ...rest, status: '', dateReceived: '' };
        });
      }
    } catch (err) {
      console.error('Error removing match:', err);
    }

    setConfirmedMatches((prev) => {
      const next = { ...prev };
      delete next[sheetRowNumber];
      return next;
    });
  };

  // Manually mark an invoice as paid without a matched transaction
  const handleMarkPaid = async (invoice) => {
    try {
      setMarkingPaid(invoice.sheetRowNumber);
      const today = new Date().toLocaleDateString('en-US');
      await updateInvoiceEntry(invoice, (inv) => ({ ...inv, status: 'Paid', dateReceived: today }));
    } catch (err) {
      console.error('Error marking invoice as paid:', err);
    } finally {
      setMarkingPaid(null);
    }
  };

  // Revert a manually-marked paid invoice back to outstanding
  const handleUnmarkPaid = async (invoice) => {
    try {
      setMarkingPaid(invoice.sheetRowNumber);
      await updateInvoiceEntry(invoice, (inv) => ({ ...inv, status: '', dateReceived: '' }));
    } catch (err) {
      console.error('Error unmarking invoice:', err);
    } finally {
      setMarkingPaid(null);
    }
  };

  const formatDateDisplay = (dateStr, year) => {
    if (!dateStr) return '—';
    const parsed = parseDateSent(dateStr, year);
    if (!parsed) return dateStr;
    return parsed.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', year: 'numeric' });
  };

  // Convert a stored date ("M/D/YYYY", Timestamp, etc.) to the yyyy-mm-dd
  // format an <input type="date"> expects. Empty string when unparseable.
  const toDateInputValue = (dateStr, year) => {
    const parsed = parseDateSent(dateStr, year);
    if (!parsed) return '';
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  // Persist a manually-edited Date Received. inputValue is yyyy-mm-dd (or ''
  // to clear); it's stored in the sheet-native "M/D/YYYY" form. Matched by
  // natural key so a row shift can't write the wrong invoice.
  // NOTE: for an invoice with a matchedTransactionId, the Apps Script
  // write-back re-derives Date Received from the Mercury transaction, so a
  // manual edit here is intended for unmatched / manually-paid invoices.
  const handleSaveDateReceived = async (invoice, inputValue) => {
    let stored = '';
    if (inputValue) {
      const [y, m, d] = inputValue.split('-').map(Number);
      stored = `${m}/${d}/${y}`;
    }
    try {
      setSavingDate(invoice.sheetRowNumber);
      await updateInvoiceEntry(invoice, (inv) => ({ ...inv, dateReceived: stored }));
    } catch (err) {
      console.error('Error saving date received:', err);
    } finally {
      setSavingDate(null);
      setEditingDateRow(null);
    }
  };


  // Render the match cell for a given invoice row
  const renderMatchCell = (inv) => {
    const rowKey = inv.sheetRowNumber;

    // Show confirmed match
    if (confirmedMatches[rowKey]) {
      const { txn } = confirmedMatches[rowKey];
      const allocation = paymentAllocations[txn.id];
      const invoiceAllocation = centsToAmount(invoiceAllocationCents(inv));
      return (
        <div className="flex items-start gap-2">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0 mt-0.5" />
          <div className="min-w-0">
            <div className="text-xs text-green-700 truncate max-w-[220px]">
              {txn.counterpartyName} — {formatCurrency(invoiceAllocation)} of {formatCurrency(txn.amount)} — {formatTxnDate(txn.postedAt || txn.createdAt)}
            </div>
            {allocation && allocation.remainingCents >= MIN_REMAINING_CENTS ? (
              <div className="text-[10px] font-medium text-amber-600">
                Overpaid {formatCurrency(centsToAmount(allocation.remainingCents))}
              </div>
            ) : (
              <div className="text-[10px] text-gray-500">Payment fully matched</div>
            )}
          </div>
          <button
            onClick={() => handleDismissMatch(rowKey)}
            aria-label="Dismiss match"
            className="p-1 text-gray-400 hover:text-gray-600 flex-shrink-0 mt-0.5"
          >
            <X className="w-3 h-3" aria-hidden="true" />
          </button>
        </div>
      );
    }

    const candidates = matchCandidates[rowKey] || [];
    const recommendation = paymentRecommendations[rowKey];
    if (candidates.length === 0) {
      return <span className="text-gray-400 text-xs">No matches</span>;
    }

    const selectedTxnId = matchSelections[rowKey];

    return (
      <div className="space-y-1.5">
        {recommendation?.status === 'recommended' && (
          <div className="flex items-start gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-medium text-emerald-800">
            <CheckCircle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>
              Recommended payment found — exact amount + {recommendation.candidate.matchType === 'paid-as' ? 'known paid-as name' : 'exact client name'}
            </span>
          </div>
        )}
        {recommendation?.status === 'ambiguous' && (
          <div className="flex items-start gap-1 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-800">
            <AlertTriangle className="mt-0.5 h-3 w-3 flex-shrink-0" />
            <span>{recommendation.candidates.length} equally strong payments found — select one manually</span>
          </div>
        )}
        <div className="flex items-center gap-1">
          <select
            aria-label="Match to billing entry"
            value={selectedTxnId || ''}
            onChange={(e) => {
              const key = String(rowKey);
              manuallySelectedRowsRef.current.add(key);
              autoSelectedRowsRef.current.delete(key);
              setMatchSelections((prev) => ({
                ...prev,
                [rowKey]: e.target.value || undefined,
              }));
            }}
            className="text-xs border border-gray-200 rounded px-2 py-1 bg-white max-w-[240px] focus:outline-none focus:ring-1 focus:ring-gray-300"
          >
            <option value="">
              Select match... ({candidates.length})
            </option>
            {candidates.map((c) => (
              <option key={c.txn.id} value={c.txn.id}>
                {c.txn.counterpartyName || 'Unknown'} — {formatCurrency(c.txn.amount)} payment — {formatCurrency(centsToAmount(c.allocation.remainingCents))} remaining — {formatTxnDate(c.txn.postedAt || c.txn.createdAt)} ({c.matchType})
              </option>
            ))}
          </select>
          {selectedTxnId && (
            <button
              onClick={() => handleConfirmMatch(inv, selectedTxnId)}
              disabled={savingAlias === rowKey}
              aria-label="Confirm match"
              className="p-1 rounded bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-50 transition-colors flex-shrink-0"
              title="Confirm match and save alias"
            >
              <Check className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/admin"
                className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition-colors"
              >
                <ArrowLeft className="w-5 h-5" />
                <span>Back to Admin</span>
              </Link>
              <div className="h-6 w-px bg-gray-300"></div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <Receipt className="w-5 h-5 text-amber-600" />
                </div>
                <div>
                  <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
                  <p className="text-sm text-gray-600">Invoice payment status</p>
                </div>
              </div>
              <button
                onClick={handleSync}
                disabled={syncing}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <RefreshCw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{syncing ? 'Syncing...' : 'Sync from Mercury'}</span>
              </button>
              {syncStatus && (
                <span role={syncStatus.type === 'success' ? 'status' : 'alert'} className={`text-sm ${syncStatus.type === 'success' ? 'text-green-700' : 'text-red-600'}`}>
                  {syncStatus.message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-4">
              {user && (
                <div className="flex items-center gap-3">
                  {user.photoURL && (
                    <img
                      src={user.photoURL}
                      alt={user.displayName || 'User'}
                      className="w-8 h-8 rounded-full"
                    />
                  )}
                  <div className="text-sm">
                    <div className="font-medium text-gray-900">{user.displayName}</div>
                    <div className="text-gray-500">{user.email}</div>
                  </div>
                </div>
              )}
              <button
                onClick={handleLogout}
                className="flex items-center gap-2 px-4 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Gmail Connection Banner */}
      <div className="max-w-7xl mx-auto px-4 pt-6 sm:px-6 lg:px-8">
        <div className="bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Mail className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <p className="text-sm text-blue-700">
              {gmailToken
                ? <>Gmail connected as <span className="font-medium">{gmailEmail}</span> — reminder drafts will be created as replies in the original thread.</>
                : 'Connect Gmail to create reminder email drafts directly in the invoice thread.'}
            </p>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => checkReminderSends({})}
              disabled={checkingSends}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white border border-blue-200 text-blue-700 hover:bg-blue-100 transition-colors disabled:opacity-50"
              title="Ask the service account whether any pending reminder drafts have been sent, and advance their counts"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${checkingSends ? 'animate-spin' : ''}`} />
              {checkingSends ? 'Checking…' : 'Check sends'}
            </button>
            <button
              onClick={connectGmail}
              className="px-4 py-1.5 text-xs font-medium rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition-colors"
            >
              {gmailToken ? 'Switch Account' : 'Connect Gmail'}
            </button>
          </div>
        </div>
        {checkSendsResult && (
          <div
            role={checkSendsResult.type === 'success' ? 'status' : 'alert'}
            className={`mt-2 rounded-lg px-4 py-2 text-xs ${
              checkSendsResult.type === 'success'
                ? 'bg-green-50 border border-green-200 text-green-700'
                : 'bg-red-50 border border-red-200 text-red-700'
            }`}
          >
            {checkSendsResult.type === 'success'
              ? `Checked ${checkSendsResult.checked ?? 0} pending draft(s): ${checkSendsResult.confirmed ?? 0} sent, ${checkSendsResult.stillPending ?? 0} awaiting, ${checkSendsResult.discarded ?? 0} discarded.`
              : checkSendsResult.message}
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="text-gray-500 text-sm">Loading invoices...</div>
          </div>
        ) : (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 rounded-lg">
                    <DollarSign className="w-5 h-5 text-gray-600" />
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Total Invoiced ({summaryStats.totalCount})</div>
                    <div className="text-xl font-semibold text-gray-900">{formatCurrency(summaryStats.totalAmount)}</div>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-green-50 rounded-lg">
                    <CheckCircle className="w-5 h-5 text-green-500" />
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Paid ({summaryStats.paidCount})</div>
                    <div className="text-xl font-semibold text-green-600">{formatCurrency(summaryStats.paidAmount)}</div>
                  </div>
                </div>
              </div>
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-red-50 rounded-lg">
                    <Clock className="w-5 h-5 text-red-500" />
                  </div>
                  <div>
                    <div className="text-sm text-gray-600">Outstanding ({summaryStats.outstandingCount})</div>
                    <div className="text-xl font-semibold text-red-600">{formatCurrency(summaryStats.outstandingAmount)}</div>
                  </div>
                </div>
              </div>
            </div>

            {/* View toggle: the invoices table, or the unmatched-payment matcher. */}
            <div className="mb-4 flex items-center gap-2">
              <button
                type="button"
                onClick={() => setInvoicesView('invoices')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  invoicesView === 'invoices'
                    ? 'bg-gray-900 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Invoices
              </button>
              <button
                type="button"
                onClick={() => setInvoicesView('unmatched')}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  invoicesView === 'unmatched'
                    ? 'bg-amber-600 text-white'
                    : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                }`}
              >
                Unmatched payments ({unmatchedPayments.length})
              </button>
              {invoicesView === 'unmatched' && unmatchedPayments.length > 0 && (
                <span className="ml-auto text-sm font-semibold text-amber-700">
                  {formatCurrency(centsToAmount(unmatchedPayments.reduce(
                    (sum, item) => sum + item.allocation.remainingCents, 0
                  )))} available to match
                </span>
              )}
            </div>

            {invoicesView === 'unmatched' && (
              <div className="mb-6 overflow-hidden rounded-lg border border-amber-200 bg-white shadow-sm">
                <div>
                  {unmatchedPayments.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-gray-500">All incoming payments are fully matched.</p>
                  ) : (
                    <ul className="divide-y divide-amber-100">
                      {unmatchedPayments.map(({ transaction, allocation }) => {
                        const candidates = paymentInvoiceCandidates[transaction.id] || [];
                        return (
                          <li key={transaction.id} className="px-4 py-3">
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
                                  <span className="truncate">{transaction.counterpartyName || 'Unknown'}</span>
                                  {allocation.allocatedCents > 0 && (
                                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                                      Partially matched
                                    </span>
                                  )}
                                  {transaction.dashboardLink && (
                                    <a
                                      href={transaction.dashboardLink}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="inline-flex text-gray-400 hover:text-gray-700"
                                      title="Open transaction in Mercury"
                                    >
                                      <ExternalLink className="h-3.5 w-3.5" />
                                    </a>
                                  )}
                                </div>
                                <div className="mt-0.5 text-xs text-gray-500">
                                  {formatTxnFullDate(transaction.postedAt || transaction.createdAt)}
                                  {' · '}
                                  {formatCurrency(transaction.amount)} received
                                </div>
                              </div>
                              <div className="flex-shrink-0 text-right">
                                <div className="text-sm font-semibold text-amber-700">
                                  {formatCurrency(centsToAmount(allocation.remainingCents))}
                                </div>
                                <div className="text-[10px] uppercase tracking-wide text-gray-400">available</div>
                              </div>
                            </div>

                            {candidates.length === 0 ? (
                              <p className="mt-2 text-xs text-gray-400">No matching outstanding invoices found.</p>
                            ) : (
                              <ul className="mt-2 space-y-1">
                                {candidates.map((c) => (
                                  <li
                                    key={`${c.invoice.client}-${c.invoice.sheetRowNumber}`}
                                    className="flex items-center justify-between gap-3 rounded-md bg-gray-50 px-3 py-2"
                                  >
                                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                                      <span className="font-medium text-gray-900">{c.invoice.client}</span>
                                      <span className="text-gray-600">{formatCurrency(c.invoice.amount)}</span>
                                      <span className="text-xs text-gray-400">
                                        sent {formatDateDisplay(c.invoice.dateSent, c.invoice.year)}
                                      </span>
                                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                        c.priority === 0
                                          ? 'bg-green-50 text-green-700'
                                          : c.priority === 1
                                            ? 'bg-blue-50 text-blue-700'
                                            : 'bg-gray-200 text-gray-600'
                                      }`}>
                                        {c.matchType === 'exact-name'
                                          ? 'Name match'
                                          : c.matchType === 'paid-as'
                                            ? 'Paid-as match'
                                            : 'Amount match'}
                                        {c.exactAmount ? ' · exact' : ''}
                                      </span>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => handleConfirmMatch(c.invoice, transaction.id)}
                                      disabled={savingAlias === c.invoice.sheetRowNumber}
                                      className="inline-flex flex-shrink-0 items-center gap-1 rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                      title={`Match this payment to ${c.invoice.client}'s ${formatCurrency(c.invoice.amount)} invoice`}
                                    >
                                      {savingAlias === c.invoice.sheetRowNumber ? (
                                        <div className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                                      ) : (
                                        <Check className="h-3.5 w-3.5" />
                                      )}
                                      Match
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {invoicesView === 'invoices' && (
              <>

            {/* Filters Row */}
            <div className="flex items-center gap-4 mb-4 flex-wrap">
              {/* Month Dropdown */}
              <select
                aria-label="Filter by month"
                value={monthFilter}
                onChange={(e) => setMonthFilter(e.target.value)}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-gray-300"
              >
                <option value="all">All Time</option>
                {monthOptions.map((opt) => (
                  <option key={`${opt.year}-${opt.month}`} value={`${opt.year}-${opt.month}`}>
                    {MONTH_NAMES[opt.month]} {opt.year}
                  </option>
                ))}
              </select>

              {/* Status Filter Tabs */}
              {STATUS_FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                    statusFilter === opt.key
                      ? 'bg-gray-900 text-white'
                      : 'bg-white text-gray-600 border border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              ))}

              {/* Client name search */}
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  aria-label="Search invoices"
                  value={nameFilter}
                  onChange={(e) => setNameFilter(e.target.value)}
                  placeholder="Search client..."
                  className="pl-9 pr-3 py-2 rounded-lg text-sm bg-white text-gray-700 border border-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-300 w-48"
                />
              </div>

              <button
                onClick={handleExportCSV}
                disabled={summaryStats.outstandingCount === 0}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-white text-gray-700 border border-gray-200 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                title="Export the outstanding invoices in the current view to CSV"
              >
                <Download className="w-4 h-4" />
                <span>Export Outstanding</span>
              </button>

              <span className="ml-auto text-sm text-gray-500">
                Showing {filteredAndSorted.length} invoice{filteredAndSorted.length !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Table */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <SortableTh
                        label="Client"
                        sortKey="client"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hover:bg-gray-100 whitespace-nowrap"
                      />
                      <SortableTh
                        label="Amount"
                        sortKey="amount"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                        className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider hover:bg-gray-100 whitespace-nowrap"
                      />
                      <SortableTh
                        label="Date Sent"
                        sortKey="dateSent"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hover:bg-gray-100 whitespace-nowrap"
                      />
                      <SortableTh
                        label="Status"
                        sortKey="status"
                        sortConfig={sortConfig}
                        onSort={handleSort}
                        className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider hover:bg-gray-100 whitespace-nowrap"
                      />
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Matched Payment
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Date Received
                      </th>
                      <th scope="col" className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Reminder
                      </th>
                      <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider whitespace-nowrap">
                        Notes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {filteredAndSorted.map((inv, idx) => (
                      <tr key={`${inv.client}-${inv.sheetRowNumber}-${idx}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 text-sm text-gray-900 max-w-[250px]">
                          <div className="truncate">{inv.client}</div>
                          {getPaidAsNames(inv.client).length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {getPaidAsNames(inv.client).map((name) => (
                                <span
                                  key={name}
                                  className="inline-flex items-center max-w-[220px] truncate px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-700"
                                  title={`Previously paid as "${name}"`}
                                >
                                  Paid as: {name}
                                </span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm font-medium text-right ${
                          inv.status === 'Paid' ? 'text-green-700' : 'text-gray-900'
                        }`}>
                          {formatCurrency(inv.amount || 0)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                          {formatDateDisplay(inv.dateSent, inv.year)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center gap-2">
                            <span
                              className={`inline-flex items-center px-2 py-1 text-xs font-semibold rounded-full ${getStatusBadge(inv.status)}`}
                            >
                              {inv.status || '—'}
                            </span>
                            {inv.status !== 'Paid' ? (
                              <button
                                onClick={() => handleMarkPaid(inv)}
                                disabled={markingPaid === inv.sheetRowNumber}
                                className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-md bg-green-50 text-green-700 hover:bg-green-100 transition-colors disabled:opacity-50"
                                title="Mark as paid without matching a payment"
                              >
                                {markingPaid === inv.sheetRowNumber ? (
                                  <div className="w-3 h-3 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                <span>Mark Paid</span>
                              </button>
                            ) : !confirmedMatches[inv.sheetRowNumber] && !inv.matchedTransactionId ? (
                              <button
                                onClick={() => handleUnmarkPaid(inv)}
                                disabled={markingPaid === inv.sheetRowNumber}
                                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                                title="Revert to outstanding"
                              >
                                {markingPaid === inv.sheetRowNumber ? (
                                  <div className="w-3 h-3 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <X className="w-3 h-3" />
                                )}
                              </button>
                            ) : null}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm">
                          {renderMatchCell(inv)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {editingDateRow === inv.sheetRowNumber ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="date"
                                aria-label="Edit date received"
                                value={editDateValue}
                                onChange={(e) => setEditDateValue(e.target.value)}
                                className="border border-gray-300 rounded px-2 py-1 text-sm"
                                autoFocus
                              />
                              <button
                                onClick={() => handleSaveDateReceived(inv, editDateValue)}
                                disabled={savingDate === inv.sheetRowNumber}
                                className="text-green-600 hover:text-green-800 transition-colors disabled:opacity-50"
                                title="Save date received"
                              >
                                {savingDate === inv.sheetRowNumber ? (
                                  <div className="w-3.5 h-3.5 border-2 border-green-400 border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  <Check className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                onClick={() => setEditingDateRow(null)}
                                disabled={savingDate === inv.sheetRowNumber}
                                className="text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
                                title="Cancel"
                              >
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => {
                                setEditingDateRow(inv.sheetRowNumber);
                                setEditDateValue(toDateInputValue(inv.dateReceived, inv.year));
                              }}
                              className="text-left hover:text-gray-900 hover:underline decoration-dotted underline-offset-2"
                              title="Click to edit date received"
                            >
                              {formatDateDisplay(inv.dateReceived, inv.year)}
                            </button>
                          )}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-center">
                          {inv.status === 'Paid' ? (
                            <span className="text-gray-400 text-xs">—</span>
                          ) : inv.pendingReminder || draftSuccess[inv.sheetRowNumber] ? (
                            <span
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-amber-50 text-amber-700"
                              title={
                                inv.pendingReminder?.createdAt
                                  ? `${REMINDER_ORDINALS[Math.min(inv.pendingReminder.stage || 0, 2)]} reminder draft created ${inv.pendingReminder.createdAt.slice(0, 10)} — count advances once the send is confirmed`
                                  : 'Draft created — count advances once the send is confirmed'
                              }
                            >
                              <Clock className="w-3.5 h-3.5" />
                              Awaiting send
                            </span>
                          ) : (
                            <button
                              onClick={() => createReminderDraft(inv)}
                              disabled={creatingDraft === inv.sheetRowNumber}
                              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                                draftError === inv.sheetRowNumber
                                  ? 'bg-red-50 text-red-700 hover:bg-red-100'
                                  : 'bg-blue-50 text-blue-700 hover:bg-blue-100'
                              } disabled:opacity-50`}
                              title={draftError === inv.sheetRowNumber ? draftErrorMsg : gmailToken ? 'Create reminder draft in Gmail' : 'Connect Gmail first, then create draft'}
                            >
                              {creatingDraft === inv.sheetRowNumber ? (
                                <>
                                  <div className="w-3.5 h-3.5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                                  Creating...
                                </>
                              ) : draftError === inv.sheetRowNumber ? (
                                <>
                                  <X className="w-3.5 h-3.5" />
                                  Retry
                                </>
                              ) : (
                                <>
                                  <Send className="w-3.5 h-3.5" />
                                  {REMINDER_ORDINALS[Math.min(inv.remindersSent || 0, 2)]} Reminder
                                </>
                              )}
                            </button>
                          )}
                          {(inv.remindersSent || 0) > 0 && (
                            <div className="mt-1 text-[10px] text-gray-400">
                              {inv.remindersSent} sent{inv.lastReminderSentAt ? ` · ${String(inv.lastReminderSentAt).slice(0, 10)}` : ''}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-4 text-sm text-gray-500 max-w-[220px]">
                          <div className="truncate">{inv.notes || '—'}</div>
                          {inv.matchedTransactionId && paymentAllocations[inv.matchedTransactionId]?.invoiceCount > 1 && (
                            <div
                              className="mt-1 text-[10px] font-medium text-blue-700"
                              title="This note is derived from payment matches and does not replace invoice notes"
                            >
                              Paid with {paymentAllocations[inv.matchedTransactionId].invoiceCount} invoices by the same payment
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                    {filteredAndSorted.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-6 py-12 text-center text-sm text-gray-500">
                          No invoices found.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AdminInvoices;
