import { getAdminDb, getAdminAuth } from "@/firebase/admin";
import { authenticateRequest } from "@/app/api/_lib/authGate";

const MERCURY_BASE_URL = "https://api.mercury.com/api/v1";
const PAGE_LIMIT = 500;

const unauthorized = () =>
  Response.json({ success: false, error: "Unauthorized" }, { status: 401 });
const forbidden = () =>
  Response.json({ success: false, error: "Forbidden" }, { status: 403 });

export async function POST(request) {
  const adminDb = getAdminDb();
  const gate = await authenticateRequest(request, {
    auth: getAdminAuth(),
    db: adminDb,
    logPrefix: "sync-transactions",
    buildError: (status) =>
      status === 401
        ? unauthorized()
        : status === 403
          ? forbidden()
          : Response.json(
              { success: false, error: "Internal error" },
              { status: 500 }
            ),
    formatDbError: (err) =>
      err && err.code ? err.code : err && err.message ? err.message : "unknown",
  });
  if (!gate.ok) return gate.response;

  // ---------------------------------------------------------------------------
  // Mercury sync proper. Caller is a verified, domain-restricted admin.
  // ---------------------------------------------------------------------------
  const mercuryToken = process.env.MERCURY_API_TOKEN;
  if (!mercuryToken) {
    return Response.json(
      { success: false, error: "MERCURY_API_TOKEN is not configured" },
      { status: 500 }
    );
  }
  const accountId = process.env.MERCURY_ACCOUNT_ID;
  if (!accountId) {
    return Response.json(
      { success: false, error: "MERCURY_ACCOUNT_ID is not configured" },
      { status: 500 }
    );
  }

  try {
    // Fetch all transactions with pagination
    let allTransactions = [];
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      const url = `${MERCURY_BASE_URL}/account/${accountId}/transactions?limit=${PAGE_LIMIT}&offset=${offset}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${mercuryToken}` },
      });

      if (!res.ok) {
        // Log full status + truncated body server-side (Vercel logs only); do
        // NOT echo Mercury's response body back to the caller in case it
        // contains counterparty PII.
        const body = await res.text().catch(() => "");
        console.error(
          `sync-transactions: Mercury API ${res.status}`,
          body.slice(0, 500)
        );
        return Response.json(
          { success: false, error: `Mercury API error: ${res.status}` },
          { status: 502 }
        );
      }

      const data = await res.json();
      const transactions = data.transactions || [];
      allTransactions = allTransactions.concat(transactions);

      if (transactions.length < PAGE_LIMIT) {
        hasMore = false;
      } else {
        offset += PAGE_LIMIT;
      }
    }

    // Upsert each transaction into Firestore in batches of 500.
    //
    // NOTE: this still uses `batch.set(docRef, txn)` which clobbers any
    // per-doc fields not present in the Mercury payload (e.g., manually-set
    // `matchedTransactionId` from AdminInvoices.jsx). Switching to a
    // field-allowlist merge is tracked as plan item S2; that's intentionally
    // out of scope for this SEC-001-only session.
    const BATCH_SIZE = 500;
    for (let i = 0; i < allTransactions.length; i += BATCH_SIZE) {
      const chunk = allTransactions.slice(i, i + BATCH_SIZE);
      const batch = adminDb.batch();
      for (const txn of chunk) {
        const docRef = adminDb.collection("transactions").doc(txn.id);
        batch.set(docRef, txn);
      }
      await batch.commit();
    }

    return Response.json({ success: true, synced: allTransactions.length });
  } catch (err) {
    // Log only the error message; do not return it to the caller. Any
    // upstream API response bodies / stack traces stay server-side.
    console.error(
      "sync-transactions: unexpected error:",
      err && err.message ? err.message : "unknown"
    );
    return Response.json(
      { success: false, error: "Internal error" },
      { status: 500 }
    );
  }
}
