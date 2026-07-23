import { createSign } from "node:crypto";
import { getAdminDb, getAdminAuth } from "@/firebase/admin";
import { authenticateRequest } from "@/app/api/_lib/authGate";

// Detect whether pending invoice-reminder DRAFTS have actually been SENT, and
// only then advance the per-invoice reminder count.
//
// Flow: the admin creates a reminder as a Gmail *draft* (client-side, their own
// OAuth token) and we stamp `pendingReminder` on the invoice entry. This route
// impersonates the sender's mailbox via a domain-wide-delegated service account
// and looks for the corresponding SENT message. On confirmation it bumps
// `remindersSent`, records `lastReminderSentAt`, and clears `pendingReminder`.
//
// Setup (one-time, see docs/reminder-send-detection.md):
//   1. Enable the Gmail API on the GCP project.
//   2. In the Google Workspace Admin console, grant the service account
//      domain-wide delegation with scope
//        https://www.googleapis.com/auth/gmail.readonly
//   3. Set GOOGLE_SERVICE_ACCOUNT_KEY (or reuse FIREBASE_SERVICE_ACCOUNT_KEY).
// Until DWD is configured the token exchange returns "unauthorized_client" and
// this route reports a clear setup error without mutating anything.

export const dynamic = "force-dynamic";

const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GMAIL_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
// Allow small clock skew between our client-stamped createdAt and Gmail's
// server internalDate when deciding a SENT message belongs to this draft.
const SKEW_MS = 5 * 60 * 1000;

const unauthorized = () =>
  Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
const forbidden = () =>
  Response.json({ success: false, error: "Forbidden" }, { status: 403 });

const b64url = (buf) => Buffer.from(buf).toString("base64url");

// Stable natural key for an invoice — MUST match invoiceKey() in
// components/AdminInvoices.jsx so the transaction can relocate the right entry
// even if the Payment Status rows were reordered by an Apps Script sync.
function invoiceKey(inv) {
  if (!inv) return "";
  const client = (inv.client ?? "").toString().trim().toLowerCase();
  const amount = inv.amount ?? "";
  const dateSent = (inv.dateSent ?? "").toString().trim();
  const year = inv.year ?? "";
  return `${client}|${amount}|${dateSent}|${year}`;
}

function loadServiceAccountKey() {
  const raw =
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY ||
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!raw) {
    throw new Error(
      "no service-account key configured (GOOGLE_SERVICE_ACCOUNT_KEY or FIREBASE_SERVICE_ACCOUNT_KEY)"
    );
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("service-account key is not valid JSON");
  }
}

// Mint an impersonated (domain-wide-delegated) access token for `subject`.
async function getImpersonatedToken(key, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({
      iss: key.client_email,
      sub: subject, // the mailbox to impersonate — requires DWD
      scope: GMAIL_SCOPE,
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    })
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const jwt = `${header}.${claims}.${b64url(signer.sign(key.private_key))}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    // e.g. unauthorized_client (DWD not granted), access_denied (scope missing).
    throw new Error(
      `impersonation failed for ${subject} (${data.error || res.status})`
    );
  }
  return data.access_token;
}

// Given a pending reminder, decide its outcome by inspecting the mailbox.
// Returns 'sent' (with sentAt ISO), 'pending', or 'discarded'.
async function classifyDraft(token, pending) {
  const authHeader = { Authorization: `Bearer ${token}` };

  // 1. Does the draft still exist? If yes, it hasn't been sent.
  const draftRes = await fetch(
    `${GMAIL_BASE}/drafts/${encodeURIComponent(pending.draftId)}?fields=id`,
    { headers: authHeader }
  );
  if (draftRes.ok) return { outcome: "pending" };
  if (draftRes.status !== 404) {
    throw new Error(`drafts.get ${draftRes.status}`);
  }

  // 2. Draft is gone — sent or discarded. Look for a SENT message in the thread
  //    newer than when we created the draft.
  const createdMs = Date.parse(pending.createdAt) || 0;
  const threadRes = await fetch(
    `${GMAIL_BASE}/threads/${encodeURIComponent(
      pending.threadId
    )}?fields=messages(labelIds,internalDate)`,
    { headers: authHeader }
  );
  if (!threadRes.ok) {
    // Thread vanished entirely — treat as discarded (nothing to count).
    if (threadRes.status === 404) return { outcome: "discarded" };
    throw new Error(`threads.get ${threadRes.status}`);
  }
  const thread = await threadRes.json();
  let sentMs = 0;
  for (const m of thread.messages || []) {
    const internal = Number(m.internalDate) || 0;
    if ((m.labelIds || []).includes("SENT") && internal >= createdMs - SKEW_MS) {
      if (internal > sentMs) sentMs = internal;
    }
  }
  if (sentMs > 0) {
    return { outcome: "sent", sentAt: new Date(sentMs).toISOString() };
  }
  return { outcome: "discarded" };
}

export async function POST(request) {
  const db = getAdminDb();
  const gate = await authenticateRequest(request, {
    auth: getAdminAuth(),
    db,
    logPrefix: "check-reminder-sends",
    buildError: (status) =>
      status === 401
        ? unauthorized()
        : status === 403
          ? forbidden()
          : Response.json(
              { success: false, error: "Internal error" },
              { status: 500 }
            ),
  });
  if (!gate.ok) return gate.response;

  // --- Gather pending reminders from invoices/all. ----------------------------
  const invRef = db.collection("invoices").doc("all");
  const snap = await invRef.get();
  const entries = snap.exists ? snap.data().entries || [] : [];
  const pendings = entries.filter((e) => e.pendingReminder && e.pendingReminder.draftId);

  if (pendings.length === 0) {
    return Response.json({
      success: true,
      checked: 0,
      confirmed: 0,
      stillPending: 0,
      discarded: 0,
    });
  }

  let key;
  try {
    key = loadServiceAccountKey();
  } catch (err) {
    return Response.json({ success: false, error: err.message }, { status: 500 });
  }

  // --- Classify each pending draft (Gmail I/O, outside any transaction). -------
  // Impersonation tokens are minted once per distinct sender mailbox.
  const tokenBySender = new Map();
  const tokenErrBySender = new Map();
  const getToken = async (sender) => {
    if (tokenBySender.has(sender)) return tokenBySender.get(sender);
    if (tokenErrBySender.has(sender)) throw tokenErrBySender.get(sender);
    try {
      const t = await getImpersonatedToken(key, sender);
      tokenBySender.set(sender, t);
      return t;
    } catch (err) {
      tokenErrBySender.set(sender, err);
      throw err;
    }
  };

  // draftId → { outcome, sentAt? }
  const results = new Map();
  let confirmed = 0;
  let stillPending = 0;
  let discarded = 0;
  let errored = 0;
  let firstError = null;

  for (const e of pendings) {
    const p = e.pendingReminder;
    const sender = (p.senderEmail || "").trim();
    if (!sender) {
      errored += 1;
      firstError = firstError || "a pending reminder is missing senderEmail";
      continue;
    }
    try {
      const token = await getToken(sender);
      const res = await classifyDraft(token, p);
      results.set(p.draftId, res);
      if (res.outcome === "sent") confirmed += 1;
      else if (res.outcome === "pending") stillPending += 1;
      else discarded += 1;
    } catch (err) {
      errored += 1;
      firstError = firstError || String((err && err.message) || err);
    }
  }

  // --- Apply confirmed/discarded outcomes atomically. -------------------------
  if (results.size > 0) {
    try {
      await db.runTransaction(async (txn) => {
        const fresh = await txn.get(invRef);
        const cur = fresh.exists ? fresh.data().entries || [] : [];
        const updated = cur.map((e) => {
          const p = e.pendingReminder;
          if (!p || !p.draftId) return e;
          const r = results.get(p.draftId);
          if (!r) return e;
          if (r.outcome === "sent") {
            const { pendingReminder, ...rest } = e;
            return {
              ...rest,
              remindersSent: (e.remindersSent || 0) + 1,
              lastReminderSentAt: r.sentAt,
            };
          }
          if (r.outcome === "discarded") {
            const { pendingReminder, ...rest } = e;
            return rest;
          }
          return e; // pending — leave as-is
        });
        txn.set(invRef, { entries: updated }, { merge: true });
      });
    } catch (err) {
      console.error("check-reminder-sends: transaction failed:", err && err.message);
      return Response.json(
        { success: false, error: "Failed to persist reminder updates" },
        { status: 500 }
      );
    }
  }

  return Response.json({
    success: true,
    checked: pendings.length,
    confirmed,
    stillPending,
    discarded,
    ...(errored > 0 ? { errored, error: firstError } : {}),
  });
}
